// Messenjer: bitta suhbat ekrani.
// Xabarlar ro'yxati, yangilanishlarni vaqti-vaqti bilan so'rab turish (ochiq oynada ~3 soniyada bir), yozish paneli, rasm va fayl biriktirish.
// Serverdan kelgan har qanday matn faqat matn tuguni sifatida qo'yiladi (innerHTML yo'q).
import { h, icon, copyText } from "../dom.js";
import { confirmDialog, errorText, toast } from "../ui.js";
import { avatar } from "../parts.js";
import * as chat from "../chatapi.js";
import { dayKey, dayLabel, linkify, quoteText, snippetOf, systemText, timeHM } from "./chat_text.js";
import { groupInfoDialog, lightbox } from "./chat_dialogs.js";

const POLL_VISIBLE = 3000;
const POLL_HIDDEN = 15000;
const RUN_GAP = 5 * 60 * 1000; // bir odamning ketma-ket xabarlari shu vaqt ichida bitta «qatorga» birlashadi
const IMG_MAX_W = 320;
const IMG_MAX_H = 360;
const IMG_PARALLEL = 3;

const sameNodes = (live, next) => live.length === next.length && next.every((n, i) => live[i] === n);

export function createConvo({ id, ctx, host }) {
  const me = ctx.account.id;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  let canMedia = Array.isArray(ctx.account.permissions) && ctx.account.permissions.includes("media");
  let disposed = false;

  const st = { loaded: false, conv: null, members: [], people: {}, msgs: new Map(), cursor: 0, hasMore: false, readSeq: 0, dividerSeq: 0, below: 0, atBottom: true, loadingOlder: false, gone: false, failures: 0, membersSig: "" };
  let pending = []; // yuborilayotgan yoki yuborilmagan xabarlar
  let replyTo = null;
  let att = null; // tayyorlanayotgan yoki tayyor biriktirma
  let rpcBusy = 0; // xabar yuborish so'rovi ketayotgan paytda yangilanish so'ralmaydi (xabar ikki marta ko'rinib qolmasin)
  let timer = null;
  let readTimer = null;
  let inflightPoll = null;
  let lastReadSent = 0;
  let menuEl = null;
  let menuOff = null;

  const nameOf = (uid) => (uid === me ? "Siz" : (st.people[uid] && st.people[uid].name) || (st.members.find((m) => m.id === uid) || {}).name || "Foydalanuvchi");
  const peerOf = () => st.members.find((m) => m.id !== me) || null;
  const isGroup = () => !!st.conv && st.conv.kind === "group";

  // -------------------------------------------------------------------------
  // Tuzilma
  // -------------------------------------------------------------------------
  const title = h("h2", { class: "convo__title", tabindex: "-1" }, "");
  const sub = h("p", { class: "convo__sub" }, "");
  const avSlot = h("span", { class: "convo__av" });
  const infoBtn = h("button", { class: "iconbtn", type: "button", "aria-label": "Guruh haqida", hidden: true, onclick: () => openInfo() }, icon("info"));
  const head = h(
    "header",
    { class: "convo__head" },
    h("a", { class: "iconbtn convo__back", href: "#/chat", "aria-label": "Suhbatlar ro'yxatiga qaytish" }, icon("back")),
    avSlot,
    h("div", { class: "convo__who" }, title, sub),
    infoBtn,
  );
  const banner = h("div", { class: "convo__banner", role: "status", hidden: true });
  const moreBtn = h("button", { class: "btn btn--ghost btn--sm", type: "button", onclick: () => loadOlder() }, "Oldingi xabarlar");
  const moreBox = h("div", { class: "convo__more", hidden: true }, moreBtn);
  const list = h("div", { class: "convo__list" }, h("div", { class: "convo__state", role: "status" }, h("span", { class: "convo__spin", "aria-hidden": "true" }), "Xabarlar yuklanmoqda…"));
  const scroll = h("div", { class: "convo__scroll", tabindex: "0", role: "log", "aria-label": "Xabarlar", "aria-live": "off" }, moreBox, list);
  const downCount = h("span", null, "");
  const down = h("button", { class: "convo__down", type: "button", hidden: true, onclick: () => toBottom(true) }, icon("down"), downCount);
  const drop = h("div", { class: "convo__drop", hidden: true, "aria-hidden": "true" }, icon("clip"), h("span", null, "Faylni shu yerga tashlang"));
  const live = h("div", { class: "sr", role: "status", "aria-live": "polite" });

  // yozish paneli
  const replyBar = h("div", { class: "composer__ctx", hidden: true });
  const attBar = h("div", { class: "composer__ctx", hidden: true });
  const composerErr = h("p", { class: "composer__err", role: "alert", hidden: true });
  const counter = h("span", { class: "composer__count num", hidden: true });
  const input = h("textarea", { class: "composer__input", rows: "1", placeholder: "Xabar yozing…", "aria-label": "Xabar matni", autocomplete: "off", enterkeyhint: "send" });
  const fileInput = h("input", { type: "file", class: "composer__file", hidden: true, tabindex: "-1", "aria-hidden": "true" });
  const attachBtn = h("button", { class: "iconbtn composer__attach", type: "button", "aria-label": "Rasm yoki fayl biriktirish", hidden: !canMedia, onclick: () => fileInput.click() }, icon("clip"));
  const sendBtn = h("button", { class: "composer__send", type: "button", "aria-label": "Yuborish", disabled: true, onclick: () => submit() }, icon("send"));
  const row = h("div", { class: "composer__row" }, attachBtn, h("div", { class: "composer__field" }, input, counter), sendBtn, fileInput);
  const lock = h("p", { class: "composer__lock", hidden: true });
  const composer = h("footer", { class: "composer" }, replyBar, attBar, composerErr, row, lock);

  const root = h("div", { class: "convo" }, head, banner, h("div", { class: "convo__body" }, scroll, down, drop), composer, live);

  // -------------------------------------------------------------------------
  // Sarlavha, qulf
  // -------------------------------------------------------------------------
  function paintHead() {
    const c = st.conv;
    if (!c) return;
    let name;
    if (c.kind === "group") {
      name = c.title;
      sub.textContent = st.members.length + " a'zo";
      avSlot.replaceChildren(h("span", { class: "av av--group", "aria-hidden": "true" }, icon("users")));
    } else {
      const p = peerOf();
      name = p ? p.name : (host.hint && host.hint.title) || "Suhbat";
      sub.textContent = p ? "@" + p.login + (p.available ? "" : " · hozir faol emas") : "";
      avSlot.replaceChildren(avatar({ display_name: name, role: "user", status: p && !p.available ? "blocked" : "active" }));
    }
    title.textContent = name;
    infoBtn.hidden = c.kind !== "group";
    host.title(name);
    paintLock();
  }

  function paintLock() {
    const p = st.conv && st.conv.kind === "direct" ? peerOf() : null;
    const locked = !!p && !p.available;
    lock.hidden = !locked;
    lock.textContent = locked ? "Bu odamga hozir xabar yuborib bo'lmaydi: uning hisobi faol emas yoki Messenjer ruxsati yo'q." : "";
    row.hidden = locked;
    if (locked) {
      replyBar.hidden = true;
      attBar.hidden = true;
    }
    syncSend();
  }

  const paintAttach = () => {
    attachBtn.hidden = !canMedia;
  };

  // -------------------------------------------------------------------------
  // Rasmlar: faqat ko'rinish oralig'iga yaqinlashganda yuklanadi, bir vaqtda 3 tadan ko'p emas
  // -------------------------------------------------------------------------
  const urls = new Map(); // fayl manzili -> blob: manzil
  const imgEls = new Map(); // fayl manzili -> <img> (qayta chizilganda miltillamasligi uchun)
  const inflight = new Map();
  const waiting = [];
  let active = 0;

  function pump() {
    while (active < IMG_PARALLEL && waiting.length) {
      const j = waiting.shift();
      active++;
      chat.imageUrl(j.path).then(
        (u) => {
          if (disposed) {
            URL.revokeObjectURL(u);
            j.reject(new Error("closed"));
          } else {
            urls.set(j.path, u);
            j.resolve(u);
          }
        },
        (e) => j.reject(e),
      ).finally(() => {
        active--;
        pump();
      });
    }
  }
  function loadUrl(path) {
    if (urls.has(path)) return Promise.resolve(urls.get(path));
    if (inflight.has(path)) return inflight.get(path);
    const p = new Promise((resolve, reject) => {
      waiting.push({ path, resolve, reject });
      pump();
    });
    inflight.set(path, p);
    p.then(
      () => inflight.delete(path),
      () => inflight.delete(path),
    );
    return p;
  }
  const io =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            for (const en of entries) {
              if (en.isIntersecting) {
                io.unobserve(en.target);
                const fn = en.target._start;
                if (fn) fn();
              }
            }
          },
          { root: scroll, rootMargin: "400px 0px" },
        )
      : null;

  function imageEl(m) {
    const { path } = m.meta;
    const name = String(m.meta.name || "rasm");
    const w = Number(m.meta.w) || 0;
    const hh = Number(m.meta.h) || 0;
    const box = h("button", { class: "media", type: "button", "aria-label": "Rasmni kattalashtirish: " + name, dataset: { path: String(path || "") } });
    if (w > 0 && hh > 0) {
      let dw = Math.min(IMG_MAX_W, w);
      let dh = (dw * hh) / w;
      if (dh > IMG_MAX_H) {
        dh = IMG_MAX_H;
        dw = (dh * w) / hh;
      }
      box.style.width = Math.max(48, Math.round(dw)) + "px";
      box.style.aspectRatio = w + " / " + hh;
    } else {
      box.classList.add("media--nosize");
    }
    const show = (url) => {
      let img = imgEls.get(path);
      if (!img) {
        img = h("img", { class: "media__img", src: url, alt: name, draggable: "false", decoding: "async" });
        imgEls.set(path, img);
      }
      box.classList.remove("media--loading", "media--failed");
      box.classList.add("media--ready");
      box.replaceChildren(img);
    };
    const start = () => {
      if (disposed) return;
      box.classList.remove("media--failed");
      box.classList.add("media--loading");
      box.replaceChildren();
      loadUrl(path).then(show, (e) => {
        if (disposed || (e && e.message === "closed")) return;
        box.classList.remove("media--loading");
        box.classList.add("media--failed");
        box.dataset.failed = "1";
        box.replaceChildren(h("span", { class: "media__fail" }, e && e.code === "file_missing" ? "Rasm topilmadi" : "Rasm yuklanmadi. Qayta urinish uchun bosing."));
      });
    };
    box.addEventListener("click", () => {
      if (box.dataset.failed) {
        delete box.dataset.failed;
        start();
        return;
      }
      const url = urls.get(path);
      if (url) lightbox({ url, name, onSave: () => saveFile(path, name) });
    });
    if (urls.has(path)) show(urls.get(path));
    else if (io) {
      box._start = start;
      io.observe(box);
    } else start();
    return box;
  }

  async function saveFile(path, name) {
    try {
      await chat.saveFile(path, name);
    } catch (e) {
      if (!(e && e.fatal)) toast("error", errorText(e));
    }
  }

  function fileEl(m) {
    const name = String(m.meta.name || "fayl");
    const size = Number(m.meta.size) || 0;
    const btn = h(
      "button",
      { class: "file", type: "button", "aria-label": "Faylni yuklab olish: " + name },
      h("span", { class: "file__icon" }, icon("file")),
      h("span", { class: "file__text" }, h("span", { class: "file__name" }, name), h("span", { class: "file__size" }, size ? chat.fmtSize(size) : "")),
      h("span", { class: "file__dl" }, icon("download")),
    );
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      await saveFile(m.meta.path, name);
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    });
    return btn;
  }

  // -------------------------------------------------------------------------
  // Xabar qatorlari
  // -------------------------------------------------------------------------
  const nodeCache = new Map(); // seq -> {rev, names, showName, el, tick}

  function quoteEl(r) {
    const q = h("button", { class: "quote", type: "button", "aria-label": "Javob berilgan xabarga o'tish" }, h("span", { class: "quote__name" }, nameOf(r.sender)), h("span", { class: "quote__text" }, quoteText(r)));
    q.addEventListener("click", () => jumpTo(r.seq));
    return q;
  }

  function buildMsg(m, { own, showName }) {
    if (m.kind === "system") {
      const t = Array.isArray(m.meta.targets) ? m.meta.targets : m.meta.target ? [m.meta.target] : [];
      return { el: h("div", { class: "msg-sys", dataset: { seq: String(m.seq) } }, h("span", null, systemText(m.meta, nameOf(m.sender), m.sender === me, t.map(nameOf)))), tick: null };
    }
    const bubble = h("div", { class: "bubble" });
    if (m.deleted) {
      bubble.append(h("p", { class: "bubble__gone" }, "Xabar o'chirilgan"));
    } else {
      if (showName) bubble.append(h("span", { class: "bubble__name" }, nameOf(m.sender)));
      if (m.reply) bubble.append(quoteEl(m.reply));
      if (m.kind === "image" && m.meta.path) bubble.append(imageEl(m));
      else if (m.kind === "file" && m.meta.path) bubble.append(fileEl(m));
      if (m.body) bubble.append(h("p", { class: "bubble__text" }, ...linkify(m.body)));
    }
    let tick = null;
    if (own && !m.deleted) tick = h("span", { class: "tick", role: "img", "aria-label": "Yuborildi", dataset: { state: "sent" } });
    bubble.append(h("span", { class: "bubble__meta" }, h("time", { datetime: m.at }, timeHM(m.at)), tick));
    let more = null;
    if (!m.deleted) {
      more = h("button", { class: "msg__more iconbtn", type: "button", "aria-label": "Xabar amallari", "aria-haspopup": "menu" }, icon("more"));
      more.addEventListener("click", () => openMenu(m, more));
    }
    const el = h("div", { class: "msg " + (own ? "msg--own" : "msg--their") + (m.deleted ? " msg--deleted" : ""), dataset: { seq: String(m.seq) } }, own ? more : null, bubble, own ? null : more);
    return { el, tick };
  }

  function msgNode(m, info) {
    const own = m.sender === me;
    const showName = info.group && !own && info.first && m.kind !== "system" && !m.deleted;
    let c = nodeCache.get(m.seq);
    if (!c || c.rev !== m.rev || c.names !== info.names || c.showName !== showName) {
      c = { rev: m.rev, names: info.names, showName, ...buildMsg(m, { own, showName }) };
      nodeCache.set(m.seq, c);
    }
    if (m.kind !== "system") {
      c.el.classList.toggle("msg--first", info.first);
      c.el.classList.toggle("msg--last", info.last);
      if (c.tick) {
        const read = info.others.length > 0 && info.others.every((o) => o.readSeq >= m.seq);
        const state = read ? "read" : "sent";
        if (c.tick.dataset.state !== state) {
          c.tick.dataset.state = state;
          c.tick.setAttribute("aria-label", read ? "O'qildi" : "Yuborildi");
        }
      }
    }
    return c.el;
  }

  function pendingNode(p) {
    const bubble = h("div", { class: "bubble" });
    if (p.att) {
      if (p.att.kind === "image" && p.att.preview) bubble.append(h("div", { class: "media media--ready media--pending" }, h("img", { class: "media__img", src: p.att.preview, alt: p.att.name })));
      else bubble.append(h("div", { class: "file file--static" }, h("span", { class: "file__icon" }, icon("file")), h("span", { class: "file__text" }, h("span", { class: "file__name" }, p.att.name), h("span", { class: "file__size" }, chat.fmtSize(p.att.size)))));
    }
    if (p.body) bubble.append(h("p", { class: "bubble__text" }, ...linkify(p.body)));
    if (p.state === "failed") {
      bubble.append(h("span", { class: "bubble__err", role: "alert" }, p.error || "Yuborilmadi"));
      const retry = h("button", { class: "btn btn--ghost btn--sm", type: "button" }, icon("refresh"), "Qayta yuborish");
      retry.addEventListener("click", () => run(p));
      const del = h("button", { class: "btn btn--ghost btn--sm", type: "button" }, icon("trash"), "Bekor qilish");
      del.addEventListener("click", () => dropPending(p));
      bubble.append(h("div", { class: "bubble__acts" }, retry, del));
    } else {
      bubble.append(h("span", { class: "bubble__meta" }, icon("clock"), h("span", null, p.att && !p.meta ? "Yuklanmoqda…" : "Yuborilmoqda…")));
    }
    return h("div", { class: "msg msg--own msg--first msg--last msg--pending" + (p.state === "failed" ? " msg--failed" : ""), dataset: { nonce: p.nonce } }, bubble);
  }

  // Ajratgichlar qayta ishlatiladi: hech narsa o'zgarmagan bo'lsa, ro'yxatga tegilmaydi (belgilangan matn va fokus saqlanadi)
  const sepCache = new Map();
  const daySep = (iso) => {
    const label = dayLabel(iso);
    const key = dayKey(iso) + "|" + label;
    let el = sepCache.get(key);
    if (!el) {
      el = h("div", { class: "daysep", role: "separator" }, h("span", null, label));
      sepCache.set(key, el);
    }
    return el;
  };
  let newSepEl = null;
  const newSep = () => newSepEl || (newSepEl = h("div", { class: "newsep", role: "separator" }, h("span", null, "Yangi xabarlar")));

  function render({ bottom = false, older = false } = {}) {
    if (disposed || !st.loaded || st.gone) return;
    const prevH = scroll.scrollHeight;
    const prevTop = scroll.scrollTop;
    const stick = bottom || (!older && st.atBottom);
    const msgs = [...st.msgs.values()].sort((a, b) => a.seq - b.seq);
    const group = isGroup();
    const others = st.members.filter((m) => m.id !== me && (!group || m.available));
    const names = group ? st.members.map((m) => m.id + ":" + m.name).join("|") : "";
    const run = (a, b) => !!a && !!b && a.kind !== "system" && b.kind !== "system" && a.sender === b.sender && dayKey(a.at) === dayKey(b.at) && Math.abs(Date.parse(b.at) - Date.parse(a.at)) < RUN_GAP;
    const nodes = [];
    let prev = null;
    let prevDay = 0;
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const dk = dayKey(m.at);
      if (dk !== prevDay) {
        nodes.push(daySep(m.at));
        prevDay = dk;
        prev = null;
      }
      if (st.dividerSeq && m.seq === st.dividerSeq) nodes.push(newSep());
      nodes.push(msgNode(m, { first: !run(prev, m), last: !run(m, msgs[i + 1]), group, others, names }));
      prev = m;
    }
    for (const p of pending) nodes.push(pendingNode(p));
    if (!nodes.length) nodes.push(h("div", { class: "convo__state" }, isGroup() ? "Guruhda hali xabar yo'q. Birinchi xabarni yozing." : "Hali xabar yo'q. Birinchi xabarni yozing."));
    // Hech narsa o'zgarmagan bo'lsa, DOM'ga tegilmaydi (belgilangan matn va fokus saqlanadi). Pending qatorlari har safar yangidan quriladi.
    if (!sameNodes(list.children, nodes)) list.replaceChildren(...nodes);
    for (const k of nodeCache.keys()) if (!st.msgs.has(k)) nodeCache.delete(k);
    moreBox.hidden = !st.hasMore;
    if (stick) {
      scroll.scrollTop = scroll.scrollHeight;
      st.atBottom = true;
      st.below = 0;
    } else if (older) {
      scroll.scrollTop = prevTop + (scroll.scrollHeight - prevH);
    }
    syncDown();
  }

  // -------------------------------------------------------------------------
  // Aylantirish
  // -------------------------------------------------------------------------
  const nearBottom = () => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 70;
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function syncDown() {
    down.hidden = st.atBottom || !st.loaded;
    downCount.textContent = st.below > 0 ? st.below + " ta yangi xabar" : "Pastga";
  }
  function toBottom(smooth) {
    scroll.scrollTo({ top: scroll.scrollHeight, behavior: smooth && !reduceMotion() ? "smooth" : "auto" });
    st.atBottom = true;
    st.below = 0;
    syncDown();
    maybeRead();
  }
  function jumpTo(seq) {
    const el = list.querySelector('[data-seq="' + Number(seq) + '"]');
    if (!el) {
      toast("info", "Bu xabar hozir yuklanmagan. Oldingi xabarlarni yuklang.");
      return;
    }
    el.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
    el.classList.add("msg--flash");
    setTimeout(() => el.classList.remove("msg--flash"), 1400);
  }
  function scrollToDivider() {
    const d = list.querySelector(".newsep");
    if (!d) return;
    scroll.scrollTop = Math.max(0, d.offsetTop - 56);
    st.atBottom = nearBottom();
  }
  scroll.addEventListener(
    "scroll",
    () => {
      st.atBottom = nearBottom();
      if (st.atBottom) {
        st.below = 0;
        maybeRead();
      }
      syncDown();
      // Menyu faqat xabar haqiqatan siljiganda yopiladi: yozish paneli balandligi o'zgarishidan paydo bo'lgan «bo'sh» aylantirish hodisasi uni yopmasin
      if (menuEl) {
        const o = menuEl._opener;
        if (!o.isConnected || Math.abs(o.getBoundingClientRect().top - menuEl._y) > 3) closeMenu(false);
      }
      if (scroll.scrollTop < 60 && st.hasMore && scroll.scrollHeight > scroll.clientHeight + 20) loadOlder();
    },
    { passive: true },
  );

  // -------------------------------------------------------------------------
  // Ma'lumot olish va yangilash
  // -------------------------------------------------------------------------
  function adoptMeta(pack) {
    st.conv = pack.conv;
    st.members = pack.members;
    Object.assign(st.people, pack.people);
    st.readSeq = Math.max(st.readSeq, pack.conv.readSeq);
    const sig = pack.conv.title + "#" + pack.members.map((m) => m.id + ":" + m.readSeq + ":" + (m.available ? 1 : 0) + ":" + m.name).join("|");
    const changed = sig !== st.membersSig;
    st.membersSig = sig;
    if (changed) paintHead();
    return changed;
  }

  function showGone(text) {
    if (st.gone) return;
    st.gone = true;
    clearTimeout(timer);
    clearTimeout(readTimer);
    closeMenu(false);
    composer.hidden = true;
    banner.hidden = true;
    down.hidden = true;
    moreBox.hidden = true;
    list.replaceChildren(h("div", { class: "convo__state convo__state--gone", role: "alert" }, h("p", null, text), h("a", { class: "btn btn--ghost", href: "#/chat" }, "Suhbatlar ro'yxatiga qaytish")));
  }

  function setBanner(text) {
    banner.textContent = text;
    banner.hidden = !text;
  }

  async function load() {
    try {
      const pack = await chat.history(id);
      if (disposed) return;
      st.msgs.clear();
      for (const m of pack.messages) st.msgs.set(m.seq, m);
      st.hasMore = pack.hasMore;
      st.cursor = pack.messages.reduce((a, m) => Math.max(a, m.rev), 0);
      st.readSeq = 0;
      adoptMeta(pack);
      st.loaded = true;
      const firstUnread = pack.messages.find((m) => m.seq > st.readSeq && m.sender !== me && m.kind !== "system" && !m.deleted);
      st.dividerSeq = firstUnread ? firstUnread.seq : 0;
      render({ bottom: true });
      if (st.dividerSeq) scrollToDivider();
      syncDown();
      maybeRead();
      schedule();
      if (!coarse) input.focus();
    } catch (e) {
      onLoadError(e);
    }
  }

  function onLoadError(e) {
    if (disposed || (e && e.fatal)) return;
    if (e && (e.code === "not_found" || e.code === "no_permission" || e.code === "chat_missing" || e.code === "key_rejected")) {
      showGone(e.code === "not_found" ? "Bu suhbat topilmadi yoki siz undan chiqarilgansiz." : errorText(e));
      return;
    }
    const retry = h("button", { class: "btn btn--ghost", type: "button" }, icon("refresh"), "Qayta urinish");
    retry.addEventListener("click", () => {
      list.replaceChildren(h("div", { class: "convo__state", role: "status" }, h("span", { class: "convo__spin", "aria-hidden": "true" }), "Xabarlar yuklanmoqda…"));
      load();
    });
    list.replaceChildren(h("div", { class: "convo__state convo__state--gone", role: "alert" }, h("p", null, errorText(e)), retry));
  }

  async function pollOnce() {
    const pack = await chat.delta(id, st.cursor);
    if (disposed) return false;
    st.failures = 0;
    setBanner("");
    applyDelta(pack);
    return pack.hasMore;
  }

  function schedule(ms) {
    clearTimeout(timer);
    if (disposed || st.gone) return;
    const base = document.visibilityState === "visible" ? POLL_VISIBLE : POLL_HIDDEN;
    const wait = ms !== undefined ? ms : st.failures ? Math.min(30000, base * 2 ** Math.min(st.failures, 4)) : base;
    timer = setTimeout(() => {
      poll().catch(() => {});
    }, wait);
  }

  function poll() {
    if (!st.loaded || st.gone || disposed) return Promise.resolve();
    if (inflightPoll) return inflightPoll;
    if (rpcBusy > 0) {
      schedule(400);
      return Promise.resolve();
    }
    inflightPoll = (async () => {
      try {
        let more = true;
        let guard = 0;
        while (more && guard++ < 10) more = await pollOnce();
      } catch (e) {
        if (!disposed) onPollError(e);
        throw e;
      } finally {
        inflightPoll = null;
        schedule();
      }
    })();
    return inflightPoll;
  }

  // Hech qachon xato tashlamaydi: xatolar tepadagi ogohlantirishda ko'rsatiladi
  async function refresh() {
    if (inflightPoll) {
      try {
        await inflightPoll;
      } catch {
        /* quyidagi so'rov xatoni o'zi bildiradi */
      }
    }
    try {
      await poll();
    } catch {
      /* xato onPollError orqali ko'rsatilgan */
    }
  }

  function onPollError(e) {
    if (!e || e.fatal) return;
    if (e.code === "not_found") showGone("Bu suhbat topilmadi yoki siz undan chiqarilgansiz.");
    else if (e.code === "no_permission" || e.code === "chat_missing" || e.code === "key_rejected") showGone(errorText(e));
    else {
      st.failures++;
      setBanner(e.code === "network" ? "Aloqa yo'q. Qayta urinilmoqda…" : "Yangilab bo'lmadi: " + errorText(e));
    }
  }

  function applyDelta(pack) {
    const metaChanged = adoptMeta(pack);
    const oldest = st.msgs.size ? Math.min(...st.msgs.keys()) : 0;
    let changed = false;
    let fresh = 0;
    let last = null;
    let maxRev = st.cursor;
    for (const m of pack.messages) {
      maxRev = Math.max(maxRev, m.rev);
      const had = st.msgs.get(m.seq);
      if (!had && st.hasMore && m.seq < oldest) continue; // oyna tashqarisidagi eski xabar: «Oldingi xabarlar» bosilganda to'liq holda keladi
      if (had && had.rev === m.rev) continue;
      st.msgs.set(m.seq, m);
      changed = true;
      if (!had && m.sender !== me && m.kind !== "system" && !m.deleted) {
        fresh++;
        last = m;
      }
    }
    st.cursor = maxRev;
    if (changed || metaChanged) render();
    if (fresh) {
      if (!st.atBottom) {
        st.below += fresh;
        syncDown();
      }
      if (document.visibilityState !== "visible" || !st.atBottom) live.textContent = nameOf(last.sender) + ": " + snippetOf(last);
      host.touch();
    } else if (changed) {
      host.touch();
    }
    maybeRead();
  }

  async function loadOlder() {
    if (st.loadingOlder || !st.hasMore || !st.msgs.size) return;
    st.loadingOlder = true;
    moreBtn.disabled = true;
    try {
      const pack = await chat.history(id, Math.min(...st.msgs.keys()));
      if (disposed) return;
      for (const m of pack.messages) if (!st.msgs.has(m.seq)) st.msgs.set(m.seq, m);
      st.hasMore = pack.hasMore;
      adoptMeta(pack);
      render({ older: true });
    } catch (e) {
      if (!(e && e.fatal)) toast("error", errorText(e));
    } finally {
      st.loadingOlder = false;
      moreBtn.disabled = false;
    }
  }

  function maybeRead() {
    if (disposed || !st.loaded || st.gone || document.visibilityState !== "visible" || !st.atBottom) return;
    clearTimeout(readTimer);
    readTimer = setTimeout(async () => {
      let top = 0;
      for (const s of st.msgs.keys()) if (s > top) top = s;
      if (disposed || st.gone || top <= st.readSeq || top <= lastReadSent || !nearBottom() || document.visibilityState !== "visible") return;
      try {
        const r = await chat.markRead(id, top);
        lastReadSent = Math.max(lastReadSent, top);
        st.readSeq = Math.max(st.readSeq, r.readSeq);
        if (!disposed) host.unread(id, r.unread);
      } catch (e) {
        if (e && !e.fatal && e.code === "not_found") onPollError(e);
        /* boshqa xatolarda keyingi yangilanishda qayta uriniladi */
      }
    }, 350);
  }

  // -------------------------------------------------------------------------
  // Yozish paneli
  // -------------------------------------------------------------------------
  const lockedNow = () => !lock.hidden;

  function syncSend() {
    const empty = !input.value.trim();
    sendBtn.disabled = st.gone || !st.loaded || lockedNow() || (!!att && !!att.preparing) || (empty && !att);
  }
  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 180) + "px";
  }
  function showErr(text) {
    composerErr.textContent = text;
    composerErr.hidden = !text;
  }
  function onInput() {
    autosize();
    const v = input.value;
    if (v) host.drafts.set(id, v);
    else host.drafts.delete(id);
    const n = [...v].length;
    counter.hidden = n < chat.LIMITS.body - 500;
    counter.textContent = n + " / " + chat.LIMITS.body;
    counter.classList.toggle("composer__count--over", n > chat.LIMITS.body);
    showErr("");
    syncSend();
  }
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.isComposing && !coarse) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && replyTo) {
      setReply(null);
    }
  });
  input.addEventListener("paste", (e) => {
    const f = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0];
    if (f) {
      e.preventDefault();
      pickFile(f);
    }
  });
  fileInput.addEventListener("change", () => {
    const files = fileInput.files;
    if (files && files.length > 1) toast("info", "Bir vaqtda bitta fayl yuboriladi. Birinchisi tanlandi.");
    if (files && files[0]) pickFile(files[0]);
    fileInput.value = "";
  });

  function setReply(m) {
    replyTo = m;
    if (!m) {
      replyBar.hidden = true;
      replyBar.replaceChildren();
      return;
    }
    replyBar.hidden = false;
    replyBar.replaceChildren(
      h(
        "div",
        { class: "ctxbar" },
        icon("reply"),
        h("span", { class: "ctxbar__text" }, h("b", null, nameOf(m.sender)), h("span", null, snippetOf(m))),
        h("button", { class: "iconbtn", type: "button", "aria-label": "Javobni bekor qilish", onclick: () => setReply(null) }, icon("x")),
      ),
    );
    input.focus();
  }

  function releasePreview(a) {
    if (a && a.preview) {
      URL.revokeObjectURL(a.preview);
      a.preview = "";
    }
  }
  function setAtt(a, { keep = false } = {}) {
    if (att && att !== a && !keep) releasePreview(att);
    att = a;
    if (!a) {
      attBar.hidden = true;
      attBar.replaceChildren();
    } else {
      attBar.hidden = false;
      const thumb = a.preparing ? h("span", { class: "convo__spin", "aria-hidden": "true" }) : a.kind === "image" && a.preview ? h("img", { class: "chip__thumb", src: a.preview, alt: "" }) : h("span", { class: "chip__icon" }, icon("file"));
      attBar.replaceChildren(
        h(
          "div",
          { class: "ctxbar ctxbar--att" },
          thumb,
          h("span", { class: "ctxbar__text" }, h("b", null, a.name), h("span", null, a.preparing ? "Tayyorlanmoqda…" : chat.fmtSize(a.size))),
          h("button", { class: "iconbtn", type: "button", "aria-label": "Biriktirmani olib tashlash", onclick: () => setAtt(null) }, icon("x")),
        ),
      );
    }
    syncSend();
  }

  async function pickFile(file) {
    if (!canMedia) {
      toast("warn", "Fayl yuborish ruxsati sizda yo'q. Administratorga murojaat qiling.");
      return;
    }
    if (lockedNow() || st.gone || !st.loaded) return;
    if (att && att.preparing) return;
    showErr("");
    const pre = { preparing: true, name: String(file.name || "fayl") };
    setAtt(pre);
    try {
      const a = await chat.prepareAttachment(file);
      if (disposed || att !== pre) return; // foydalanuvchi bu orada bekor qildi
      if (a.kind === "image") a.preview = URL.createObjectURL(a.blob);
      setAtt(a);
      if (!coarse) input.focus();
    } catch (e) {
      if (att === pre) setAtt(null);
      showErr(errorText(e));
    }
  }

  function dropPending(p) {
    pending = pending.filter((x) => x !== p);
    releasePreview(p.att);
    if (p.meta && p.meta.path) chat.discardUpload(p.meta.path);
    render();
  }

  const failText = (e) => {
    if (!e) return "Yuborilmadi.";
    if (e.code === "network") return "Aloqa yo'q: xabar yuborilmadi.";
    return errorText(e);
  };

  async function run(p) {
    p.state = "sending";
    p.error = "";
    render({ bottom: true });
    try {
      if (p.att && !p.meta) p.meta = await chat.uploadAttachment(id, p.att);
      if (disposed) return;
      rpcBusy++;
      let res;
      try {
        res = await chat.send(id, { body: p.body, meta: p.meta, reply: p.reply, nonce: p.nonce });
      } finally {
        rpcBusy--;
      }
      if (disposed) return;
      st.msgs.set(res.message.seq, res.message);
      pending = pending.filter((x) => x !== p);
      releasePreview(p.att);
      render({ bottom: true });
      host.touch();
    } catch (e) {
      if (disposed || (e && e.fatal)) return;
      p.state = "failed";
      p.error = failText(e);
      if (e && (e.code === "no_media_permission" || e.code === "upload_denied")) {
        canMedia = false;
        paintAttach();
      }
      if (e && e.code === "not_found") onPollError(e);
      if (e && (e.code === "peer_unavailable" || e.code === "reply_invalid")) refresh().catch(() => {});
      render({ bottom: true });
    }
  }

  async function submit() {
    if (sendBtn.disabled || st.gone || !st.loaded || lockedNow()) return;
    const text = chat.cleanBody(input.value);
    if (att && att.preparing) return;
    if (!text && !att) return;
    const problem = chat.bodyProblem(text);
    if (problem) {
      showErr(problem);
      return;
    }
    const p = { nonce: chat.uuid4(), body: text, att: att && !att.preparing ? att : null, meta: null, reply: replyTo ? replyTo.seq : null, state: "sending", error: "" };
    pending.push(p);
    input.value = "";
    host.drafts.delete(id);
    onInput();
    setAtt(null, { keep: true });
    setReply(null);
    if (!coarse) input.focus();
    await run(p);
  }

  // -------------------------------------------------------------------------
  // Xabar amallari menyusi (javob berish, nusxalash, yuklab olish, o'chirish)
  // -------------------------------------------------------------------------
  function closeMenu(refocus = true) {
    if (!menuEl) return;
    const opener = menuEl._opener;
    menuEl.remove();
    menuEl = null;
    if (menuOff) menuOff();
    menuOff = null;
    if (refocus && opener && opener.isConnected) opener.focus();
  }

  function openMenu(m, opener) {
    closeMenu(false);
    const own = m.sender === me;
    const item = (ic, label, fn, danger = false) => {
      const b = h("button", { class: "menu__item" + (danger ? " menu__item--danger" : ""), type: "button", role: "menuitem" }, icon(ic), label);
      b.addEventListener("click", () => {
        closeMenu(false);
        fn();
      });
      return b;
    };
    const items = [item("reply", "Javob berish", () => setReply(m))];
    if (m.body) {
      items.push(
        item("copy", "Matnni nusxalash", async () => {
          const ok = await copyText(m.body);
          toast(ok ? "ok" : "error", ok ? "Matn nusxalandi." : "Nusxalab bo'lmadi. Matnni qo'lda belgilab nusxalang.");
        }),
      );
    }
    if ((m.kind === "file" || m.kind === "image") && m.meta.path) items.push(item("download", "Yuklab olish", () => saveFile(m.meta.path, m.meta.name)));
    if (own) items.push(item("trash", "O'chirish", () => askDelete(m), true));
    menuEl = h("div", { class: "menu", role: "menu", "aria-label": "Xabar amallari" }, items);
    menuEl._opener = opener;
    root.append(menuEl);
    const r = opener.getBoundingClientRect();
    menuEl._y = r.top;
    const mw = menuEl.offsetWidth;
    const mh = menuEl.offsetHeight;
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    let left = own ? r.right - mw : r.left;
    left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - mw - 8));
    menuEl.style.top = Math.round(top) + "px";
    menuEl.style.left = Math.round(left) + "px";
    const onDown = (e) => {
      if (menuEl && !menuEl.contains(e.target) && e.target !== opener && !opener.contains(e.target)) closeMenu(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeMenu(true);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const bs = [...menuEl.querySelectorAll("button")];
        const i = bs.indexOf(document.activeElement);
        bs[(i + (e.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length].focus();
      }
    };
    const onResize = () => closeMenu(false);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    menuOff = () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
    };
    items[0].focus();
  }

  async function askDelete(m) {
    const hasFile = (m.kind === "file" || m.kind === "image") && !!m.meta.path;
    const r = await confirmDialog({
      title: "Xabarni o'chirasizmi?",
      lead: "Xabar suhbatdagi hamma uchun o'chiriladi." + (hasFile ? " Biriktirilgan fayl ham o'chadi." : "") + " Buni qaytarib bo'lmaydi.",
      confirmText: "O'chirish",
      danger: true,
      run: () => chat.removeMessage(id, m.seq),
    });
    if (!r || !r.ok || disposed) return;
    // Darhol ko'rsatamiz; haqiqiy holat keyingi yangilanishda keladi
    const cur = st.msgs.get(m.seq);
    if (cur && !cur.deleted) {
      st.msgs.set(m.seq, { ...cur, deleted: true, body: "", meta: {}, reply: null, rev: cur.rev + 0.5 });
      if (replyTo && replyTo.seq === m.seq) setReply(null);
      render();
    }
    host.touch();
    refresh().catch(() => {});
  }

  // -------------------------------------------------------------------------
  // Guruh haqida
  // -------------------------------------------------------------------------
  const api = {
    el: root,
    info: () => ({ conv: st.conv, members: st.members, me }),
    refresh,
  };
  async function openInfo() {
    if (!st.conv || st.conv.kind !== "group") return;
    const r = await groupInfoDialog({ convo: api });
    if (r && r.left && !disposed) {
      host.touch();
      host.back();
    }
  }

  // -------------------------------------------------------------------------
  // Fayl tashlash (drag & drop)
  // -------------------------------------------------------------------------
  let dragDepth = 0;
  const hasFiles = (e) => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
  root.addEventListener("dragenter", (e) => {
    if (!canMedia || !hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    drop.hidden = false;
  });
  root.addEventListener("dragover", (e) => {
    if (canMedia && hasFiles(e)) e.preventDefault();
  });
  root.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) drop.hidden = true;
  });
  root.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    drop.hidden = true;
    const files = e.dataTransfer.files;
    if (files && files.length > 1) toast("info", "Bir vaqtda bitta fayl yuboriladi. Birinchisi tanlandi.");
    if (files && files[0]) pickFile(files[0]);
  });

  // -------------------------------------------------------------------------
  // Hayot sikli
  // -------------------------------------------------------------------------
  const wake = () => {
    if (document.visibilityState !== "visible" || disposed) return;
    st.failures = 0;
    poll().catch(() => {});
    maybeRead();
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);

  input.value = host.drafts.get(id) || "";
  if (input.value) onInput();
  syncSend();
  if (host.hint && host.hint.title) {
    title.textContent = host.hint.title;
    host.title(host.hint.title);
  }
  load();

  return Object.assign(api, {
    focus() {
      if (!coarse && st.loaded && !lockedNow()) input.focus();
    },
    /** Suhbat ochilganda ekran o'qish dasturi sarlavhani o'qisin (telefonda klaviatura ochilib ketmasin) */
    focusHead() {
      title.focus({ preventScroll: true });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      clearTimeout(readTimer);
      closeMenu(false);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      if (io) io.disconnect();
      if (input.value) host.drafts.set(id, input.value);
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
      imgEls.clear();
      releasePreview(att);
      for (const p of pending) releasePreview(p.att);
      pending = [];
    },
  });
}
