// Service worker de Portadas EPUB. Cambia CACHE en cada versión que toque ficheros cacheados.
const CACHE = "portadas-epub-v1";
const PRECACHE = [
  "./", "./index.html", "./app.js", "./portada.js", "./pwa.js", "./vendor/jszip.min.js",
  "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png",
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Red primero (para tener siempre lo último); si no hay red, caché.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("./index.html")))
  );
});
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });
