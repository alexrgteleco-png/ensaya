/* Service worker de Ensaya: guarda los recursos de la app y las páginas de modo escenario
 * que el usuario marca como "sin conexión", para poder usarlas en salas sin cobertura. */
const STATIC = 'ensaya-static';
const PAGES = 'ensaya-pages';
const VERSION = 'v1';
const CORE = ['/styles.css', '/app.js', '/chordpro.js', '/stage.js', '/tools.js', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = await caches.match(`/__version_${VERSION}`);
      if (!keep) {
        const c = await caches.open(STATIC);
        await Promise.all(CORE.map((u) => c.add(u).catch(() => {})));
        await c.put(`/__version_${VERSION}`, new Response('ok'));
      }
      await self.clients.claim();
    })()
  );
});

const OFFLINE_HTML = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sin conexión · Ensaya</title><link rel="stylesheet" href="/styles.css">
<body><main class="shell"><section class="narrow" style="padding:48px 0"><h1>Sin conexión</h1>
<p class="lead">Esta página no está guardada en el dispositivo. Los modos escenario que guardaste con «Guardar sin conexión» sí funcionan.</p>
<p><a class="button" href="/">Reintentar</a></p></section></main></body></html>`;

function isStatic(url) {
  return /\.(css|js|mjs|svg|png|webmanifest|woff2)$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/contenido') || url.pathname.startsWith('/auth/') || url.pathname === '/login') return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          // Si esta página estaba guardada para usar sin conexión, se actualiza la copia.
          if (res.ok && res.type === 'basic') {
            const cache = await caches.open(PAGES);
            if (await cache.match(url.pathname)) cache.put(url.pathname, res.clone());
          }
          return res;
        } catch (err) {
          const cached = await caches.match(url.pathname, { cacheName: PAGES });
          if (cached) return cached;
          return new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
      })()
    );
    return;
  }

  if (isStatic(url)) {
    event.respondWith(
      (async () => {
        // Primero la red (así cada despliegue llega al momento); la copia solo sin conexión.
        const cache = await caches.open(STATIC);
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (err) {
          return (await cache.match(req)) || new Response('', { status: 504 });
        }
      })()
    );
  }
});
