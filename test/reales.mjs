// Pasa EPUBs reales por la app (como un usuario) y comprueba que la portada cambia
// y que epubcheck no encuentra errores NUEVOS. No toca los originales.
// Uso: node test/reales.mjs lista.txt   (una ruta de EPUB por línea)
import { chromium } from "playwright-core";
import JSZip from "jszip";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SALIDA = join(RAIZ, "test", "salida", "reales");
const EPUBCHECK = join(RAIZ, "test", "herramientas", "epubcheck-4.2.6", "epubcheck.jar");
const IMG = join(RAIZ, "test", "salida", "lab", "nueva-apaisada.jpg"); // la genera probar.mjs (1200×800)
const PUERTO = 8767;
mkdirSync(SALIDA, { recursive: true });
const lista = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);

// Errores de epubcheck normalizados (código + fichero, sin línea/columna) para comparar antes/después.
async function errores(ruta) {
  try { await promisify(execFile)("java", ["-jar", EPUBCHECK, ruta], { maxBuffer: 64 << 20 }); return new Set(); }
  catch (e) {
    return new Set(String(e.stdout).split("\n").filter(l => /^(ERROR|FATAL)/.test(l))
      .map(l => l.replace(/^(\w+)\(([^)]+)\):\s*.*?\.epub\/?([^(:]*)(\(\d+,\d+\))?:?\s*(.*)$/, "$2 $3 $5").replace(/\s+/g, " ")));
  }
}

const servidor = spawn("python3", ["-m", "http.server", String(PUERTO)], { cwd: RAIZ, stdio: "ignore" });
await new Promise(r => setTimeout(r, 800));
const navegador = await chromium.launch({ channel: "chrome" });
const ctx = await navegador.newContext({ acceptDownloads: true });
const pagina = await ctx.newPage();
const consola = [];
pagina.on("pageerror", e => consola.push(e.message));
await pagina.goto(`http://localhost:${PUERTO}/`);

const filas = [];
for (const [n, ruta] of lista.entries()) {
  const nombre = basename(ruta);
  const fila = { nombre, estado: "", detalle: "" };
  filas.push(fila);
  try {
    await pagina.reload();
    await pagina.setInputFiles("#f-epub", ruta);
    await pagina.waitForSelector("#info-epub .datos, #err-epub:not([hidden])", { timeout: 60000 });
    const errEpub = await pagina.$eval("#err-epub", e => e.hidden ? "" : e.textContent);
    if (errEpub) { fila.estado = "NO ABRE"; fila.detalle = errEpub; continue; }
    fila.tenia = await pagina.textContent("#info-epub .datos span");
    await pagina.setInputFiles("#f-img", IMG);
    await pagina.waitForSelector("#info-img .datos");
    await pagina.click("#b-cambiar");
    await pagina.waitForSelector("#resultado:not([hidden]), #err-final:not([hidden])", { timeout: 120000 });
    const err = await pagina.$eval("#err-final", e => e.hidden ? "" : e.textContent);
    if (err) { fila.estado = "FALLA"; fila.detalle = err; continue; }
    const [d] = await Promise.all([pagina.waitForEvent("download"), pagina.click("#b-descargar")]);
    const destino = join(SALIDA, n + ".epub");
    await d.saveAs(destino);

    // ¿La portada declarada es la imagen nueva? (la miro en el zip, sin usar el código de la app)
    const z = await JSZip.loadAsync(readFileSync(destino));
    const cont = await z.file("META-INF/container.xml").async("string");
    const opfRuta = cont.match(/full-path="([^"]+)"/)[1];
    const opf = await z.file(opfRuta).async("string");
    const items = [...opf.matchAll(/<item\b[^>]*>/g)].map(m => m[0]);
    const attr = (s, a) => (s.match(new RegExp(`\\s${a}="([^"]*)"`)) || [])[1];
    const idMeta = [...opf.matchAll(/<meta\b[^>]*>/g)].map(m => m[0]).find(m => attr(m, "name") === "cover");
    const porProp = items.find(i => (attr(i, "properties") || "").split(" ").includes("cover-image"));
    const porMeta = idMeta && items.find(i => attr(i, "id") === attr(idMeta, "content"));
    const img = porProp || porMeta;
    const dirOpf = opfRuta.includes("/") ? opfRuta.slice(0, opfRuta.lastIndexOf("/") + 1) : "";
    const rutaImg = img && decodeURIComponent(new URL(attr(img, "href"), "http://x/" + dirOpf).pathname.slice(1));
    const bytes = rutaImg && z.file(rutaImg) ? await z.file(rutaImg).async("base64") : null;
    const dims = bytes && await pagina.evaluate(async b64 => {
      const bm = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))]));
      return bm.width + "x" + bm.height;
    }, bytes);
    const coinciden = porProp && porMeta ? porProp === porMeta : true;

    const [antes, despues] = await Promise.all([errores(ruta), errores(destino)]);
    const nuevos = [...despues].filter(e => !antes.has(e));
    if (dims !== "1200x800") { fila.estado = "PORTADA MAL"; fila.detalle = `imagen declarada: ${rutaImg} (${dims})`; }
    else if (!coinciden) { fila.estado = "PORTADA MAL"; fila.detalle = "meta cover y cover-image apuntan a imágenes distintas"; }
    else if (nuevos.length) { fila.estado = "ERRORES NUEVOS"; fila.detalle = nuevos.slice(0, 5).join(" | "); }
    else fila.estado = "OK";
    fila.detalle ||= `errores epubcheck antes ${antes.size} / después ${despues.size}`;
    rmSync(destino);
  } catch (e) { fila.estado = "EXCEPCIÓN"; fila.detalle = e.message.split("\n")[0]; }
  finally { console.log(`${n + 1}/${lista.length} ${fila.estado.padEnd(14)} ${nombre.slice(0, 70)} · ${fila.tenia || ""} · ${fila.detalle}`); }
}

await navegador.close();
servidor.kill();
const cuenta = filas.reduce((a, f) => (a[f.estado] = (a[f.estado] || 0) + 1, a), {});
console.log("\nRESUMEN", JSON.stringify(cuenta), consola.length ? "\nErrores de consola: " + consola.join(" | ") : "");
writeFileSync(join(SALIDA, "informe.json"), JSON.stringify(filas, null, 1));
