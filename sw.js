// OrbicXs — service worker. Faqat push bildirishnomalar uchun.
// Hech narsani keshlamaydi, shuning uchun sayt yangilansa eski nusxa qolib ketmaydi.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const tag = 'orbicxs-' + Date.now();
  const options = {
    body: data.body || 'Yangi xabar',
    icon: 'icon-192.png',
    badge: 'badge-96.png',
    tag,
    data: { url: data.url || './' },
  };

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appIsOpen = wins.some((w) => w.visibilityState === 'visible');

    // Safari har bir pushda bildirishnoma ko'rsatilishini talab qiladi. Ilova ochiq bo'lsa,
    // uni ovozsiz ko'rsatamiz va bir zumdan keyin yopamiz.
    await self.registration.showNotification(data.title || 'OrbicXs', appIsOpen ? { ...options, silent: true } : options);
    if (appIsOpen) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const shown = await self.registration.getNotifications({ tag });
      shown.forEach((n) => n.close());
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  let target = self.registration.scope;
  try {
    const u = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope);
    if (u.origin === self.location.origin) target = u.href;
  } catch (e) { /* standart manzil */ }

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope) && 'focus' in w) return w.focus();
    }
    return self.clients.openWindow(target);
  })());
});
