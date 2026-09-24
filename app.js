import { leerEpub, portadaActual, formatoDestino, cambiarPortada } from "./portada.js";

export const VERSION = "1.0";
const MAX_LADO = 2400; // más que suficiente para cualquier lector; evita EPUB enormes

const $ = id => document.getElementById(id);
let libro = null, nombreEpub = "", fichImg = null, resultado = null, urlDespues = null;

$("version").textContent = "Versión " + VERSION;

function error(id, msg) { const e = $(id); e.textContent = msg || ""; e.hidden = !msg; }
function listo() { $("b-cambiar").disabled = !(libro && fichImg); }
function reiniciarResultado() { resultado = null; $("resultado").hidden = true; error("err-final"); }

function miniatura(blob, texto) {
  if (!blob) {
    const d = document.createElement("div");
    d.className = "mini vacia";
    d.textContent = texto || "Sin portada";
    return d;
  }
  const im = document.createElement("img");
  im.className = "mini";
  im.alt = "";
  im.src = URL.createObjectURL(blob);
  return im;
}

$("f-epub").addEventListener("change", async e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  reiniciarResultado(); error("err-epub"); $("info-epub").replaceChildren();
  libro = null; listo();
  try {
    libro = await leerEpub(await f.arrayBuffer());
    nombreEpub = f.name.replace(/\.epub$/i, "") || "libro";
    const d = document.createElement("div");
    d.className = "datos";
    d.innerHTML = "<b></b><span></span>";
    d.querySelector("b").textContent = libro.titulo || nombreEpub;
    d.querySelector("span").textContent = (libro.autor ? libro.autor + " · " : "") +
      (libro.portada.item ? "tiene portada" : "no tiene portada; le pondré una");
    $("info-epub").replaceChildren(miniatura(await portadaActual(libro)), d);
    $("b-epub").textContent = "Elegir otro EPUB";
  } catch (err) {
    libro = null;
    error("err-epub", err.message);
  }
  listo();
});

$("f-img").addEventListener("change", async e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  reiniciarResultado(); error("err-img");
  fichImg = f;
  const d = document.createElement("div");
  d.className = "datos";
  try {
    const bm = await cargarImagen(f);
    URL.revokeObjectURL(bm.src);
    d.innerHTML = "<b></b><span></span>";
    d.querySelector("b").textContent = f.name;
    const forma = bm.naturalWidth / bm.naturalHeight;
    d.querySelector("span").textContent = `${bm.naturalWidth} × ${bm.naturalHeight} px` +
      (forma > 0.8 || forma < 0.55 ? " · no tiene forma de libro: quizá te convenga recortar" : "");
    $("info-img").replaceChildren(miniatura(f), d);
    $("b-img").textContent = "Elegir otra imagen";
  } catch {
    fichImg = null;
    $("info-img").replaceChildren();
    error("err-img", "No puedo abrir esa imagen. Prueba con una JPG o PNG.");
  }
  listo();
});

$("recortar").addEventListener("change", reiniciarResultado);

function cargarImagen(file) {
  return new Promise((ok, mal) => {
    const im = new Image();
    const url = URL.createObjectURL(file);
    im.onload = () => { ok(im); };
    im.onerror = () => { URL.revokeObjectURL(url); mal(new Error("imagen")); };
    im.src = url;
  });
}

// Redimensiona (y recorta a 2:3 si se pide) y codifica en el formato que toca.
async function prepararImagen(file, mime, recortar) {
  const im = await cargarImagen(file);
  let sx = 0, sy = 0, sw = im.naturalWidth, sh = im.naturalHeight;
  if (recortar) {
    const objetivo = 2 / 3;
    if (sw / sh > objetivo) { const nw = Math.round(sh * objetivo); sx = Math.round((sw - nw) / 2); sw = nw; }
    else { const nh = Math.round(sw / objetivo); sy = Math.round((sh - nh) / 2); sh = nh; }
  }
  const escala = Math.min(1, MAX_LADO / Math.max(sw, sh));
  const ancho = Math.round(sw * escala), alto = Math.round(sh * escala);
  const c = document.createElement("canvas");
  c.width = ancho; c.height = alto;
  const ctx = c.getContext("2d");
  if (mime === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, ancho, alto); }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(im, sx, sy, sw, sh, 0, 0, ancho, alto);
  URL.revokeObjectURL(im.src);
  const blob = await new Promise(ok => c.toBlob(ok, mime, 0.9));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, ancho, alto };
}

$("b-cambiar").addEventListener("click", async () => {
  const b = $("b-cambiar");
  b.disabled = true; b.textContent = "Cambiando…";
  reiniciarResultado();
  try {
    const antes = await portadaActual(libro);
    const img = await prepararImagen(fichImg, formatoDestino(libro), $("recortar").checked);
    const datos = await cambiarPortada(libro, img);
    // Compruebo el resultado releyéndolo: lo que enseño es lo que de verdad lleva el EPUB nuevo.
    const comprobado = await leerEpub(datos);
    const despues = await portadaActual(comprobado);
    if (!despues) throw new Error("El EPUB nuevo no tiene portada; algo ha fallado.");
    resultado = new File([datos], nombreEpub + ".epub", { type: "application/epub+zip" });
    $("antes").replaceChildren(miniatura(antes));
    if (urlDespues) URL.revokeObjectURL(urlDespues);
    $("despues").src = urlDespues = URL.createObjectURL(despues);
    $("b-compartir").hidden = !(navigator.canShare && navigator.canShare({ files: [resultado] }));
    $("resultado").hidden = false;
    // El libro abierto ya está modificado en memoria: lo recargo del resultado para poder repetir.
    libro = comprobado;
  } catch (err) {
    error("err-final", "No he podido cambiar la portada: " + err.message);
  }
  b.textContent = "Cambiar portada";
  listo();
});

$("b-compartir").addEventListener("click", async () => {
  try { await navigator.share({ files: [resultado], title: resultado.name }); }
  catch (err) { if (err.name !== "AbortError") error("err-final", "No se pudo compartir: " + err.message); }
});

$("b-descargar").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(resultado);
  a.download = resultado.name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
});
