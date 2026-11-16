const CACHE_STATIC_NAME = 'static-outbox-v1';
const STATIC_FILES = [
  './',
  './index.html',
  './styles.css',
  './db-helper.js',
  './app.js',
  './manifest.json'
];

// La práctica no incluye código del App Shell: instalación con precarga
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC_NAME)
      .then((cache) => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting())
  );
});

// Borra los cachés de versiones anteriores
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nombres) => {
        return Promise.all(
          nombres
            .filter((nombre) => nombre !== CACHE_STATIC_NAME)
            .map((nombre) => caches.delete(nombre))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Caché primero para el App Shell. Los POST y otros orígenes no se interceptan.
self.addEventListener('fetch', (event) => {
  const peticion = event.request;
  const url = new URL(peticion.url);

  if (peticion.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(peticion).then((enCache) => {
      if (enCache) return enCache;

      return fetch(peticion).catch(() => {
        if (peticion.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
