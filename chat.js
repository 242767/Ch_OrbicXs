// Messenjer: suhbatlar ro'yxati va suhbat ekrani. Keng ekranda ikkalasi yonma-yon, telefonda navbat bilan ko'rinadi.
// Manzillar: #/chat (ro'yxat), #/chat/<suhbat raqami> (suhbat). Ro'yxat vaqti-vaqti bilan yangilanadi (ochiq oynada ~6 soniyada bir).
import { h, icon } from "../dom.js";
import { errorText } from "../ui.js";
import { avatar } from "../parts.js";
import * as chat from "../chatapi.js";
import * as push from "../push.js";
import { listTime, snippetOf } from "./chat_text.js";
import { newChatDialog, newGroupDialog } from "./chat_dialogs.js";
import { createConvo } from "./chat_convo.js";

const POLL_VISIBLE = 6000;
const POLL_HIDDEN = 30000;
const MUTES_EVERY = 60000; // ovozsiz suhbatlar ro'yxati shuncha vaqtda bir qayta o'qiladi (muddati tugaganlari ham shu bilan yangilanadi)
const FILTER_FROM = 6; // shuncha suhbatdan boshlab qidiruv maydoni ko'rinadi

// Bu xatolardan keyin ro'yxatni o'zi qayta so'ramaymiz (ruxsat yo'q, messenjer o'rnatilmagan, hisob yaroqsiz)
const STOP = new Set(["no_permission", "chat_missing", "no_account", "blocked", "forbidden", "key_rejected"]);

const sameNodes = (live, next) => live.length === next.length && next.every((n, i) => live[i] === n);
const nameOf = (it) => (it.kind === "group" ? it.title : it.peer ? it.peer.name : "Suhbat");

export function chatView(ctx, { id = "", watch = null, setTitle = () => {} } = {}) {
  const me = ctx.account.id;
  const w = watch || { report() {}, drive() {} };
  let disposed = false;
  let items = [];
  let loaded = false;
  let fatal = null; // to'xtatuvchi xato: ro'yxat o'rniga tushuntirish ko'rsatiladi
  let softError = ""; // vaqtincha xato: ro'yxat saqlanadi, tepada ogohlantirish chiqadi
  let filter = "";
  let curId = "";
  let convo = null;
  let timer = null;
  let inflight = false;
  let again = false;
  let failures = 0;
  let listScroll = 0;
  const drafts = new Map(); // suhbatdan chiqib ketilganda yozib qo'yilgan matn saqlanadi
  const rowCache = new Map(); // suhbat raqami -> {sig, el}
  let mutes = new Map(); // ovozsiz suhbatlar: suhbat raqami -> {until: millisekund, 0 — doimiy}
  let mutesOk = true; // false: bildirishnoma funksiyalari bazada yo'q (5-bildirishnoma.sql): ovozsiz tugmasi ko'rinmaydi
  let mutesKnown = false; // true: ovozsiz ro'yxati bir marta muvaffaqiyatli yuklandi (bildirishnoma funksiyalari bazada borligi aniq)
  let mutesAt = 0;
  let mutesBusy = false;

  // -------------------------------------------------------------------------
  // Tuzilma
  // -------------------------------------------------------------------------
  const newBtn = h("button", { class: "btn btn--primary btn--sm", type: "button", onclick: () => startNew() }, icon("plus"), "Yangi");
  const q = h("input", { class: "input mlist__q", type: "text", name: "chatq", placeholder: "Suhbatlarni qidirish", "aria-label": "Suhbatlarni qidirish", maxlength: "60", autocomplete: "off", spellcheck: "false" });
  const qBox = h("div", { class: "mlist__search", hidden: true }, icon("search"), q);
  const note = h("div", { class: "notice notice--warn mlist__note", role: "status", hidden: true });
  const hint = h("div", { class: "notice mlist__hint", hidden: true });
  const rows = h("ul", { class: "mlist__rows" });
  const body = h("div", { class: "mlist__body" }, hint, note, rows);
  const listEl = h("aside", { class: "msgr__list", "aria-label": "Suhbatlar" }, h("header", { class: "mlist__head" }, h("h1", null, "Xabarlar"), newBtn), qBox, body);
  const pane = h("section", { class: "msgr__pane", "aria-label": "Suhbat" });
  const root = h("div", { class: "msgr" }, listEl, pane);

  const emptyPane = () =>
    h("div", { class: "msgr__empty" }, h("span", { class: "msgr__emptyico" }, icon("chat")), h("h2", null, "Suhbatni tanlang"), h("p", null, "Chapdagi ro'yxatdan suhbatni oching yoki yangisini boshlang."));

  // -------------------------------------------------------------------------
  // Ro'yxat qatorlari
  // -------------------------------------------------------------------------
  const isMuted = (cid) => {
    const m = mutes.get(cid);
    return !!m && (m.until === 0 || m.until > Date.now());
  };

  const rowSig = (it, sel) => {
    const l = it.last;
    return [nameOf(it), it.kind, it.unread, listTime(it.lastAt), l ? l.seq + ":" + l.rev + ":" + (l.sender === me ? 1 : 0) : "-", sel ? 1 : 0, it.peer && !it.peer.available ? 1 : 0, isMuted(it.id) ? 1 : 0].join("|");
  };

  function buildRow(it, sel) {
    const l = it.last;
    const own = !!l && l.sender === me;
    const text = l ? (own ? "Siz: " : "") + snippetOf(l) : it.kind === "group" ? "Guruh yaratildi" : "Hali xabar yo'q";
    const lead =
      it.kind === "group" ? h("span", { class: "av av--group", "aria-hidden": "true" }, icon("users")) : avatar({ display_name: nameOf(it), role: "user", status: it.peer && !it.peer.available ? "blocked" : "active" });
    const muted = isMuted(it.id);
    const badge = it.unread > 0 ? h("span", { class: "mrow__badge num" + (muted ? " mrow__badge--muted" : "") }, h("span", { class: "sr" }, "O'qilmagan: "), it.unread > 99 ? "99+" : String(it.unread)) : null;
    const a = h(
      "a",
      { class: "mrow" + (it.unread > 0 ? " mrow--unread" : "") + (muted ? " mrow--muted" : ""), href: "#/chat/" + it.id, dataset: { id: it.id } },
      lead,
      h(
        "span",
        { class: "mrow__main" },
        h(
          "span",
          { class: "mrow__top" },
          h("span", { class: "mrow__name" }, nameOf(it)),
          muted ? h("span", { class: "mrow__muted", title: "Bildirishnomalar ovozsiz" }, icon("belloff"), h("span", { class: "sr" }, "Bildirishnomalar ovozsiz")) : null,
          h("time", { class: "mrow__time num", datetime: it.lastAt || null }, listTime(it.lastAt)),
        ),
        h("span", { class: "mrow__bottom" }, h("span", { class: "mrow__text" }, text), badge),
      ),
    );
    if (sel) a.setAttribute("aria-current", "page");
    return h("li", { class: "mlist__item" }, a);
  }

  function renderList() {
    if (disposed) return;
    qBox.hidden = !(items.length >= FILTER_FROM || filter);
    note.hidden = !softError;
    note.textContent = softError;
    const focused = document.activeElement && rows.contains(document.activeElement) ? document.activeElement.closest("li") : null;
    let fid = "";
    for (const [k, c] of rowCache) if (c.el === focused) fid = k;
    let nodes;
    if (fatal) {
      const retry = STOP.has(fatal.code)
        ? null
        : h(
            "button",
            {
              class: "btn btn--ghost btn--sm",
              type: "button",
              onclick() {
                failures = 0;
                refreshList();
              },
            },
            icon("refresh"),
            "Qayta urinish",
          );
      nodes = [h("li", { class: "mlist__state" }, h("div", { class: "notice notice--warn", role: "alert" }, errorText(fatal)), retry)];
    } else if (!loaded) {
      nodes = [h("li", { class: "mlist__state", role: "status", "aria-label": "Yuklanmoqda" }, h("div", { class: "skel skel--short" }), h("div", { class: "skel skel--short" }), h("div", { class: "skel skel--short" }))];
    } else if (!items.length) {
      nodes = [
        h(
          "li",
          { class: "mlist__state" },
          h("div", { class: "empty empty--tight" }, h("h2", null, "Hali suhbat yo'q"), h("p", null, "Boshlash uchun odamni tanlang."), h("button", { class: "btn btn--primary", type: "button", onclick: () => startNew() }, icon("plus"), "Suhbat boshlash")),
        ),
      ];
    } else {
      const t = filter.trim().toLowerCase();
      const shown = t ? items.filter((it) => nameOf(it).toLowerCase().includes(t) || (it.peer && it.peer.login.toLowerCase().includes(t))) : items;
      if (!shown.length) nodes = [h("li", { class: "mlist__state" }, h("p", { class: "mlist__none", role: "status" }, "Hech narsa topilmadi."))];
      else {
        nodes = shown.map((it) => {
          const sig = rowSig(it, it.id === curId);
          let c = rowCache.get(it.id);
          if (!c || c.sig !== sig) {
            c = { sig, el: buildRow(it, it.id === curId) };
            rowCache.set(it.id, c);
          }
          return c.el;
        });
      }
    }
    if (!sameNodes(rows.children, nodes)) rows.replaceChildren(...nodes);
    const live = new Set(items.map((it) => it.id));
    for (const k of rowCache.keys()) if (!live.has(k)) rowCache.delete(k);
    if (fid && rowCache.has(fid) && document.activeElement !== rowCache.get(fid).el.firstElementChild) rowCache.get(fid).el.firstElementChild.focus({ preventScroll: true });
  }

  q.addEventListener("input", () => {
    filter = q.value;
    renderList();
  });
  q.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && q.value) {
      e.stopPropagation();
      q.value = "";
      filter = "";
      renderList();
    }
  });

  // -------------------------------------------------------------------------
  // Ro'yxatni yangilash
  // -------------------------------------------------------------------------
  function queueRefresh(ms) {
    clearTimeout(timer);
    if (disposed || (fatal && STOP.has(fatal.code))) return;
    const base = document.visibilityState === "visible" ? POLL_VISIBLE : POLL_HIDDEN;
    const wait = ms !== undefined ? ms : failures ? Math.min(60000, base * 2 ** Math.min(failures, 4)) : base;
    timer = setTimeout(refreshList, wait);
  }

  async function refreshList() {
    if (disposed) return;
    if (inflight) {
      again = true;
      return;
    }
    inflight = true;
    try {
      const r = await chat.listChats();
      if (disposed) return;
      failures = 0;
      fatal = null;
      softError = "";
      loaded = true;
      items = r.items;
      w.report(r.unread);
      renderList();
      if (Date.now() - mutesAt > MUTES_EVERY) loadMutes();
    } catch (e) {
      if (disposed || (e && e.fatal)) return;
      if (e && STOP.has(e.code)) {
        fatal = e;
        w.report(0);
      } else {
        failures++;
        if (!loaded) fatal = e;
        else softError = e && e.code === "network" ? "Aloqa yo'q. Ro'yxat eskirgan bo'lishi mumkin; qayta urinilmoqda…" : "Ro'yxatni yangilab bo'lmadi: " + errorText(e);
      }
      renderList();
    } finally {
      inflight = false;
      if (!disposed) {
        if (again) {
          again = false;
          queueRefresh(0);
        } else queueRefresh();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Ovozsiz suhbatlar (5-bildirishnoma.sql): ro'yxatdagi belgi va suhbat sarlavhasidagi tugma shundan foydalanadi
  // -------------------------------------------------------------------------
  const untilMs = (iso) => {
    if (!iso) return 0;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
  };

  async function loadMutes() {
    if (mutesBusy || disposed || !mutesOk) return;
    mutesBusy = true;
    mutesAt = Date.now(); // xato bo'lsa ham har oynada qayta urinmaymiz
    try {
      const list = await push.loadMutes();
      if (disposed) return;
      mutes = new Map(list.map((x) => [x.conversation_id, { until: untilMs(x.until) }]));
      mutesOk = true;
      mutesKnown = true;
      paintHint();
      renderList();
      if (convo) convo.paintMute();
    } catch (e) {
      if (disposed || (e && e.fatal)) return;
      if (e && (e.code === "push_missing" || e.code === "no_permission" || e.code === "forbidden")) {
        mutesOk = false;
        paintHint();
        if (convo) convo.paintMute();
      }
    } finally {
      mutesBusy = false;
    }
  }

  const muteApi = {
    available: () => mutesOk,
    state(cid) {
      const m = mutes.get(cid);
      return isMuted(cid) ? { muted: true, until: m.until } : { muted: false, until: 0 };
    },
    async set(cid, minutes) {
      const r = await push.mute(cid, minutes);
      mutes.set(cid, { until: untilMs(r && r.until) });
      renderList();
    },
    async clear(cid) {
      await push.unmute(cid);
      mutes.delete(cid);
      renderList();
    },
  };

  // -------------------------------------------------------------------------
  // «Bildirishnomani yoqing» eslatmasi (bir marta, yopilguncha)
  // -------------------------------------------------------------------------
  function paintHint() {
    // Eslatma faqat bildirishnoma funksiyalari bazada borligi aniq bo'lgach chiqadi: yo'q bo'lsa foydalanuvchi uni baribir yoqa olmaydi
    const want = !disposed && mutesKnown && mutesOk && push.hintWanted(ctx.account);
    hint.hidden = !want;
    if (!want) {
      hint.replaceChildren();
      return;
    }
    if (hint.firstChild) return;
    hint.append(
      h("p", null, "Yangi xabar kelganda telefon yoki kompyuteringizga bildirishnoma kelishi uchun uni yoqing."),
      h(
        "div",
        { class: "mlist__hint-acts" },
        h("a", { class: "btn btn--ghost btn--sm", href: "#/cabinet/bildirishnoma" }, icon("bell"), "Sozlash"),
        h(
          "button",
          {
            class: "btn btn--quiet btn--sm",
            type: "button",
            onclick() {
              push.dismissHint(ctx.account);
              paintHint();
            },
          },
          "Hozir emas",
        ),
      ),
    );
  }
  const offPush = push.onChange(paintHint);

  const wake = () => {
    if (disposed || document.visibilityState !== "visible") return;
    failures = 0;
    if (!(fatal && STOP.has(fatal.code))) queueRefresh(0);
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);

  // -------------------------------------------------------------------------
  // Yangi suhbat / guruh
  // -------------------------------------------------------------------------
  const go = (cid) => {
    location.hash = "#/chat/" + cid;
  };

  async function startNew() {
    let r = await newChatDialog({ canGroup: true });
    if (disposed) return;
    if (r && r.group) r = await newGroupDialog();
    if (disposed || !r || !r.open) return;
    queueRefresh(0);
    go(r.open);
  }

  // -------------------------------------------------------------------------
  // Suhbat ekrani
  // -------------------------------------------------------------------------
  const makeHost = (it) => ({
    touch: () => queueRefresh(700),
    back: () => {
      location.hash = "#/chat";
    },
    title: (t) => setTitle(t),
    unread(cid, total) {
      const row = items.find((x) => x.id === cid);
      if (row && row.unread) {
        row.unread = 0;
        renderList();
      }
      w.report(total);
    },
    drafts,
    mute: muteApi,
    hint: it ? { title: nameOf(it) } : null,
  });

  function closeConvo() {
    if (convo) {
      try {
        convo.dispose();
      } catch {
        /* tozalash xatosi ekranni to'xtatmasin */
      }
      convo = null;
    }
  }

  function route(next) {
    const nid = next || "";
    if (disposed || (nid === curId && (convo || !nid))) return;
    const leaving = curId;
    if (!leaving) listScroll = body.scrollTop;
    closeConvo();
    curId = nid;
    root.classList.toggle("msgr--open", !!nid);
    if (nid) {
      const it = items.find((x) => x.id === nid) || null;
      const c = createConvo({ id: nid, ctx, host: makeHost(it) });
      convo = c;
      pane.replaceChildren(c.el);
      // Fokus bo'lim sahifaga qo'yilgandan va asosiy qismga fokus berilgandan keyin suhbat sarlavhasiga o'tadi
      queueMicrotask(() => {
        if (!disposed && convo === c && root.isConnected) c.focusHead();
      });
    } else {
      pane.replaceChildren(emptyPane());
      setTitle("Xabarlar");
      body.scrollTop = listScroll;
    }
    renderList();
    if (!nid && leaving) {
      const c = rowCache.get(leaving);
      if (c) c.el.firstElementChild.focus({ preventScroll: true });
    }
  }

  // -------------------------------------------------------------------------
  // Boshlash
  // -------------------------------------------------------------------------
  w.drive(true);
  renderList();
  pane.replaceChildren(emptyPane());
  paintHint();
  loadMutes();
  refreshList();
  if (id) route(id);

  return {
    el: root,
    title: "Xabarlar",
    route,
    /** Xizmat ishchisi yangi turtki haqida xabar berdi: ro'yxat darhol yangilanadi */
    poke() {
      if (!disposed) queueRefresh(0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offPush();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      closeConvo();
      w.drive(false);
    },
  };
}
