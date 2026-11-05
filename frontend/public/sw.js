/* Canopy PWA SW — network-first HTML (no stale app shell); cache-first hashed assets only. */
const CACHE = "canopy-shell-v6";
const OFFLINE_SHELL = "/index.html";

self.addEventListener("install", (event) => {
  // Precache offline fallback only — never trust it over network when online
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_SHELL, "/manifest.webmanifest", "/favicon.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the service worker itself
  if (url.pathname === "/sw.js") {
    event.respondWith(fetch(request));
    return;
  }

  const isHtml =
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html") ||
    url.pathname === "/" ||
    url.pathname.endsWith(".html");

  if (isHtml) {
    // Network-only when online; offline fallback only. Do NOT write HTML into cache on success
    // (that previously left users on a stale shell after deploys).
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(() =>
        caches.match(OFFLINE_SHELL).then((r) => r || Response.error()),
      ),
    );
    return;
  }

  // Hashed /assets/* and /brand/* — cache-first (content-addressed or versioned)
  const cacheable =
    url.pathname.startsWith("/assets/") || url.pathname.startsWith("/brand/");

  if (!cacheable) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
