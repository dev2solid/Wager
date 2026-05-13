const CACHE_NAME = "wager-shell-v2";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];
const BADGE_ICON = "/icon-192.png";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || fresh;
    })
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Wager", body: event.data?.text() || "New Wager activity." };
  }

  const title = data.title || "Wager";
  const options = {
    body: data.body || "New activity in your circle.",
    icon: data.icon || BADGE_ICON,
    badge: data.badge || BADGE_ICON,
    tag: data.tag || `wager-${Date.now()}`,
    renotify: true,
    data: {
      url: data.url || "/",
      eventId: data.eventId || null,
    },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      self.navigator?.setAppBadge ? self.navigator.setAppBadge(1).catch(() => {}) : Promise.resolve(),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    Promise.all([
      self.navigator?.clearAppBadge ? self.navigator.clearAppBadge().catch(() => {}) : Promise.resolve(),
      clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
        const existing = clientList.find((client) => client.url.startsWith(self.location.origin));
        if (existing) {
          existing.focus();
          existing.navigate(targetUrl);
          return;
        }
        return clients.openWindow(targetUrl);
      }),
    ])
  );
});
