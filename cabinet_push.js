// Kabinet → «Bildirishnomalar»: shu qurilmada yoqish/o'chirish, sinov, umumiy tugma, qurilmalar ro'yxati, ovozsiz suhbatlar.
// Hamma holat bazadan (ox_push_state) va brauzerdan (ruxsat, obuna) o'qiladi; saytda «eslab» qolinadigan narsa yo'q.
import { add, clear, h, icon, fmtDate, relTime } from "../dom.js";
import { busy, errorText, toast } from "../ui.js";
import * as push from "../push.js";
import * as chat from "../chatapi.js";

const fill = (el, ...kids) => add(clear(el), kids); // native replaceChildren(null) «null» matnini qo'yadi, h() esa bo'sh qiymatlarni o'tkazib yuboradi
const deviceIco = (label) => (/Android|iOS/.test(String(label || "")) ? "phone" : "monitor");
const p2 = (n) => String(n).padStart(2, "0");

function untilText(until) {
  const d = until ? new Date(until) : null;
  if (!d || Number.isNaN(d.getTime())) return "doimiy";
  const hm = p2(d.getHours()) + ":" + p2(d.getMinutes());
  return d.toDateString() === new Date().toDateString() ? "bugun " + hm + " gacha" : fmtDate(until) + " gacha";
}

export function pushSection(ctx) {
  const acc = ctx.account;
  const el = h(
    "div",
    { class: "pushsec" },
    h("p", { class: "section__sub" }, "Yangi xabar kelganda qurilmangizga «Yangi xabar» deb bildirishnoma keladi. Kim yozgani va xabar matni bildirishnomada ko'rinmaydi: ularni saytni ochganingizda o'zingiz ko'rasiz."),
  );

  if (!Array.isArray(acc.permissions) || !acc.permissions.includes("messenger")) {
    el.append(h("div", { class: "notice" }, "Hozircha bildirishnomalar faqat Xabarlar uchun ishlaydi. Sizda «Messenjer» ruxsati yo'q, shuning uchun bu yerda sozlanadigan narsa yo'q."));
    return { el, show() {}, hide() {}, dispose() {} };
  }

  let data = null; // {local, st, mutes}; null — hali yuklanmagan
  let error = null;
  let disposed = false;
  let shown = true; // kabinetning boshqa bo'limi ochiq turganda tarmoqqa chiqmaymiz
  let running = null;
  let again = false;
  let lastAt = 0;

  const here = h("div", { class: "pcard", dataset: { state: "loading" } });
  const all = h("div", { class: "pall", hidden: true });
  const devWrap = h("div", { class: "sesswrap", hidden: true });
  const mutedWrap = h("div", { class: "sesswrap", hidden: true });
  const failBox = h("div", { class: "empty empty--tight", hidden: true });
  el.append(here, all, devWrap, mutedWrap, failBox);

  // ---- ko'rinish ----
  function paintHere() {
    const sup = push.supportInfo();
    const perm = push.permission();
    const { local, st } = data;
    const cur = st.devices.find((d) => d.current) || null;
    const active = !!local && !!cur && cur.active === true;
    let kind;
    let status;
    let note = "";
    const acts = [];

    if (!sup.ok) {
      kind = "na";
      status = "Bu qurilmada ishlamaydi";
      note = push.SUPPORT_TEXT[sup.reason];
    } else if (perm === "denied") {
      kind = "bad";
      status = "Brauzerda bloklangan";
      note = "Brauzer bu sayt uchun bildirishnomalarni bloklagan. Manzil satridagi qulf (yoki sozlamalar) belgisini bosing, «Bildirishnomalar»ni «Ruxsat berish»ga o'zgartiring. Shundan so'ng bu yerdagi tugma ishlaydi.";
      acts.push(h("button", { class: "btn btn--ghost", type: "button", dataset: { act: "push-recheck" }, onclick: () => refresh(true) }, icon("refresh"), "Qayta tekshirish"));
    } else if (active) {
      kind = st.enabled ? "on" : "paused";
      status = st.enabled ? "Yoqilgan" : "Vaqtincha to'xtatilgan";
      if (!st.enabled) note = "Bildirishnomalar hamma qurilmangizda to'xtatilgan. Quyidagi «Bildirishnomalarni qabul qilish» tugmasi orqali qayta yoqing.";
      if (st.enabled) {
        const test = h("button", { class: "btn btn--ghost", type: "button", dataset: { act: "push-test" } }, icon("send"), "Sinov yuborish");
        test.addEventListener("click", () => doTest(test, cur));
        acts.push(test);
      }
      const off = h("button", { class: "btn btn--quiet", type: "button", dataset: { act: "push-disable" } }, "Bu qurilmada o'chirish");
      off.addEventListener("click", () => doDisable(off));
      acts.push(off);
    } else {
      kind = "off";
      const relink = !!local && !!cur;
      status = relink ? "Qayta ulash kerak" : "O'chiq";
      if (relink) note = "Bu qurilma boshqa seansga bog'langan edi. Qayta ulang.";
      const on = h("button", { class: "btn btn--primary", type: "button", dataset: { act: "push-enable" } }, icon("bell"), relink ? "Qayta ulash" : "Shu qurilmada yoqish");
      on.addEventListener("click", () => doEnable(on)); // ruxsat so'rovi tugma bosilgan zahoti boshlanishi kerak (iPhone)
      acts.push(on);
    }

    here.dataset.state = kind;
    fill(
      here,
      h("span", { class: "pring pring--" + kind, "aria-hidden": "true" }, icon(kind === "on" ? "bell" : "belloff")),
      h("div", { class: "pcard__main" }, h("h3", null, "Shu qurilma"), h("p", { class: "pcard__status", role: "status" }, status)),
      note ? h("p", { class: "pcard__help" }, note) : null,
      acts.length ? h("div", { class: "pcard__acts" }, acts) : null,
    );
  }

  function paintAll() {
    const { st } = data;
    all.hidden = !(st.devices.length > 0 || !st.enabled);
    if (all.hidden) {
      fill(all); // yashirin blokda eski tarkib qolmasin
      return;
    }
    const labelId = "push-all-label";
    const sw = h("button", { class: "switch", type: "button", role: "switch", "aria-checked": String(st.enabled), "aria-labelledby": labelId, dataset: { act: "push-master" } }, h("span", { class: "switch__knob", "aria-hidden": "true" }));
    sw.addEventListener("click", () => doMaster(sw, !st.enabled));
    fill(
      all,
      h("div", { class: "pall__text" }, h("span", { class: "pall__label", id: labelId }, "Bildirishnomalarni qabul qilish"), h("span", { class: "field__hint" }, "O'chirsangiz, hech bir qurilmangizga bildirishnoma kelmaydi. Qurilmalar ro'yxatda qoladi.")),
      sw,
    );
  }

  function paintDevices() {
    const { st } = data;
    devWrap.hidden = st.devices.length === 0;
    if (devWrap.hidden) {
      fill(devWrap);
      return;
    }
    const rows = st.devices.map((d) => {
      const rm = h("button", { class: "btn btn--ghost btn--sm", type: "button", dataset: { act: "push-remove" }, "aria-label": "Qurilmani olib tashlash — " + d.label }, "Olib tashlash");
      rm.addEventListener("click", () => doRemove(rm, d));
      return h(
        "div",
        { class: "sess__row", role: "listitem", dataset: { did: d.id, current: d.current ? "true" : "false" } },
        h("span", { class: "sess__ico", "aria-hidden": "true" }, icon(deviceIco(d.label))),
        h(
          "div",
          { class: "sess__main" },
          h("div", { class: "sess__title" }, h("span", { class: "sess__name", title: d.label }, d.label), d.current ? h("span", { class: "who__you" }, "Shu qurilma") : null, d.fail_count > 0 ? h("span", { class: "who__you who__you--bad" }, "Yetkazilmayapti") : null),
          h("div", { class: "sess__meta" }, h("span", null, "Qo'shilgan: " + fmtDate(d.created_at)), h("span", null, d.last_ok_at ? "Oxirgi bildirishnoma: " + relTime(d.last_ok_at) : "Hali bildirishnoma yetkazilmagan")),
        ),
        rm,
      );
    });
    fill(devWrap, h("h3", { class: "pall__h" }, "Bildirishnoma oladigan qurilmalar (" + st.devices.length + " / " + st.max + ")"), h("div", { class: "sess", role: "list", "aria-label": "Bildirishnoma oladigan qurilmalar" }, rows));
  }

  function paintMuted() {
    const list = data.mutes;
    mutedWrap.hidden = list.length === 0;
    if (!list.length) {
      fill(mutedWrap);
      return;
    }
    const rows = list.map((m) => {
      const b = h("button", { class: "btn btn--ghost btn--sm", type: "button", dataset: { act: "push-unmute" }, "aria-label": "Ovozni yoqish — " + m.name }, "Ovozni yoqish");
      b.addEventListener("click", () => doUnmute(b, m));
      return h(
        "div",
        { class: "sess__row", role: "listitem", dataset: { cid: m.id } },
        h("span", { class: "sess__ico", "aria-hidden": "true" }, icon("belloff")),
        h("div", { class: "sess__main" }, h("div", { class: "sess__title" }, h("span", { class: "sess__name", title: m.name }, m.name)), h("div", { class: "sess__meta" }, h("span", null, "Ovozsiz: " + untilText(m.until)))),
        b,
      );
    });
    fill(mutedWrap, h("h3", { class: "pall__h" }, "Ovozsiz suhbatlar"), h("div", { class: "sess", role: "list", "aria-label": "Ovozsiz suhbatlar" }, rows));
  }

  function paint() {
    if (disposed) return;
    if (!data) {
      all.hidden = true;
      devWrap.hidden = true;
      mutedWrap.hidden = true;
      if (error) {
        here.hidden = true;
        failBox.hidden = false;
        fill(failBox, h("p", null, errorText(error)), error.code === "push_missing" ? null : h("button", { class: "btn btn--ghost", type: "button", onclick: () => refresh(true) }, icon("refresh"), "Qayta urinish"));
      } else {
        here.hidden = false;
        here.dataset.state = "loading";
        failBox.hidden = true;
        fill(here, h("div", { class: "skel skel--short" }), h("div", { class: "skel skel--short" }));
      }
      return;
    }
    here.hidden = false;
    failBox.hidden = true;
    paintHere();
    paintAll();
    paintDevices();
    paintMuted();
  }

  // ---- ma'lumot ----
  async function mutedList() {
    try {
      const [ms, chats] = await Promise.all([push.loadMutes(), chat.listChats()]);
      const byId = new Map(chats.items.map((it) => [it.id, it]));
      const out = [];
      for (const m of ms) {
        const it = byId.get(m.conversation_id);
        const until = m.until ? Date.parse(m.until) : 0;
        if (!it || (until && until <= Date.now())) continue;
        out.push({ id: m.conversation_id, until: m.until || null, name: it.kind === "group" ? it.title || "Guruh" : it.peer && it.peer.name ? it.peer.name : "Suhbat" });
      }
      return out;
    } catch (e) {
      if (e && e.fatal) throw e;
      return []; // ovozsiz suhbatlar ro'yxati bo'lmasa ham, asosiy sozlamalar ishlayveradi
    }
  }

  async function load() {
    try {
      await push.synced(); // jim tiklash tugashini kutamiz: qayta kirgan brauzerning qurilmasi yangi seansga o'tsin
      const local = await push.localSubscription();
      const [st, mutes] = await Promise.all([push.loadState(local ? local.endpoint : null), mutedList()]);
      if (disposed) return;
      data = { local, st, mutes };
      error = null;
    } catch (e) {
      if (disposed || (e && e.fatal)) return;
      error = e; // oldingi ma'lumot bo'lsa, u ko'rinishda qoladi (data o'zgarmaydi)
    }
    lastAt = Date.now();
    paint();
  }

  // Bir vaqtda bitta so'rov: ketma-ket chaqiruvlar bitta qo'shimcha yangilanishga birlashadi
  function refresh(force = false) {
    if (disposed) return Promise.resolve();
    if (!force && Date.now() - lastAt < 2500 && !running) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await load();
      } while (again && !disposed);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  // ---- amallar ----
  // Natija (muvaffaqiyat yoki xato) toast bilan aytiladi; holat o'zgargan bo'lsa, push.onChange() orqali yangilanadi
  const guard = async (fn) => {
    try {
      await fn();
    } catch (e) {
      if (e && e.fatal) return;
      toast("error", errorText(e));
    }
  };

  function doEnable(btn) {
    // DIQQAT: busy() funksiyani darhol chaqiradi; enableHere() ruxsatni birinchi amal sifatida so'raydi (iPhone shuni talab qiladi).
    return busy(btn, () =>
      guard(async () => {
        await push.enableHere();
        toast("ok", "Bildirishnoma shu qurilmada yoqildi.");
      }),
    );
  }

  const doDisable = (btn) =>
    busy(btn, () =>
      guard(async () => {
        await push.disableHere();
        toast("ok", "Bu qurilmada bildirishnoma o'chirildi.");
      }),
    );

  const doTest = (btn, dev) =>
    busy(btn, () =>
      guard(async () => {
        const r = await push.sendTest(dev.id);
        if (r.delivered > 0) toast("ok", "Sinov yuborildi. Bildirishnoma bir necha soniyada ko'rinadi.");
        else if (r.removed > 0) toast("warn", "Brauzer bu qurilmani o'chirib yuborgan. Bildirishnomani qayta yoqing.");
        else if (r.failed > 0) toast("error", "Bildirishnoma xizmati sinovni qabul qilmadi. Birozdan so'ng qayta urinib ko'ring.");
        else toast("info", "Sinov yuborilmadi: qurilma ro'yxatda yo'q yoki uning seansi yopilgan.");
        if (r.removed > 0 || r.failed > 0) await refresh(true);
      }),
    );

  const doMaster = (btn, on) =>
    busy(btn, () =>
      guard(async () => {
        await push.setMaster(on);
        toast("ok", on ? "Bildirishnomalar yoqildi." : "Bildirishnomalar hamma qurilmada to'xtatildi.");
        await refresh(true);
      }),
    );

  const doRemove = (btn, dev) =>
    busy(btn, () =>
      guard(async () => {
        await push.removeDevice(dev); // shu brauzerniki bo'lsa, emit() yangilashni o'zi boshlaydi
        toast("ok", "Qurilma ro'yxatdan olib tashlandi.");
        if (!dev.current) await refresh(true);
      }),
    );

  const doUnmute = (btn, m) =>
    busy(btn, () =>
      guard(async () => {
        await push.unmute(m.id);
        toast("ok", "«" + m.name + "» suhbatidan bildirishnomalar yoqildi.");
        await refresh(true);
      }),
    );

  // ---- hayot sikli ----
  // Foydalanuvchi brauzer sozlamalarida ruxsatni o'zgartirib qaytsa, holat yangilansin
  const wake = () => {
    if (shown && !disposed && data && document.visibilityState === "visible") refresh();
  };
  document.addEventListener("visibilitychange", wake);
  const offChange = push.onChange(() => {
    if (shown && !disposed) refresh(true);
  });
  // Ruxsat so'rovi tugma bosilgan zahoti bo'lishi uchun kalit va xizmat ishchisi oldindan tayyorlab qo'yiladi
  push.prepare();
  paint();
  refresh(true);

  return {
    el,
    show() {
      shown = true;
      refresh();
    },
    hide() {
      shown = false;
    },
    dispose() {
      disposed = true;
      document.removeEventListener("visibilitychange", wake);
      offChange();
    },
  };
}
