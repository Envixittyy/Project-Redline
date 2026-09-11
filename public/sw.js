const CACHE_PREFIXES = ["life-os-", "redline-"];
const STATIC_CACHE = "redline-static-v2";
const PUBLIC_STATIC_ASSETS = ["/manifest.webmanifest", "/favicon.ico"];

function isRedlineCache(name) {
  return CACHE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function isPublicStaticRequest(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    PUBLIC_STATIC_ASSETS.includes(url.pathname)
  );
}

async function deleteUnsafeCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => isRedlineCache(key) && key !== STATIC_CACHE)
      .map((key) => caches.delete(key)),
  );
}

function offlineNavigationResponse() {
  return new Response("You are offline. Sign in again when the network is available.", {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PUBLIC_STATIC_ASSETS))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    deleteUnsafeCaches(),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(offlineNavigationResponse));
    return;
  }

  if (url.pathname.startsWith("/api/") || !isPublicStaticRequest(url)) {
    return;
  }

  event.respondWith(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (response.ok && response.type !== "opaque") {
            const copy = response.clone();
            event.waitUntil(cache.put(event.request, copy));
          }
          return response;
        }),
      ),
    ),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CLEAR_PRIVATE_PWA_STATE") return;
  const cleanup = deleteUnsafeCaches();
  event.waitUntil(cleanup);
  cleanup.finally(() => event.ports?.[0]?.postMessage({ ok: true }));
});

function safeNotificationUrl(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/";
  }

  try {
    const target = new URL(value, self.location.origin);
    if (target.origin !== self.location.origin) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    // A malformed payload still produces a generic user-visible notification.
  }

  const title =
    typeof data.title === "string" ? data.title.slice(0, 100) : "Forward";
  const body =
    typeof data.body === "string"
      ? data.body.slice(0, 240)
      : "You have an update.";
  const url = safeNotificationUrl(data.url);
  const tag =
    typeof data.dedupeKey === "string"
      ? data.dedupeKey.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32)
      : undefined;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      data: { url },
      tag,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    safeNotificationUrl(event.notification.data?.url),
    self.location.origin,
  );

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const existing = windows.find(
          (client) => new URL(client.url).origin === target.origin,
        );
        if (existing) {
          return existing.navigate(target.href).then(() => existing.focus());
        }
        return clients.openWindow(target.href);
      }),
  );
});
