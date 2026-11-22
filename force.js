// Birinchi kirishda (yoki administrator parolni tiklagandan so'ng) majburiy parol almashtirish ekrani.
import { h } from "../dom.js";
import { introFrame } from "./intro.js";
import { passwordForm } from "./password.js";

export function forceView({ account, onSaved, onSignOut }) {
  const form = passwordForm({ login: account.login, onSaved });
  const view = introFrame([
    h(
      "div",
      { class: "intro__head" },
      h("h1", null, "Yangi parol tanlang"),
      h("p", null, "Salom, " + account.display_name + ". Administrator sizga vaqtinchalik parol bergan. Davom etishdan oldin o'zingizning parolingizni qo'ying."),
    ),
    form.el,
    h("div", { class: "intro__actions" }, h("button", { class: "btn btn--quiet", type: "button", onclick: onSignOut }, "Chiqish")),
  ]);
  return { el: view, focus: form.focus };
}
