// Registra el service worker y avisa cuando hay una versión nueva.
if ("serviceWorker" in navigator) {
  const url = new URL("sw.js", new URL("./", import.meta.url)).pathname;
  navigator.serviceWorker.register(url).then(reg => {
    reg.addEventListener("updatefound", () => {
      const nuevo = reg.installing;
      nuevo && nuevo.addEventListener("statechange", () => {
        if (nuevo.state === "installed" && navigator.serviceWorker.controller) aviso(reg);
      });
    });
  }).catch(() => {});
  // Solo recarga cuando una versión nueva sustituye a otra; en la primera visita no
  // (si no, se perdería el libro que ya hayas elegido).
  const habiaControlador = !!navigator.serviceWorker.controller;
  let recargando = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (habiaControlador && !recargando) { recargando = true; location.reload(); } });
}
function aviso(reg) {
  if (document.getElementById("pwa-toast")) return;
  const t = document.createElement("div");
  t.id = "pwa-toast";
  t.style.cssText = "position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:#2c2a26;color:#fffdf8;padding:12px 16px;border-radius:10px;font:15px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3);display:flex;gap:12px;align-items:center;z-index:99;max-width:calc(100% - 32px)";
  t.innerHTML = `<span>Hay una versión nueva.</span><button style="font:inherit;font-weight:700;border:0;background:#fffdf8;color:#2c2a26;border-radius:6px;padding:8px 12px;cursor:pointer">Actualizar</button>`;
  t.querySelector("button").onclick = () => { reg.waiting ? reg.waiting.postMessage("skipWaiting") : location.reload(); };
  document.body.appendChild(t);
}
