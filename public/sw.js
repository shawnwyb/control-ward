// Receives web push messages and focuses the app when one is tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "PlanIT", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "PlanIT";
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: data.body || "",
        tag: data.tag,
        renotify: Boolean(data.renotify),
        icon: "/icon.svg",
        badge: "/icon.svg",
        requireInteraction: Boolean(data.urgent),
        data: { siteId: data.siteId },
      }),
      // Open app windows show the message too, in case the OS hides system notifications.
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((windows) =>
          windows.forEach((client) =>
            client.postMessage({
              type: "push",
              title,
              body: data.body || "",
              kind: data.kind,
              urgent: Boolean(data.urgent),
            }),
          ),
        ),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows)
          if ("focus" in client) return client.focus();
        return self.clients.openWindow("/");
      }),
  );
});
