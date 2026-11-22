// Parolni almashtirish formasi: majburiy almashtirish ekranida ham, kabinetda ham shu forma ishlatiladi.
import { h } from "../dom.js";
import * as api from "../api.js";
import { busy, errorText, passwordRules, pwField } from "../ui.js";

const FIELD_ERRORS = {
  wrong_password: "cur",
  same_password: "next",
  password_too_short: "next",
  password_too_long: "next",
  password_weak: "next",
  password_has_login: "next",
  invalid_password: "next",
  weak_password: "next",
};

export function passwordForm({ login, onSaved, submitText = "Parolni saqlash" }) {
  const rules = passwordRules({ login, needsDiff: true });
  const cur = pwField({ label: "Joriy parol", name: "current", autocomplete: "current-password" });
  const next = pwField({ label: "Yangi parol", name: "new", autocomplete: "new-password" });
  const again = pwField({ label: "Yangi parolni takrorlang", name: "repeat", autocomplete: "new-password" });
  const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
  const btn = h("button", { class: "btn btn--primary", type: "submit" }, submitText);
  const refresh = () => rules.check(next.input.value, cur.input.value);
  cur.input.addEventListener("input", refresh);
  next.input.addEventListener("input", refresh);

  const el = h(
    "form",
    {
      class: "form",
      novalidate: true,
      async onsubmit(e) {
        e.preventDefault();
        err.hidden = true;
        cur.error("");
        next.error("");
        again.error("");
        const current = cur.input.value;
        const proposed = next.input.value;
        if (!current) {
          cur.error("Joriy parolni kiriting.");
          cur.input.focus();
          return;
        }
        if (!rules.check(proposed, current, { flag: true })) {
          next.error("Yangi parol quyidagi talablarga javob bersin.");
          next.input.focus();
          return;
        }
        if (proposed !== again.input.value) {
          again.error("Ikki parol bir xil emas.");
          again.input.focus();
          return;
        }
        await busy(btn, async () => {
          try {
            const res = await api.call("change_password", { current_password: current, new_password: proposed });
            cur.input.value = next.input.value = again.input.value = "";
            refresh();
            await onSaved(res);
          } catch (ex) {
            if (ex && ex.fatal) return;
            const where = FIELD_ERRORS[ex && ex.code];
            if (where === "cur") {
              cur.error(errorText(ex));
              cur.input.focus();
            } else if (where === "next") {
              next.error(errorText(ex));
              next.input.focus();
            } else {
              err.textContent = errorText(ex);
              err.hidden = false;
            }
          }
        });
      },
    },
    cur.el,
    next.el,
    rules.el,
    again.el,
    err,
    h("div", { class: "section__actions" }, btn),
  );
  return { el, focus: () => cur.input.focus() };
}
