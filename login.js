// Kirish ekrani: login + parol. Ro'yxatdan o'tish yo'q — hisobni administrator yaratadi.
import { h } from "../dom.js";
import * as api from "../api.js";
import { busy, checkbox, field, notice, pwField, textInput } from "../ui.js";
import { introFrame } from "./intro.js";

export function loginView({ flash, onDone }) {
  const loginField = field({
    label: "Login",
    input: textInput({ name: "username", autocomplete: "username", autofocus: !flash }),
  });
  const pw = pwField({ label: "Parol", name: "password", autocomplete: "current-password" });
  const remember = checkbox({ name: "remember", label: "Bu qurilmada tizimda qolish", checked: true });
  const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
  const btn = h("button", { class: "btn btn--primary btn--block", type: "submit" }, "Kirish");

  const form = h(
    "form",
    {
      class: "form",
      novalidate: true,
      async onsubmit(e) {
        e.preventDefault();
        err.hidden = true;
        loginField.error("");
        pw.error("");
        const login = loginField.input.value.trim().toLowerCase();
        const password = pw.input.value;
        if (!login) {
          loginField.error("Loginni kiriting.");
          loginField.input.focus();
          return;
        }
        if (!password) {
          pw.error("Parolni kiriting.");
          pw.input.focus();
          return;
        }
        await busy(btn, async () => {
          try {
            await api.signIn(login, password, remember.input.checked);
            pw.input.value = "";
            onDone();
          } catch (ex) {
            err.textContent = ex && ex.message ? ex.message : "Kirib bo'lmadi.";
            err.hidden = false;
            if (ex && ex.code === "bad_credentials") {
              pw.input.value = "";
              pw.input.focus();
            }
          }
        });
      },
    },
    flash ? notice(flash.kind, flash.text) : null,
    loginField.el,
    pw.el,
    remember.el,
    err,
    btn,
  );

  return introFrame([
    h("div", { class: "intro__head" }, h("h1", null, "OrbicXs"), h("p", null, "Yopiq platforma. Hisobni administrator beradi.")),
    form,
    h("p", { class: "intro__foot" }, "Hisobingiz yo'qmi yoki parolni unutdingizmi? Administratorga murojaat qiling."),
  ]);
}
