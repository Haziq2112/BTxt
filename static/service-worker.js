// Minimal service worker — its main job is just existing, since browsers
// require one to be registered before they'll consider a site "installable".
// It doesn't try to cache/serve anything offline yet; that's a bigger
// project for later if wanted.

self.addEventListener("install", function (event) {
    self.skipWaiting();
});

self.addEventListener("activate", function (event) {
    self.clients.claim();
});

self.addEventListener("fetch", function (event) {
    // Pass everything straight through to the network.
    event.respondWith(fetch(event.request));
});
