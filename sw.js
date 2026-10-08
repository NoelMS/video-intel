// Only job: if the app is opened (e.g. from the installed icon) while the local server is down,
// show offline.html with instructions instead of a browser error. Everything else goes to the network.
self.addEventListener('install', e => e.waitUntil(caches.open('vi-offline-v4').then(c => c.add('offline.html')).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') e.respondWith(fetch(e.request).catch(() => caches.match('offline.html')));
});
