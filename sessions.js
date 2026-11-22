// Faol seanslar (hisobga kirilgan qurilmalar) ro'yxati. Har kim o'zinikini ko'radi va yopa oladi;
// administrator boshqa odamniki uchun ham shuni ishlatadi. Ruxsatni server tekshiradi (ox-api: sessions, revoke_sessions).
import { h, icon, fmtDate, relTime } from "../dom.js";
import * as api from "../api.js";
import { busy, confirmDialog, errorText, toast } from "../ui.js";
import { deviceIcon, deviceLabel, warningTexts } from "../parts.js";

const activity = (s) => Date.parse(s.refreshed_at || s.created_at || "") || 0;

// userId: null — o'z seanslari. person: boshqa odam bo'lsa, tasdiqlash oynasida ko'rsatiladigan nom («Ism» (@login)).
// onChange() — seans yopilgach (ro'yxatlarni yangilash uchun); onSelfClosed() — yopilganlar orasida shu qurilmaning o'zi bo'lsa.
// extra — tugmalar qatoriga qo'shiladigan qo'shimcha tugmalar (kabinetdagi «Barcha qurilmalardan chiqish»).
export function sessionsPanel({ ctx, userId = null, person = "", extra = [], onChange = () => {}, onSelfClosed = () => {} }) {
  const own = userId === null || userId === ctx.account.id;
  const params = () => (own ? {} : { id: userId });
  let items = null; // null — hali yuklanmagan
  let total = 0;
  let error = null;
  let loading = false;
  let gen = 0;

  const list = h("div", { class: "sess", role: "list", "aria-label": own ? "Sizning seanslaringiz" : "Seanslar" });
  const note = h("p", { class: "field__hint", hidden: true });
  const bulkBtn = h("button", { class: "btn btn--ghost", type: "button", dataset: { act: "revoke-bulk" }, onclick: () => bulk() }, own ? "Boshqa qurilmalardan chiqish" : "Barcha seanslarni yopish");
  const reloadBtn = h("button", { class: "btn btn--quiet", type: "button", onclick: () => load() }, icon("refresh"), "Yangilash");
  const actions = h("div", { class: "section__actions" }, bulkBtn, extra, reloadBtn);

  function sorted() {
    return (items || []).slice().sort((a, b) => Number(b.current) - Number(a.current) || activity(b) - activity(a));
  }

  function row(s) {
    const label = deviceLabel(s.user_agent);
    let closeBtn = null;
    if (!s.current) {
      closeBtn = h("button", { class: "btn btn--ghost btn--sm", type: "button", dataset: { act: "revoke-one" }, "aria-label": "Seansni yopish — " + label }, "Chiqarish");
      closeBtn.addEventListener("click", () => revokeOne(s, closeBtn));
    }
    return h(
      "div",
      { class: "sess__row", role: "listitem", dataset: { sid: s.id, current: s.current ? "true" : "false" } },
      h("span", { class: "sess__ico", "aria-hidden": "true" }, icon(deviceIcon(s.user_agent))),
      h(
        "div",
        { class: "sess__main" },
        h(
          "div",
          { class: "sess__title" },
          h("span", { class: "sess__name", title: s.user_agent || "" }, label),
          s.current ? h("span", { class: "who__you" }, "Shu qurilma") : null,
          s.aal === "aal2" ? h("span", { class: "who__you" }, "2FA") : null,
        ),
        h(
          "div",
          { class: "sess__meta" },
          s.ip ? h("span", { class: "num" }, "IP " + s.ip) : null,
          h("span", null, "Kirgan: " + fmtDate(s.created_at)),
          s.refreshed_at ? h("span", null, "Oxirgi faollik: " + relTime(s.refreshed_at)) : null,
        ),
      ),
      closeBtn,
    );
  }

  function paint() {
    reloadBtn.disabled = loading;
    if (items === null) {
      bulkBtn.hidden = true;
      note.hidden = true;
      if (error) {
        list.replaceChildren(
          h(
            "div",
            { class: "empty empty--tight" },
            h("p", null, errorText(error)),
            h("button", { class: "btn btn--ghost", type: "button", onclick: () => load() }, icon("refresh"), "Qayta urinish"),
          ),
        );
      } else list.replaceChildren(h("div", { class: "skel skel--short" }), h("div", { class: "skel skel--short" }));
      return;
    }
    bulkBtn.hidden = false;
    bulkBtn.disabled = own ? items.filter((s) => !s.current).length === 0 : items.length === 0;
    if (!items.length) {
      list.replaceChildren(h("div", { class: "empty empty--tight" }, h("p", null, own ? "Faol seans topilmadi." : "Faol seans yo'q: hisob hozir hech qayerda kirmagan.")));
    } else {
      list.replaceChildren(...sorted().map(row));
    }
    note.hidden = !(total > items.length);
    if (!note.hidden) note.textContent = "Ro'yxatda eng yangi " + items.length + " ta seans ko'rsatilgan (jami " + total + " ta).";
  }

  async function load() {
    if (loading) return;
    const mine = ++gen;
    loading = true;
    error = null;
    paint();
    try {
      const d = await api.call("sessions", params());
      if (mine !== gen) return;
      items = Array.isArray(d.sessions) ? d.sessions : [];
      total = Number.isInteger(d.total) ? d.total : items.length;
    } catch (e) {
      if (mine !== gen || (e && e.fatal)) return;
      if (items === null) error = e;
      else toast("error", errorText(e));
    } finally {
      if (mine === gen) {
        loading = false;
        paint();
      }
    }
  }

  function after(res) {
    if (res && res.relogin) {
      onSelfClosed(res);
      return;
    }
    const n = res && Number.isInteger(res.revoked) ? res.revoked : 0;
    toast(n > 0 ? "ok" : "info", n > 0 ? n + " ta seans yopildi." : "Yopiladigan seans topilmadi: u allaqachon yopilgan.");
    for (const t of warningTexts(res && res.warnings)) toast("warn", t);
    onChange();
    load();
  }

  async function revokeOne(s, btn) {
    await busy(btn, async () => {
      try {
        after(await api.call("revoke_sessions", { ...params(), scope: "one", session_id: s.id }));
      } catch (ex) {
        if (ex && ex.fatal) return;
        toast("error", errorText(ex));
      }
    });
  }

  async function bulk() {
    const r = await confirmDialog({
      title: own ? "Boshqa qurilmalardan chiqasizmi?" : "Barcha seanslarni yopasizmi?",
      lead: own
        ? "Shu qurilmadan tashqari barcha qurilmalardagi seanslaringiz yopiladi. Ularda qayta kirish kerak bo'ladi. Begona odam kirgan bo'lishi mumkin deb o'ylasangiz, shundan foydalaning."
        : person + " barcha qurilmalardan chiqariladi va qayta kirishi kerak bo'ladi. Hisobning o'zi bloklanmaydi.",
      confirmText: own ? "Boshqa qurilmalardan chiqish" : "Barchasini yopish",
      danger: true,
      run: () => api.call("revoke_sessions", { ...params(), scope: own ? "others" : "all" }),
    });
    if (r && r.result) after(r.result);
  }

  const el = h("div", { class: "sesswrap" }, list, note, actions);
  paint();
  load();
  return { el, reload: load };
}
