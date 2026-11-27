// OrbicXs — xizmat ishchisi (service worker). Faqat bildirishnoma uchun; hech narsa keshlanmaydi, tarmoq so'rovlariga aralashilmaydi.
//
// Push-xizmatidan (Google, Apple, Mozilla) MATNSIZ turtki keladi: xabar matni ham, kim yozgani ham ularning serverlaridan o'tmaydi.
// Shuning uchun bu yerda har doim umumiy «Yangi xabar» ko'rsatiladi. Xabarning o'zini sahifa ochilganda o'z tokeni bilan oladi.

const TITLE = "OrbicXs";
const BODY = "Yangi xabar";
const TAG = "ox-message";

// «Sinov yuborish» bosilganda sahifa shuni aytadi («ox-expect-test»): shundan keyin 30 soniya ichida kelgan turtki sahifa fokusda
// bo'lsa ham ko'rsatiladi — aks holda odam sinov natijasini ko'rmaydi. Xotirada turadi; ishchi to'xtab qolsa, yo'qoladi (zarari yo'q).
const TEST_WINDOW_MS = 30000;
let testUntil = 0;

self.addEventListener("message", (event) => {
  const d = event && event.data;
  if (d && typeof d === "object" && d.type === "ox-expect-test") testUntil = Date.now() + TEST_WINDOW_MS;
});

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function windows() {
  try {
    return await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  } catch {
    return [];
  }
}

// Safari har bir turtki uchun bildirishnoma ko'rsatishni talab qiladi (aks holda obunani bekor qiladi). Aniqlay olmasak — ko'rsatamiz.
async function isApple() {
  try {
    const sub = await self.registration.pushManager.getSubscription();
    return !sub || /(^|\.)push\.apple\.com$/.test(new URL(sub.endpoint).hostname);
  } catch {
    return true;
  }
}

async function onPush() {
  const list = await windows();
  // Ochiq sahifalar xabarni o'zi tezda yangilab oladi
  for (const c of list) {
    try {
      c.postMessage({ type: "ox-push" });
    } catch {
      /* e'tibor berilmaydi */
    }
  }
  // Foydalanuvchi shu sahifaga qarab turgan bo'lsa, ustiga bildirishnoma chiqarmaymiz (Safari va sinov bundan mustasno)
  const watching = list.some((c) => c.visibilityState === "visible" && c.focused);
  if (watching && Date.now() >= testUntil && !(await isApple())) return;
  await self.registration.showNotification(TITLE, {
    body: BODY,
    tag: TAG,
    renotify: true,
    icon: "icon-192.png",
    badge: "badge-96.png",
    lang: "uz",
    timestamp: Date.now(),
  });
  try {
    if (self.navigator && self.navigator.setAppBadge) await self.navigator.setAppBadge();
  } catch {
    /* ilova belgisi hamma joyda qo'llab-quvvatlanmaydi */
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(onPush());
});

async function openApp() {
  const base = self.registration.scope;
  const list = await windows();
  const mine = list.find((c) => c.url && c.url.startsWith(base));
  if (mine) {
    try {
      await mine.focus();
    } catch {
      /* e'tibor berilmaydi */
    }
    try {
      mine.postMessage({ type: "ox-open-chat" });
    } catch {
      /* e'tibor berilmaydi */
    }
    return;
  }
  try {
    await self.clients.openWindow(new URL("#/chat", base).href);
  } catch {
    /* ba'zi brauzerlar bunga ruxsat bermaydi: foydalanuvchi ilovani o'zi ochadi */
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openApp());
});

// Brauzer obunani yangilagan yoki bekor qilgan: sahifa ochiq bo'lsa, u obunani qaytadan ro'yxatdan o'tkazadi.
// (Bu yerda buni qila olmaymiz: bazaga yozish uchun foydalanuvchi tokeni kerak, u faqat sahifada bor.)
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      for (const c of await windows()) {
        try {
          c.postMessage({ type: "ox-push-changed" });
        } catch {
          /* e'tibor berilmaydi */
        }
      }
    })(),
  );
});
