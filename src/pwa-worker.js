/* Vite prefixes the version and static filenames from this build. */
const scope = new URL(self.registration.scope);
const cachePrefix = `yachtlab-static-${scope.pathname}-`;
const cacheName = cachePrefix + BUILD;
const shell = new URL("index.html", scope).href;
const guide = new URL("guide/", scope).href;
const guideFile = new URL("guide/index.html", scope).href;
const staticFiles = new Set(ASSETS.map((file) => new URL(file, scope).href));
const optionalFiles = new Set(OPTIONAL_ASSETS.map((file) => new URL(file, scope).href));

self.addEventListener("install", (event) => {
  // Use one consistent build. A failed install leaves the previous worker/cache in place.
  const requests = [shell, ...staticFiles].map((url) => new Request(url, { cache: "reload", credentials: "omit" }));
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(requests)).catch(async (error) => {
    await caches.delete(cacheName);
    throw error;
  }));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith(cachePrefix) && key !== cacheName).map((key) => caches.delete(key)),
  )));
});

// This worker only serves the build's anonymous static resources. API requests, custom server URLs,
// version checks, OAuth redirects and navigation with query parameters fall through to the network.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("Authorization")) return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || url.search) return;
  if (request.mode === "navigate" && (url.pathname === scope.pathname || url.href === shell)) {
    event.respondWith(fetch(request).catch(async () => {
      const cached = await caches.match(shell, { cacheName });
      return cached ?? Response.error();
    }));
  } else if (request.mode === "navigate" && url.href === guide) {
    event.respondWith(fetch(request).catch(async () =>
      (await caches.match(guideFile, { cacheName })) ?? Response.error(),
    ));
  } else if (optionalFiles.has(url.href)) {
    event.respondWith(caches.open(cacheName).catch(() => null).then(async (cache) => {
      const cached = await cache?.match(url.href).catch(() => undefined);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache?.put(url.href, response.clone()).catch(() => undefined);
      return response;
    }));
  } else if (staticFiles.has(url.href)) {
    event.respondWith(caches.match(url.href, { cacheName }).then((cached) => cached ?? fetch(request)));
  }
});
