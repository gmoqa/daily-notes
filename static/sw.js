const CACHE = 'v1';
const ASSETS = ['/', '/static/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  if (!url.protocol.startsWith('http')) return;

  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(request).catch(() =>
      new Response(JSON.stringify({error: 'offline'}), {
        headers: {'Content-Type': 'application/json'},
        status: 503
      })
    ));
    return;
  }

  e.respondWith(
    fetch(request)
      .then(res => {
        if (res.status === 200) {
          caches.open(CACHE).then(cache => cache.put(request, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(request).then(res => res || caches.match('/')))
  );
});
