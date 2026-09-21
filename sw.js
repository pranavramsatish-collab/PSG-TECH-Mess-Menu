/* PSG Tech Mess Menu — service worker.

   Two jobs:
     1. Make the app installable (Chrome on Android wants a fetch handler before it
        offers "Add to Home Screen").
     2. Keep the menu readable with no signal — hostel wifi being what it is. The menu
        is static data baked into index.html, so caching the shell is enough.

   Bump CACHE_VERSION whenever you deploy, or returning users keep the old shell until
   their browser happens to revalidate. */
const CACHE_VERSION = 'v24';
const CACHE_NAME = `psg-mess-${CACHE_VERSION}`;

// Relative, not absolute. If this is ever served from a sub-path (GitHub Pages puts
// sites under /<repo-name>/), a leading slash would point at the domain root and
// silently cache nothing.
//
// One page: the whole tabbed app (Today / Week / Find / You / About) is a single
// document, routed by hash, so caching index.html covers every view.
const SHELL = [
  './',
  './index.html',
  // Sign-in gates the whole app now, so the auth library has to be part of the
  // offline shell. Loaded from a CDN it would be a cross-origin request this
  // worker deliberately does not touch — and on hostel wifi, a script that
  // fails to load is a blank app rather than a cached menu.
  './supabase.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

// Ratings, complaints and auth must always hit the network — never serve a cached
// answer. Supabase is cross-origin, so the handler below already leaves it alone;
// this stays as a named, explicit exclusion rather than an accident of origin.
const API_HOST = 'ryxpakwvkeddixwjsono.supabase.co';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())        // take over as soon as the new SW is ready
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('psg-mess-') && k !== CACHE_NAME)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                      // POSTs go straight to the network

  const url = new URL(req.url);
  if (url.hostname === API_HOST) return;                 // live data, never cached

  // Navigations: network first so a fresh deploy shows up on next load, cache as fallback.
  // Cache under the actual request URL, not a fixed page — otherwise visiting app.html
  // would overwrite the cached landing page, and an offline visit to one would serve
  // the other.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // Cross-origin (Google Fonts) is left entirely alone — no respondWith, no interception.
  //
  // It used to go through the cache-first branch below, where a failed fetch resolved to
  // `undefined` on a cold cache and respondWith(undefined) threw, so one offline font
  // request produced two console errors instead of one. Handing it back to the browser
  // means a font failure looks exactly like it would with no service worker at all, and
  // the HTTP cache still covers repeat visits. A missing webfont only falls back to the
  // system font stack; nothing about the app depends on it.
  if (url.origin !== self.location.origin) return;

  // Same-origin assets (icons): serve from cache, refresh in the background.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return res;
      });
      // Promise.resolve() because `cached` is a Response, not a thenable. If there's no
      // cached copy the network promise is returned as-is, so a genuine failure surfaces
      // as one honest error rather than a swallowed undefined.
      return cached ? Promise.resolve(cached) : network;
    })
  );
});
