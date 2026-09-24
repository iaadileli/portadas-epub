// Prueba de verdad: fabrica EPUBs de varios tipos, los pasa por la app en Chrome (como un usuario:
// elige fichero, elige imagen, pulsa, descarga) y comprueba el resultado con epubcheck y a mano.
// Uso: npm run probar
import { chromium } from "playwright-core";
import JSZip from "jszip";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SALIDA = join(RAIZ, "test", "salida", "lab");
const EPUBCHECK = join(RAIZ, "test", "herramientas", "epubcheck-4.2.6", "epubcheck.jar");
const PUERTO = 8766;
rmSync(SALIDA, { recursive: true, force: true });
mkdirSync(SALIDA, { recursive: true });

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ ") + msg); if (!cond) fallos++; };

// ---------- servidor y navegador ----------
const servidor = spawn("python3", ["-m", "http.server", String(PUERTO)], { cwd: RAIZ, stdio: "ignore" });
await new Promise(r => setTimeout(r, 800));
const navegador = await chromium.launch({ channel: "chrome" });
const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
const pagina = await ctx.newPage();
const erroresConsola = [];
pagina.on("pageerror", e => erroresConsola.push(e.message));
pagina.on("console", m => m.type() === "error" && erroresConsola.push(m.text()));
await pagina.goto(`http://localhost:${PUERTO}/`);

// Imágenes de prueba generadas con canvas (color + texto para distinguirlas).
async function imagen(ancho, alto, mime, color, texto) {
  const b64 = await pagina.evaluate(async ([w, h, mime, color, texto]) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d");
    x.fillStyle = color; x.fillRect(0, 0, w, h);
    x.fillStyle = "#fff"; x.font = `bold ${Math.round(w / 8)}px sans-serif`; x.textAlign = "center";
    x.fillText(texto, w / 2, h / 2);
    const blob = await new Promise(ok => c.toBlob(ok, mime, 0.9));
    const u8 = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (const b of u8) s += String.fromCharCode(b);
    return btoa(s);
  }, [ancho, alto, mime, color, texto]);
  return Buffer.from(b64, "base64");
}
const dimensiones = buf => pagina.evaluate(async b64 => {
  const u8 = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const bm = await createImageBitmap(new Blob([u8]));
  return [bm.width, bm.height];
}, buf.toString("base64"));

// ---------- fabricar EPUBs ----------
const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
const CAPITULO3 = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Capítulo 1</title></head><body><h1>Capítulo 1</h1><p>Érase una vez…</p></body></html>`;
const CAPITULO2 = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Capítulo 1</title></head><body><h1>Capítulo 1</h1><p>Érase una vez…</p></body></html>`;
const NAV = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Índice</title></head><body><nav epub:type="toc"><ol><li><a href="cap1.xhtml">Capítulo 1</a></li></ol></nav></body></html>`;
const NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:12345678-1234-1234-1234-123456789abc"/></head><docTitle><text>Libro</text></docTitle><navMap><navPoint id="n1" playOrder="1"><navLabel><text>Capítulo 1</text></navLabel><content src="cap1.xhtml"/></navPoint></navMap></ncx>`;

function opf3({ manifestExtra = "", spineExtra = "", metaExtra = "" }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:12345678-1234-1234-1234-123456789abc</dc:identifier>
    <dc:title>El libro de prueba</dc:title>
    <dc:creator>Autora Inventada</dc:creator>
    <dc:language>es</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>${metaExtra}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cap1" href="cap1.xhtml" media-type="application/xhtml+xml"/>${manifestExtra}
  </manifest>
  <spine>${spineExtra}
    <itemref idref="cap1"/>
  </spine>
</package>`;
}
function opf2({ manifestExtra = "", spineExtra = "", metaExtra = "", guide = "" }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="uid">urn:uuid:12345678-1234-1234-1234-123456789abc</dc:identifier>
    <dc:title>Libro EPUB 2</dc:title>
    <dc:creator>Autor Antiguo</dc:creator>
    <dc:language>es</dc:language>${metaExtra}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cap1" href="cap1.xhtml" media-type="application/xhtml+xml"/>${manifestExtra}
  </manifest>
  <spine toc="ncx">${spineExtra}
    <itemref idref="cap1"/>
  </spine>${guide}
</package>`;
}
const paginaSvg = (href, w, h, v3) => `<?xml version="1.0" encoding="utf-8"?>
${v3 ? "<!DOCTYPE html>" : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">'}
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cubierta</title></head><body><div><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet"><image width="${w}" height="${h}" xlink:href="${href}"/></svg></div></body></html>`;
const paginaImg = (href, w, h) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cubierta</title></head><body><div><img src="${href}" alt="Cubierta" width="${w}" height="${h}"/></div></body></html>`;

async function epub(nombre, v3, opf, ficheros) {
  const z = new JSZip();
  z.file("mimetype", "application/epub+zip", { compression: "STORE" });
  z.file("META-INF/container.xml", CONTAINER);
  z.file("OEBPS/content.opf", opf);
  z.file("OEBPS/cap1.xhtml", v3 ? CAPITULO3 : CAPITULO2);
  z.file(v3 ? "OEBPS/nav.xhtml" : "OEBPS/toc.ncx", v3 ? NAV : NCX);
  for (const [r, d] of Object.entries(ficheros)) z.file(r, d);
  const ruta = join(SALIDA, nombre + ".epub");
  writeFileSync(ruta, await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return ruta;
}

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const fea = await imagen(600, 900, "image/jpeg", "#777", "FEA");
const feaPng = await imagen(500, 800, "image/png", "#777", "FEA");
const nuevaApaisada = await imagen(1200, 800, "image/jpeg", "#1d6b8f", "NUEVA");
const nuevaGrande = await imagen(3000, 4500, "image/png", "#8f1d4b", "GRANDE");
writeFileSync(join(SALIDA, "nueva-apaisada.jpg"), nuevaApaisada);
writeFileSync(join(SALIDA, "nueva-grande.png"), nuevaGrande);

const casos = [
  {
    nombre: "epub3-svg-jpg", v3: true, img: "nueva-apaisada.jpg", espera: [1200, 800], mismaRuta: "OEBPS/images/cover.jpg",
    opf: opf3({
      manifestExtra: `\n    <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>\n    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" properties="svg"/>`,
      spineExtra: `\n    <itemref idref="cover"/>`,
    }),
    ficheros: { "OEBPS/images/cover.jpg": fea, "OEBPS/cover.xhtml": paginaSvg("images/cover.jpg", 600, 900, true) },
    pagina: "OEBPS/cover.xhtml",
  },
  {
    nombre: "epub2-img-png", v3: false, img: "nueva-apaisada.jpg", espera: [1200, 800], mismaRuta: "OEBPS/Images/Cubierta%20vieja.png",
    opf: opf2({
      metaExtra: `\n    <meta name="cover" content="portada"/>`,
      manifestExtra: `\n    <item id="portada" href="Images/Cubierta%20vieja.png" media-type="image/png"/>\n    <item id="cubierta" href="Text/cubierta.xhtml" media-type="application/xhtml+xml"/>`,
      spineExtra: `\n    <itemref idref="cubierta"/>`,
      guide: `\n  <guide><reference type="cover" title="Cubierta" href="Text/cubierta.xhtml"/></guide>`,
    }),
    ficheros: { "OEBPS/Images/Cubierta vieja.png": feaPng, "OEBPS/Text/cubierta.xhtml": paginaImg("../Images/Cubierta%20vieja.png", 500, 800) },
    pagina: "OEBPS/Text/cubierta.xhtml",
  },
  {
    nombre: "epub3-sin-portada", v3: true, img: "nueva-grande.png", recortar: false, espera: [1600, 2400],
    opf: opf3({}), ficheros: {}, creaPagina: true,
  },
  {
    nombre: "epub2-sin-portada", v3: false, img: "nueva-apaisada.jpg", recortar: true, espera: [533, 800],
    opf: opf2({}), ficheros: {}, creaPagina: true,
  },
  {
    nombre: "epub3-portada-gif", v3: true, img: "nueva-apaisada.jpg", espera: [1200, 800],
    opf: opf3({
      metaExtra: `\n    <meta name="cover" content="cover-img"/>`,
      manifestExtra: `\n    <item id="cover-img" href="cover.gif" media-type="image/gif" properties="cover-image"/>\n    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" properties="svg"/>`,
      spineExtra: `\n    <itemref idref="cover"/>`,
    }),
    ficheros: { "OEBPS/cover.gif": GIF, "OEBPS/cover.xhtml": paginaSvg("cover.gif", 1, 1, true) },
    pagina: "OEBPS/cover.xhtml",
  },
];

function epubcheck(ruta) {
  try { execFileSync("java", ["-jar", EPUBCHECK, ruta], { stdio: "pipe" }); return "OK"; }
  catch (e) { return (e.stdout + e.stderr).split("\n").filter(l => /^(ERROR|FATAL)/.test(l)).join("\n") || "fallo"; }
}

// ---------- ejecutar ----------
for (const c of casos) {
  console.log(`\n▶ ${c.nombre}`);
  const origen = await epub(c.nombre, c.v3, c.opf, c.ficheros);
  ok(epubcheck(origen) === "OK", "el EPUB de partida es válido (epubcheck)");

  await pagina.reload();
  await pagina.setInputFiles("#f-epub", origen);
  await pagina.waitForSelector("#info-epub .datos");
  await pagina.setInputFiles("#f-img", join(SALIDA, c.img));
  await pagina.waitForSelector("#info-img .datos");
  if (c.recortar) await pagina.check("#recortar");
  await pagina.click("#b-cambiar");
  await pagina.waitForSelector("#resultado:not([hidden]), #err-final:not([hidden])");
  const err = await pagina.$eval("#err-final", e => e.hidden ? "" : e.textContent);
  ok(!err, "la app no da error " + err);
  if (err) continue;
  await pagina.screenshot({ path: join(SALIDA, c.nombre + ".png"), fullPage: true });
  const [descarga] = await Promise.all([pagina.waitForEvent("download"), pagina.click("#b-descargar")]);
  const destino = join(SALIDA, c.nombre + "-NUEVO.epub");
  await descarga.saveAs(destino);
  ok(descarga.suggestedFilename() === c.nombre + ".epub", "se descarga con el mismo nombre: " + descarga.suggestedFilename());

  const bytes = readFileSync(destino);
  ok(bytes.readUInt16LE(8) === 0 && bytes.toString("latin1", 30, 38) === "mimetype", "'mimetype' va el primero y sin comprimir");
  const val = epubcheck(destino);
  ok(val === "OK", "el EPUB nuevo es válido (epubcheck)" + (val === "OK" ? "" : "\n" + val));

  const z = await JSZip.loadAsync(bytes);
  const opf = await z.file("OEBPS/content.opf").async("string");
  const idMeta = (opf.match(/<meta[^>]*name="cover"[^>]*content="([^"]+)"/) || opf.match(/<meta[^>]*content="([^"]+)"[^>]*name="cover"/) || [])[1];
  const itemPorProp = opf.match(/<item [^>]*properties="[^"]*cover-image[^"]*"[^>]*>/)?.[0];
  const itemPortada = itemPorProp || (idMeta && opf.match(new RegExp(`<item [^>]*id="${idMeta}"[^>]*>`))?.[0]);
  ok(!!itemPortada, "el OPF declara la portada");
  if (c.v3) ok(!!itemPorProp, "EPUB 3: tiene properties=\"cover-image\"");
  ok(!!idMeta && itemPortada?.includes(`id="${idMeta}"`), "meta name=\"cover\" apunta a la imagen de portada");
  const href = decodeURIComponent(itemPortada.match(/href="([^"]+)"/)[1]);
  const rutaImg = "OEBPS/" + href;
  if (c.mismaRuta) ok(rutaImg === decodeURIComponent(c.mismaRuta), "la imagen se sustituye en su sitio: " + rutaImg);
  const dims = await dimensiones(await z.file(rutaImg).async("nodebuffer"));
  ok(dims[0] === c.espera[0] && dims[1] === c.espera[1], `la imagen dentro del EPUB es la nueva: ${dims.join("×")} (esperado ${c.espera.join("×")})`);
  ok((await z.file("OEBPS/cap1.xhtml").async("string")) === (c.v3 ? CAPITULO3 : CAPITULO2), "el resto del libro queda intacto");

  const rutaPag = c.pagina || (c.creaPagina && "OEBPS/portada.xhtml");
  const pag = await z.file(rutaPag).async("string");
  if (pag.includes("<svg")) ok(pag.includes(`viewBox="0 0 ${c.espera[0]} ${c.espera[1]}"`), "la página de portada se ajusta a la forma de la imagen nueva");
  else ok(pag.includes(`height="${Math.round(500 * c.espera[1] / c.espera[0])}"`), "el <img> de la portada cambia de alto para no deformar");
  if (c.creaPagina) {
    const primera = opf.match(/<itemref [^>]*idref="([^"]+)"/)[1];
    ok(new RegExp(`<item [^>]*id="${primera}"[^>]*href="portada.xhtml"`).test(opf), "la portada nueva es la primera página del libro");
  }
}

// EPUB roto → mensaje claro
console.log("\n▶ fichero que no es EPUB");
writeFileSync(join(SALIDA, "no-es-epub.epub"), "hola");
await pagina.reload();
await pagina.setInputFiles("#f-epub", join(SALIDA, "no-es-epub.epub"));
await pagina.waitForSelector("#err-epub:not([hidden])");
ok(/no parece un EPUB/.test(await pagina.textContent("#err-epub")), "avisa de que no es un EPUB");
ok(await pagina.isDisabled("#b-cambiar"), "el botón sigue desactivado");

ok(erroresConsola.length === 0, "sin errores en la consola" + (erroresConsola.length ? ": " + erroresConsola.join(" | ") : ""));

await navegador.close();
servidor.kill();
console.log(fallos ? `\n✗ ${fallos} comprobación(es) fallida(s)` : "\n✓ Todo bien");
process.exit(fallos ? 1 : 0);
