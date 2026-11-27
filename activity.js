// Kabinet → Xavfsizlik → «So'nggi hodisalar»: hisobingizda nimalar bo'lgani (parol, 2FA, seanslar, bildirishnoma, administrator amallari).
// Faqat o'z hisobingizga tegishli hodisalar ko'rinadi; ruxsatni server (ox_my_activity) tekshiradi.
import { h, icon, fmtDate } from "../dom.js";
import { errorText, toast } from "../ui.js";
import { activityIcon, activityText, actorText } from "../parts.js";
import * as push from "../push.js";

const FIRST = 30;
const MORE = 100;

// Boshqa odam (administrator, tizim) qilgan hodisa va g'ayrioddiy hodisalar ajratib ko'rsatiladi
const isAlert = (ev) => ev.action === "password.change_failed" || ev.action === "account.block" || ev.action === "account.reset_mfa" || ev.action === "password.reset";

export function activityPanel() {
  let items = null; // null — hali yuklanmagan
  let error = null;
  let loading = false;
  let limit = FIRST;
  let gen = 0;
  let disposed = false;

  const list = h("div", { class: "sess actlog", role: "list", "aria-label": "Hisobingizdagi so'nggi hodisalar" });
  const moreBtn = h("button", { class: "btn btn--ghost", type: "button", hidden: true, onclick: () => showMore() }, "Yana ko'rsatish");
  const reloadBtn = h("button", { class: "btn btn--quiet", type: "button", onclick: () => load() }, icon("refresh"), "Yangilash");
  const actions = h("div", { class: "section__actions" }, moreBtn, reloadBtn);
  const el = h("div", { class: "sesswrap" }, list, actions);

  function row(ev) {
    const by = actorText(ev.by);
    const meta = [h("span", null, fmtDate(ev.at))];
    if (by) meta.push(h("span", null, "Qilgan: " + by));
    if (ev.ip) meta.push(h("span", { class: "num" }, "IP " + ev.ip));
    return h(
      "div",
      { class: "sess__row actlog__row", role: "listitem", dataset: { action: ev.action, alert: isAlert(ev) ? "true" : "false" } },
      h("span", { class: "sess__ico", "aria-hidden": "true" }, icon(activityIcon(ev.action))),
      h("div", { class: "sess__main" }, h("div", { class: "sess__title" }, h("span", { class: "actlog__text" }, activityText(ev))), h("div", { class: "sess__meta" }, meta)),
    );
  }

  function paint() {
    reloadBtn.disabled = loading;
    if (items === null) {
      moreBtn.hidden = true;
      if (error) {
        // Baza yangilanmagan bo'lsa qayta urinish foydasiz (bildirishnoma kartasidagi kabi): faqat tushuntirish
        const retry = error.code === "push_missing" ? null : h("button", { class: "btn btn--ghost", type: "button", onclick: () => load() }, icon("refresh"), "Qayta urinish");
        list.replaceChildren(h("div", { class: "empty empty--tight" }, h("p", null, errorText(error)), retry));
      } else {
        list.replaceChildren(h("div", { class: "skel skel--short" }), h("div", { class: "skel skel--short" }));
      }
      return;
    }
    list.replaceChildren(...(items.length ? items.map(row) : [h("div", { class: "empty empty--tight" }, h("p", null, "Hozircha hodisa yo'q."))]));
    moreBtn.hidden = !(items.length >= limit && limit < MORE);
    moreBtn.disabled = loading;
  }

  async function load() {
    if (loading || disposed) return;
    const mine = ++gen;
    loading = true;
    error = null;
    paint();
    try {
      const d = await push.loadActivity(limit);
      if (mine !== gen || disposed) return;
      items = d;
    } catch (e) {
      if (mine !== gen || disposed || (e && e.fatal)) return;
      if (items === null) error = e;
      else toast("error", errorText(e)); // eski ro'yxat o'z joyida qoladi
    } finally {
      if (mine === gen) {
        loading = false;
        paint();
      }
    }
  }

  function showMore() {
    limit = MORE;
    load();
  }

  paint();
  load();
  return {
    el,
    reload: load,
    dispose() {
      disposed = true;
    },
  };
}
