// Messenjer oynalari: yangi suhbat, yangi guruh, guruh haqida (a'zolar), rasmni kattalashtirib ko'rish.
import { h, icon, debounce } from "../dom.js";
import { busy, confirmDialog, dialog, errorText, field, textInput, toast } from "../ui.js";
import { avatar } from "../parts.js";
import * as chat from "../chatapi.js";

const person = (name) => ({ display_name: name, role: "user", status: "active" });
// Telefonda maydonga avtomatik fokus berilmaydi: ekran klaviaturasi ro'yxatning yarmini yopib qo'yadi
const focusSoon = (el) => {
  if (!window.matchMedia("(pointer: coarse)").matches) queueMicrotask(() => el.focus());
};

// ---------------------------------------------------------------------------
// Odam tanlash: qidiruv + ro'yxat (bitta yoki bir nechta tanlash)
// ---------------------------------------------------------------------------
function picker({ multi = false, exclude = new Set(), limit = 0, onPick, onChange }) {
  const q = textInput({ name: "q", placeholder: "Ism yoki login bo'yicha qidirish", maxlength: 60 });
  q.setAttribute("aria-label", "Odam qidirish");
  const list = h("div", { class: "picker__list", role: multi ? "group" : "list", "aria-label": "Odamlar" });
  const status = h("p", { class: "picker__status", role: "status", "aria-live": "polite" });
  const chosen = new Map();
  const boxes = new Map();
  let ticket = 0;
  let disabled = false;

  const who = (p) => h("span", { class: "prow__who" }, h("span", { class: "prow__name" }, p.name), h("span", { class: "prow__login" }, "@" + p.login));

  function syncBoxes() {
    for (const [id, cb] of boxes) cb.disabled = disabled || (!chosen.has(id) && limit > 0 && chosen.size >= limit);
  }

  function row(p) {
    if (!multi) {
      return h("button", { class: "prow", type: "button", dataset: { id: p.id }, disabled, onclick: () => onPick && onPick(p) }, avatar(person(p.name), { size: "sm" }), who(p));
    }
    const cb = h("input", {
      type: "checkbox",
      checked: chosen.has(p.id),
      "aria-label": p.name,
      onchange() {
        if (cb.checked) chosen.set(p.id, p);
        else chosen.delete(p.id);
        syncBoxes();
        if (onChange) onChange([...chosen.values()]);
      },
    });
    boxes.set(p.id, cb);
    return h("label", { class: "prow", dataset: { id: p.id } }, cb, avatar(person(p.name), { size: "sm" }), who(p));
  }

  async function load() {
    const my = ++ticket;
    status.textContent = "Yuklanmoqda…";
    try {
      const rows = (await chat.directory(q.value)).filter((p) => !exclude.has(p.id));
      if (my !== ticket) return;
      boxes.clear();
      list.replaceChildren(...rows.map(row));
      syncBoxes();
      status.textContent = rows.length ? "" : q.value.trim() ? "Hech kim topilmadi." : "Suhbatlashish mumkin bo'lgan boshqa odam yo'q.";
    } catch (e) {
      if (my !== ticket || (e && e.fatal)) return;
      list.replaceChildren();
      status.textContent = errorText(e);
    }
  }
  const later = debounce(load, 250);
  q.addEventListener("input", later);
  load();

  return {
    el: h("div", { class: "picker" }, q, status, list),
    selected: () => [...chosen.values()],
    setDisabled(v) {
      disabled = !!v;
      q.disabled = disabled;
      for (const b of list.querySelectorAll("button.prow")) b.disabled = disabled;
      syncBoxes();
    },
  };
}

const errBox = () => h("div", { class: "notice notice--bad", role: "alert", hidden: true });
const showErr = (box, e) => {
  box.textContent = errorText(e);
  box.hidden = false;
};

// ---------------------------------------------------------------------------
// Yangi suhbat: odamni tanlasangiz, shaxsiy suhbat ochiladi (bo'lsa, o'sha). Natija: {open: suhbatId} | {group: true} | undefined
// ---------------------------------------------------------------------------
export function newChatDialog({ canGroup = true } = {}) {
  return dialog({
    title: "Yangi suhbat",
    build(close) {
      const err = errBox();
      const pk = picker({
        async onPick(p) {
          err.hidden = true;
          pk.setDisabled(true);
          try {
            const r = await chat.openDm(p.id);
            close({ open: r.id });
          } catch (e) {
            if (e && e.fatal) {
              close(undefined);
              return;
            }
            showErr(err, e);
            pk.setDisabled(false);
          }
        },
      });
      const cancel = h("button", { class: "btn btn--ghost", type: "button", onclick: () => close(undefined) }, "Bekor qilish");
      const grp = canGroup ? h("button", { class: "btn btn--ghost", type: "button", onclick: () => close({ group: true }) }, icon("users"), "Yangi guruh") : null;
      focusSoon(pk.el.querySelector("input"));
      return { body: [h("p", { class: "dlg__lead" }, "Suhbatlashmoqchi bo'lgan odamni tanlang."), pk.el, err], foot: [cancel, grp] };
    },
  });
}

// ---------------------------------------------------------------------------
// Yangi guruh. Natija: {open: suhbatId} | undefined
// ---------------------------------------------------------------------------
export function newGroupDialog() {
  return dialog({
    title: "Yangi guruh",
    wide: true,
    build(close) {
      const err = errBox();
      const title = field({ label: "Guruh nomi", input: textInput({ name: "title", maxlength: chat.LIMITS.title, placeholder: "Masalan: Loyiha jamoasi", capitalize: "sentences" }) });
      const count = h("p", { class: "picker__count num" }, "");
      const submit = h("button", { class: "btn btn--primary", type: "submit", disabled: true }, "Guruh yaratish");
      const limit = chat.LIMITS.groupMax - 1;
      const sync = () => {
        const n = pk.selected().length;
        count.textContent = n ? "Tanlandi: " + n + " / " + limit : "Kamida bitta a'zoni tanlang.";
        submit.disabled = n < 1 || !title.input.value.trim();
      };
      const pk = picker({ multi: true, limit, onChange: sync });
      title.input.addEventListener("input", sync);
      sync();
      const formId = "grp-form";
      const form = h(
        "form",
        {
          id: formId,
          class: "form",
          novalidate: true,
          async onsubmit(e) {
            e.preventDefault();
            err.hidden = true;
            title.error("");
            const t = title.input.value.replace(/\s+/g, " ").trim();
            if (!t) {
              title.error("Guruh nomini kiriting.");
              title.input.focus();
              return;
            }
            if ([...t].length > chat.LIMITS.title) {
              title.error("Guruh nomi " + chat.LIMITS.title + " belgidan oshmasin.");
              return;
            }
            await busy(submit, async () => {
              try {
                const r = await chat.createGroup(t, pk.selected().map((p) => p.id));
                close({ open: r.id });
              } catch (ex) {
                if (ex && ex.fatal) {
                  close(undefined);
                  return;
                }
                showErr(err, ex);
              }
            });
            sync();
          },
        },
        title.el,
        h("div", { class: "field" }, h("span", { class: "field__label" }, "A'zolar"), pk.el, count),
        err,
      );
      submit.setAttribute("form", formId);
      const cancel = h("button", { class: "btn btn--ghost", type: "button", onclick: () => close(undefined) }, "Bekor qilish");
      focusSoon(title.input);
      return { body: form, foot: [cancel, submit] };
    },
  });
}

// ---------------------------------------------------------------------------
// A'zo qo'shish (guruh egasi). Natija: true (qo'shildi) | undefined
// ---------------------------------------------------------------------------
function addMembersDialog({ conv, existing }) {
  return dialog({
    title: "A'zo qo'shish",
    wide: true,
    build(close) {
      const err = errBox();
      const room = Math.max(0, chat.LIMITS.groupMax - existing.size);
      const count = h("p", { class: "picker__count num" }, "");
      const submit = h("button", { class: "btn btn--primary", type: "button", disabled: true }, "Qo'shish");
      const sync = () => {
        const n = pk.selected().length;
        count.textContent = n ? "Tanlandi: " + n + " / " + room : "Qo'shiladigan odamlarni tanlang (yana " + room + " tagacha).";
        submit.disabled = n < 1;
      };
      const pk = picker({ multi: true, exclude: existing, limit: room, onChange: sync });
      sync();
      submit.addEventListener("click", () =>
        busy(submit, async () => {
          err.hidden = true;
          try {
            await chat.addMembers(conv, pk.selected().map((p) => p.id));
            close(true);
          } catch (ex) {
            if (ex && ex.fatal) {
              close(undefined);
              return;
            }
            showErr(err, ex);
          }
        }),
      );
      const cancel = h("button", { class: "btn btn--ghost", type: "button", onclick: () => close(undefined) }, "Bekor qilish");
      focusSoon(pk.el.querySelector("input"));
      return { body: [pk.el, count, err], foot: [cancel, submit] };
    },
  });
}

// ---------------------------------------------------------------------------
// Guruh haqida: nom, a'zolar; egasi nomni o'zgartiradi, a'zo qo'shadi/chiqaradi; har kim guruhdan chiqa oladi.
// convo: {info() -> {conv, members, me}, refresh()}. Natija: {left: true} | undefined
// ---------------------------------------------------------------------------
export function groupInfoDialog({ convo }) {
  return dialog({
    title: "Guruh haqida",
    wide: true,
    build(close, dlg) {
      const body = h("div", { class: "ginfo" });
      const err = errBox();

      async function act(fn) {
        err.hidden = true;
        try {
          await fn();
          await convo.refresh();
          draw();
        } catch (e) {
          if (e && e.fatal) {
            close(undefined);
            return;
          }
          showErr(err, e);
          toast("error", errorText(e));
        }
      }

      function draw() {
        const { conv, members, me } = convo.info();
        const owner = conv.role === "owner";
        const kids = [];

        // nom
        if (owner) {
          const t = field({ label: "Guruh nomi", input: textInput({ name: "gtitle", value: conv.title, maxlength: chat.LIMITS.title, capitalize: "sentences" }) });
          const save = h("button", { class: "btn btn--ghost btn--sm", type: "submit" }, "Saqlash");
          kids.push(
            h(
              "form",
              {
                class: "ginfo__rename",
                novalidate: true,
                onsubmit(e) {
                  e.preventDefault();
                  t.error("");
                  const v = t.input.value.replace(/\s+/g, " ").trim();
                  if (!v) {
                    t.error("Guruh nomini kiriting.");
                    return;
                  }
                  if (v === conv.title) return;
                  busy(save, () => act(() => chat.renameGroup(conv.id, v)));
                },
              },
              t.el,
              save,
            ),
          );
        } else {
          kids.push(h("h3", { class: "ginfo__title" }, conv.title));
        }

        // a'zolar
        kids.push(h("h3", { class: "ginfo__sub" }, "A'zolar (" + members.length + ")"));
        const ul = h("ul", { class: "ginfo__list" });
        for (const m of members) {
          const mine = m.id === me;
          const row = h(
            "li",
            { class: "prow prow--static", dataset: { id: m.id } },
            avatar(person(m.name), { size: "sm" }),
            h("span", { class: "prow__who" }, h("span", { class: "prow__name" }, m.name + (mine ? " (siz)" : "")), h("span", { class: "prow__login" }, "@" + m.login + (m.available ? "" : " · hozir faol emas"))),
            m.role === "owner" ? h("span", { class: "tag tag--admin" }, h("span", { class: "tag__ring" }), "Egasi") : null,
          );
          if (owner && !mine) {
            const rm = h("button", { class: "iconbtn iconbtn--danger", type: "button", "aria-label": m.name + "ni guruhdan chiqarish", title: "Guruhdan chiqarish" }, icon("x"));
            rm.addEventListener("click", async () => {
              const r = await confirmDialog({
                title: "A'zoni chiqarasizmi?",
                lead: m.name + " guruhdan chiqariladi va keyingi xabarlarni ko'rmaydi.",
                confirmText: "Chiqarish",
                danger: true,
                run: () => chat.removeMember(conv.id, m.id),
              });
              if (r && r.ok) {
                await convo.refresh();
                draw();
              }
            });
            row.append(rm);
          }
          ul.append(row);
        }
        kids.push(ul);

        // amallar
        const acts = h("div", { class: "ginfo__acts" });
        if (owner) {
          const add = h("button", { class: "btn btn--ghost", type: "button", disabled: members.length >= chat.LIMITS.groupMax }, icon("userplus"), "A'zo qo'shish");
          add.addEventListener("click", async () => {
            const ok = await addMembersDialog({ conv: conv.id, existing: new Set(members.map((m) => m.id)) });
            if (ok) {
              await convo.refresh();
              draw();
            }
          });
          acts.append(add);
        }
        const leave = h("button", { class: "btn btn--ghost btn--danger-ghost", type: "button" }, icon("logout"), "Guruhdan chiqish");
        leave.addEventListener("click", async () => {
          const r = await confirmDialog({
            title: "Guruhdan chiqasizmi?",
            lead: owner && members.length > 1 ? "Siz guruh egasisiz: chiqsangiz, egalik eng eski a'zoga o'tadi. Qayta kirish uchun yangi egasi sizni qo'shishi kerak." : "Qayta kirish uchun guruh egasi sizni qo'shishi kerak." + (members.length <= 1 ? " Siz oxirgi a'zosiz: chiqsangiz, guruh butunlay o'chadi." : ""),
            confirmText: "Chiqish",
            danger: true,
            run: () => chat.leaveGroup(conv.id),
          });
          if (r && r.ok) close({ left: true });
        });
        acts.append(leave);
        kids.push(acts, err);
        body.replaceChildren(...kids);
      }
      draw();
      const done = h("button", { class: "btn btn--primary", type: "button", onclick: () => close(undefined) }, "Yopish");
      return { body, foot: [done] };
    },
  });
}

// ---------------------------------------------------------------------------
// Rasmni kattalashtirib ko'rish
// ---------------------------------------------------------------------------
export function lightbox({ url, name, onSave }) {
  return dialog({
    title: name || "Rasm",
    wide: true,
    build(close) {
      const img = h("img", { class: "lightbox__img", src: url, alt: name || "Rasm" });
      const save = h("button", { class: "btn btn--ghost", type: "button" }, icon("download"), "Yuklab olish");
      save.addEventListener("click", () => busy(save, async () => onSave && onSave()));
      const done = h("button", { class: "btn btn--primary", type: "button", onclick: () => close(undefined) }, "Yopish");
      return { body: h("div", { class: "lightbox" }, img), foot: [save, done] };
    },
  });
}
