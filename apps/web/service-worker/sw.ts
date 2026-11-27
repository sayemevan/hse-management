/// <reference lib="webworker" />
/**
 * PLT-25 (T-66): the service worker of a company subdomain. Bundled to `public/sw.js` by
 * `scripts/build-sw.mjs`.
 *
 * - Hashed static assets (`/_next/static/*`, fonts, icons): cache-first.
 * - Page navigations: network-first with a 3-second timeout, then the last cached copy of the
 *   page, then the offline page. Pages are the app shell: their data comes from the API.
 * - RSC payloads: network only; a failure makes the router fall back to a full navigation,
 *   which the rule above answers from the cache.
 * - `/api/*`: never handled, never cached (data offline lives in IndexedDB, PLT-26).
 */
declare const self: ServiceWorkerGlobalScope;
declare const __BUILD_ID__: string;

const BUILD = __BUILD_ID__;
/** Registered as `/sw.js?dev=1` by `next dev`: chunk names aren't hashed there. */
const DEV = new URL(self.location.href).searchParams.has('dev');
const STATIC_CACHE = `hse-static-${BUILD}`;
const PAGE_CACHE = `hse-pages-${BUILD}`;
const NAVIGATION_TIMEOUT_MS = 3000;
const OFFLINE_PAGE = '/offline';

type Message = { type: 'precache'; urls: string[] } | { type: 'skipWaiting' };

self.addEventListener('install', (event) => {
  // The offline page must exist before this version takes over.
  event.waitUntil(precache([OFFLINE_PAGE]).catch(() => undefined));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('hse-') && name !== STATIC_CACHE && name !== PAGE_CACHE) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data as Message | null;
  if (data?.type === 'skipWaiting') void self.skipWaiting();
  if (data?.type === 'precache') event.waitUntil(precache(data.urls).catch(() => undefined));
});

/** Background Sync (Chromium): wake an open tab, which holds the session and runs the queue. */
self.addEventListener('sync', (event) => {
  const syncEvent = event as Event & { tag?: string; waitUntil: (p: Promise<unknown>) => void };
  if (syncEvent.tag !== 'hse-sync') return;
  syncEvent.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) client.postMessage({ type: 'sync' });
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/sw.js') return;

  if (request.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) {
    event.respondWith(fetch(request).catch(() => Response.error()));
    return;
  }
  if (isStatic(url)) {
    event.respondWith(DEV ? networkFirstStatic(request) : cacheFirst(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(navigate(request, url, event));
  }
});

function isStatic(url: URL): boolean {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    /\.(?:woff2?|ttf|png|svg|ico|webp)$/.test(url.pathname)
  );
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function networkFirstStatic(request: Request): Promise<Response> {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? Response.error();
  }
}

/** Pages are cached by path: the query only selects filters inside the same shell. */
function pageKey(url: URL): string {
  return new URL(url.pathname, self.location.origin).href;
}

async function navigate(request: Request, url: URL, event: FetchEvent): Promise<Response> {
  const cache = await caches.open(PAGE_CACHE);
  const network = fetch(request).then(async (response) => {
    if (response.ok && (response.headers.get('content-type') ?? '').includes('text/html')) {
      await cache.put(pageKey(url), response.clone());
    }
    return response;
  });
  event.waitUntil(network.then(() => undefined).catch(() => undefined));
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => {
      resolve(null);
    }, NAVIGATION_TIMEOUT_MS);
  });
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
  } catch {
    // Offline: fall through to the cache.
  }
  const cached = (await cache.match(pageKey(url))) ?? (await cache.match(pageKey(new URL(OFFLINE_PAGE, url))));
  if (cached) return cached;
  // Slow network and nothing cached: keep waiting for it.
  return network.catch(
    () =>
      new Response('<!doctype html><meta charset="utf-8"><title>Offline</title><p>Offline.</p>', {
        status: 503,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
  );
}

/** Pages and the static files they load, so they open offline the first time (FR-3). */
async function precache(urls: string[]): Promise<void> {
  const pages = await caches.open(PAGE_CACHE);
  const assets = new Set<string>();
  for (const path of urls) {
    const url = new URL(path, self.location.origin);
    const response = await fetch(url.href, { credentials: 'same-origin' }).catch(() => null);
    if (!response?.ok) continue;
    const html = await response.clone().text();
    await pages.put(pageKey(url), response);
    // RSC payloads escape quotes (\"), so a backslash also ends the path.
    for (const match of html.matchAll(/["'](\/_next\/static\/[^"'\s?#\\]+)/g)) {
      if (match[1]) assets.add(match[1]);
    }
  }
  const statics = await caches.open(STATIC_CACHE);
  for (const asset of assets) {
    if (await statics.match(asset)) continue;
    const response = await fetch(asset).catch(() => null);
    if (response?.ok) await statics.put(asset, response);
  }
}
