// Núcleo: abre un EPUB, localiza su portada y la sustituye. Todo ocurre en el navegador.
// Necesita window.JSZip (vendor/jszip.min.js), DOMParser y XMLSerializer.

const NS_OPF = "http://www.idpf.org/2007/opf";
const NS_DC = "http://purl.org/dc/elements/1.1/";
const NS_XHTML = "http://www.w3.org/1999/xhtml";
const NS_SVG = "http://www.w3.org/2000/svg";
const NS_XLINK = "http://www.w3.org/1999/xlink";
const EXT = { "image/jpeg": "jpg", "image/png": "png" };

// ---------- utilidades de rutas y XML ----------

const dirDe = ruta => ruta.includes("/") ? ruta.slice(0, ruta.lastIndexOf("/") + 1) : "";

// Resuelve un href relativo (del OPF o de una página) a ruta dentro del zip.
function resolver(base, href) {
  const limpio = href.split("#")[0];
  return decodeURIComponent(new URL(limpio, "http://x/" + base).pathname.slice(1));
}

// Ruta relativa desde el directorio `desdeDir` hasta `ruta` (ambas dentro del zip).
function relativa(desdeDir, ruta) {
  const a = desdeDir.split("/").filter(Boolean), b = ruta.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return "../".repeat(a.length - i) + b.slice(i).map(encodeURIComponent).join("/");
}

function parsear(texto, tipo = "application/xml") {
  const doc = new DOMParser().parseFromString(texto, tipo);
  if (doc.getElementsByTagName("parsererror").length) throw new Error("XML mal formado");
  return doc;
}

function serializar(doc, original) {
  let s = new XMLSerializer().serializeToString(doc);
  if (/^\s*<\?xml/.test(original) && !/^\s*<\?xml/.test(s)) s = '<?xml version="1.0" encoding="utf-8"?>\n' + s;
  return s;
}

const tieneProp = (el, p) => (el.getAttribute("properties") || "").split(/\s+/).includes(p);

function idLibre(opf, base) {
  let id = base, n = 2;
  while ([...opf.getElementsByTagNameNS(NS_OPF, "item")].some(i => i.getAttribute("id") === id)) id = base + "-" + n++;
  return id;
}

function rutaLibre(zip, ruta) {
  const punto = ruta.lastIndexOf(".");
  let r = ruta, n = 2;
  while (zip.file(r)) r = ruta.slice(0, punto) + "-" + n++ + ruta.slice(punto);
  return r;
}

// ---------- lectura ----------

export async function leerEpub(datos) {
  let zip;
  try { zip = await JSZip.loadAsync(datos); }
  catch { throw new Error("Esto no parece un EPUB (no es un fichero comprimido)."); }
  const cont = zip.file("META-INF/container.xml");
  if (!cont) throw new Error("Esto no parece un EPUB (le falta META-INF/container.xml).");
  const rootfile = parsear(await cont.async("string")).getElementsByTagName("rootfile")[0];
  const opfRuta = rootfile && rootfile.getAttribute("full-path");
  if (!opfRuta || !zip.file(opfRuta)) throw new Error("El EPUB está dañado: no encuentro su fichero OPF.");
  const opfTexto = await zip.file(opfRuta).async("string");
  const opf = parsear(opfTexto);
  const libro = { zip, opfRuta, opfDir: dirDe(opfRuta), opf, opfTexto };
  libro.version = parseFloat(opf.documentElement.getAttribute("version") || "2") || 2;
  const dc = n => (opf.getElementsByTagNameNS(NS_DC, n)[0]?.textContent || "").trim();
  libro.titulo = dc("title");
  libro.autor = dc("creator");
  libro.portada = await buscarPortada(libro);
  return libro;
}

const items = libro => [...libro.opf.getElementsByTagNameNS(NS_OPF, "item")];
const itemPorId = (libro, id) => items(libro).find(i => i.getAttribute("id") === id);
const rutaItem = (libro, item) => resolver(libro.opfDir, item.getAttribute("href"));
const esImagen = item => /^image\//.test(item.getAttribute("media-type") || "");

// Devuelve { item, ruta, mime, pagina } — cualquiera puede ser null.
async function buscarPortada(libro) {
  const { opf } = libro;
  let item = items(libro).find(i => tieneProp(i, "cover-image"));
  if (!item) {
    const meta = [...opf.getElementsByTagNameNS(NS_OPF, "meta")].find(m => m.getAttribute("name") === "cover");
    const cand = meta && itemPorId(libro, meta.getAttribute("content"));
    if (cand && esImagen(cand)) item = cand;
  }
  const pagina = await buscarPaginaPortada(libro, item);
  if (!item && pagina) {
    // Página de portada sin imagen declarada: tomo la primera imagen que use.
    const src = (pagina.texto.match(/(?:xlink:href|href|src)\s*=\s*["']([^"']+\.(?:jpe?g|png|gif|webp))["']/i) || [])[1];
    if (src) {
      const ruta = resolver(dirDe(pagina.ruta), src);
      item = items(libro).find(i => rutaItem(libro, i) === ruta) || null;
    }
  }
  if (!item) {
    item = items(libro).find(i => esImagen(i) && /cover|portada|cubierta/i.test(i.getAttribute("id") + " " + i.getAttribute("href"))) || null;
  }
  return {
    item: item || null,
    ruta: item ? rutaItem(libro, item) : null,
    mime: item ? item.getAttribute("media-type") : null,
    pagina,
  };
}

// La página XHTML que muestra la portada: la de <guide type="cover"> o una de las primeras del spine
// que referencie la imagen de portada.
async function buscarPaginaPortada(libro, imgItem) {
  const { opf, zip } = libro;
  const leer = async ruta => zip.file(ruta) ? { ruta, texto: await zip.file(ruta).async("string") } : null;
  const ref = [...opf.getElementsByTagNameNS(NS_OPF, "reference")].find(r => r.getAttribute("type") === "cover");
  if (ref) {
    const p = await leer(resolver(libro.opfDir, ref.getAttribute("href")));
    if (p) return p;
  }
  const primeras = [...opf.getElementsByTagNameNS(NS_OPF, "itemref")].slice(0, 3)
    .map(r => itemPorId(libro, r.getAttribute("idref"))).filter(Boolean);
  const nombreImg = imgItem ? rutaItem(libro, imgItem).split("/").pop() : null;
  for (const it of primeras) {
    const p = await leer(rutaItem(libro, it));
    if (!p) continue;
    if (nombreImg && p.texto.includes(nombreImg)) return p;
    if (!nombreImg && /cover|portada|cubierta/i.test(it.getAttribute("id") + " " + it.getAttribute("href"))) return p;
  }
  return null;
}

// Imagen de portada actual como Blob (o null).
export async function portadaActual(libro) {
  const p = libro.portada;
  if (!p?.ruta || !libro.zip.file(p.ruta)) return null;
  return new Blob([await libro.zip.file(p.ruta).async("uint8array")], { type: p.mime || "image/jpeg" });
}

// Formato en que conviene codificar la imagen nueva: el mismo de la portada vieja si es JPEG o PNG.
export function formatoDestino(libro) {
  return EXT[libro.portada?.mime] ? libro.portada.mime : "image/jpeg";
}

// ---------- escritura ----------

// img = { bytes: Uint8Array, mime: "image/jpeg"|"image/png", ancho, alto }
// Devuelve el EPUB nuevo como Uint8Array.
export async function cambiarPortada(libro, img) {
  const { zip, opf } = libro;
  const p = libro.portada;

  if (p.item && p.mime === img.mime && zip.file(p.ruta)) {
    // Caso normal: misma ruta y mismo formato → todo lo que apuntaba a la portada sigue valiendo.
    zip.file(p.ruta, img.bytes);
    if (p.pagina) await ajustarPagina(libro, p.pagina, p.ruta, img);
    // Declarada de las dos maneras (EPUB 2 y 3): cada lector mira una distinta.
    ponerMetaCover(opf, p.item.getAttribute("id"));
    if (libro.version >= 3 && !tieneProp(p.item, "cover-image")) {
      p.item.setAttribute("properties", ((p.item.getAttribute("properties") || "") + " cover-image").trim());
    }
  } else {
    // Sin portada, o en un formato raro: imagen nueva declarada como portada + página de portada.
    const ruta = rutaLibre(zip, libro.opfDir + "portada." + EXT[img.mime]);
    zip.file(ruta, img.bytes);
    const id = idLibre(opf, "portada-img");
    const nuevo = opf.createElementNS(NS_OPF, "item");
    nuevo.setAttribute("id", id);
    nuevo.setAttribute("href", relativa(libro.opfDir, ruta));
    nuevo.setAttribute("media-type", img.mime);
    for (const i of items(libro)) {
      if (tieneProp(i, "cover-image")) {
        const resto = i.getAttribute("properties").split(/\s+/).filter(x => x && x !== "cover-image");
        resto.length ? i.setAttribute("properties", resto.join(" ")) : i.removeAttribute("properties");
      }
    }
    if (libro.version >= 3) nuevo.setAttribute("properties", "cover-image");
    manifest(opf).appendChild(nuevo);
    ponerMetaCover(opf, id);
    await ponerPaginaPortada(libro, ruta, img);
  }

  zip.file(libro.opfRuta, serializar(opf, libro.opfTexto));
  return empaquetar(zip);
}

const manifest = opf => opf.getElementsByTagNameNS(NS_OPF, "manifest")[0];

function ponerMetaCover(opf, id) {
  const metas = [...opf.getElementsByTagNameNS(NS_OPF, "meta")].filter(m => m.getAttribute("name") === "cover");
  if (metas.length) { metas.forEach(m => m.setAttribute("content", id)); return; }
  const meta = opf.createElementNS(NS_OPF, "meta");
  meta.setAttribute("name", "cover");
  meta.setAttribute("content", id);
  opf.getElementsByTagNameNS(NS_OPF, "metadata")[0].appendChild(meta);
}

// Ajusta proporciones en la página de portada (viewBox del SVG, tamaño de <image>/<img>)
// para que la imagen nueva no salga deformada si su forma es distinta de la vieja.
async function ajustarPagina(libro, pagina, rutaImg, img) {
  let doc;
  try { doc = parsear(pagina.texto, "application/xhtml+xml"); } catch { return; }
  const apunta = el => {
    const h = el.getAttributeNS(NS_XLINK, "href") || el.getAttribute("href") || el.getAttribute("src");
    return h && resolver(dirDe(pagina.ruta), h) === rutaImg;
  };
  let cambiado = false;
  for (const im of doc.getElementsByTagNameNS(NS_SVG, "image")) {
    if (!apunta(im)) continue;
    const svg = im.closest("svg");
    if (svg && svg.hasAttribute("viewBox")) svg.setAttribute("viewBox", `0 0 ${img.ancho} ${img.alto}`);
    im.setAttribute("width", img.ancho);
    im.setAttribute("height", img.alto);
    for (const a of ["x", "y"]) if (im.hasAttribute(a)) im.setAttribute(a, "0");
    cambiado = true;
  }
  for (const im of doc.getElementsByTagNameNS(NS_XHTML, "img")) {
    if (!apunta(im)) continue;
    const w = parseFloat(im.getAttribute("width")), h = parseFloat(im.getAttribute("height"));
    if (w && h) { im.setAttribute("height", Math.round(w * img.alto / img.ancho)); cambiado = true; }
  }
  if (cambiado) libro.zip.file(pagina.ruta, serializar(doc, pagina.texto));
}

function htmlPortada(libro, rutaPagina, rutaImg, img) {
  const href = relativa(dirDe(rutaPagina), rutaImg);
  const doctype = libro.version >= 3 ? "<!DOCTYPE html>"
    : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';
  return `<?xml version="1.0" encoding="utf-8"?>
${doctype}
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<title>Portada</title>
<style type="text/css">html, body { margin: 0; padding: 0; height: 100%; text-align: center; } div { height: 100%; } svg { display: block; width: 100%; height: 100%; }</style>
</head>
<body>
<div><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="100%" height="100%" viewBox="0 0 ${img.ancho} ${img.alto}" preserveAspectRatio="xMidYMid meet"><image width="${img.ancho}" height="${img.alto}" xlink:href="${href}"/></svg></div>
</body>
</html>
`;
}

// Reescribe la página de portada existente o crea una nueva al principio del libro.
async function ponerPaginaPortada(libro, rutaImg, img) {
  const { opf, zip } = libro;
  let rutaPag = libro.portada.pagina?.ruta;
  let item = rutaPag && items(libro).find(i => rutaItem(libro, i) === rutaPag);
  if (!item) {
    rutaPag = rutaLibre(zip, libro.opfDir + "portada.xhtml");
    item = opf.createElementNS(NS_OPF, "item");
    item.setAttribute("id", idLibre(opf, "portada-pag"));
    item.setAttribute("href", relativa(libro.opfDir, rutaPag));
    item.setAttribute("media-type", "application/xhtml+xml");
    manifest(opf).appendChild(item);
    const spine = opf.getElementsByTagNameNS(NS_OPF, "spine")[0];
    const ref = opf.createElementNS(NS_OPF, "itemref");
    ref.setAttribute("idref", item.getAttribute("id"));
    spine.insertBefore(ref, spine.getElementsByTagNameNS(NS_OPF, "itemref")[0] || null);
    let guide = opf.getElementsByTagNameNS(NS_OPF, "guide")[0];
    if (!guide && libro.version < 3) {
      guide = opf.createElementNS(NS_OPF, "guide");
      opf.documentElement.appendChild(guide);
    }
    if (guide && ![...guide.getElementsByTagNameNS(NS_OPF, "reference")].some(r => r.getAttribute("type") === "cover")) {
      const r = opf.createElementNS(NS_OPF, "reference");
      r.setAttribute("type", "cover");
      r.setAttribute("title", "Portada");
      r.setAttribute("href", relativa(libro.opfDir, rutaPag));
      guide.appendChild(r);
    }
  }
  if (libro.version >= 3 && !tieneProp(item, "svg")) {
    item.setAttribute("properties", ((item.getAttribute("properties") || "") + " svg").trim());
  }
  zip.file(rutaPag, htmlPortada(libro, rutaPag, rutaImg, img));
}

// Un EPUB válido exige que "mimetype" sea el primer fichero y vaya sin comprimir.
async function empaquetar(zip) {
  const nuevo = new JSZip();
  nuevo.file("mimetype", "application/epub+zip", { compression: "STORE" });
  for (const [nombre, f] of Object.entries(zip.files)) {
    if (f.dir || nombre === "mimetype") continue;
    nuevo.file(nombre, await f.async("uint8array"), { date: f.date });
  }
  return nuevo.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 }, mimeType: "application/epub+zip" });
}
