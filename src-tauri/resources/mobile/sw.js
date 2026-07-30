/* Minimal service worker — network-first passthrough.
 *
 * Exists so the PWA is installable on secure origins; it deliberately caches
 * NOTHING (state must always be live, and no projection data should persist
 * in a cache on the phone). Registration is skipped on insecure LAN origins.
 */
self.addEventListener('install', function () {
  self.skipWaiting();
});
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', function () {
  // Fall through to the network. No respondWith → default handling.
});
