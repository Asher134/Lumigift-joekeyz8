/* Lumigift service worker — offline caching strategy (issue #349).
 *
 * - API requests (/api/*):            network-first, fall back to last cached response.
 * - Page navigations (dashboard, gift detail): network-first, fall back to cache.
 * - Static assets (/_next/static, icons, fonts, images): cache-first.
 *
 * Only GET requests are cached; mutations (payments, claims) always hit the network.
 */
const VERSION = "v1";
const PAGE_CACHE = `lumigift-pages-${VERSION}`;
const API_CACHE = `lumigift-api-${VERSION}`;
const ASSET_CACHE = `lumigift-assets-${VERSION}`;
const PRECACHE_PAGES = ["/dashboard"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.addAll(PRECACHE_PAGES))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  const keep = [PAGE_CACHE, API_CACHE, ASSET_CACHE];
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isCacheablePage(pathname) {
  return pathname === "/dashboard" || /^\/gifts\/[^/]+$/.test(pathname);
}

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/apple-icon") ||
    /\.(?:png|jpg|jpeg|svg|webp|avif|woff2?|css|js)$/.test(pathname)
  );
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/auth/")) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE));
  } else if (request.mode === "navigate" && isCacheablePage(url.pathname)) {
    event.respondWith(networkFirst(request, PAGE_CACHE));
  } else if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});
