const CACHE = "life-os-shell-v1";
const SHELL = [
  "/",
  "/tasks",
  "/calendar",
  "/school",
  "/notes",
  "/more",
  "/manifest.webmanifest",
  "/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  ) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() =>
          caches
            .match(event.request)
            .then((response) => response || caches.match("/")),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (
            response.ok &&
            ["style", "script", "image", "font"].includes(
              event.request.destination,
            )
          ) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }),
    ),
  );
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
