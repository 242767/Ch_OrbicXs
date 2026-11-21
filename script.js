const worlds = {
  universe: {
    eyebrow: "A SKY FULL OF STORIES",
    title: "Sizning kichik koinotingiz",
    body: "Bu yerda har bir yulduz alohida ma’noga ega. Ularni tanlang va kichik xabarlarni kashf eting.",
    note: "Yulduzlar orasida sayr qiling."
  },
  memories: {
    eyebrow: "MOMENTS TO KEEP",
    title: "Qadrli lahzalar",
    body: "Bu bo‘limga birgalikdagi suratlar, esdaliklar va ular bilan bog‘liq kichik hikoyalarni joylashtirish mumkin.",
    note: "Haqiqiy xotiralar keyinroq qo‘shiladi."
  },
  letters: {
    eyebrow: "WORDS FROM THE HEART",
    title: "Sizga atalgan maktub",
    body: "Ba’zi so‘zlarni shoshilmasdan o‘qish kerak. Bu maktub siz uchun alohida tayyorlangan.",
    note: "Maktubni ochish uchun quyidagi tugmani bosing."
  },
  garden: {
    eyebrow: "A QUIET PLACE",
    title: "Sehrli bog‘",
    body: "Oltin shu’lalar, nafis gullar va sokin bir olam. Bu yerda biroz to‘xtab, atrofni tomosha qiling.",
    note: "Bu bog‘da vaqt sekinroq o‘tadi."
  },
  secret: {
    eyebrow: "ONE LAST LITTLE SURPRISE",
    title: "Yashirin sir",
    body: "Siz virtual olamning yashirin burchagiga yetib keldingiz. Eng muhim xabar shu yerda kutmoqda.",
    note: "Bu joyning matnini sovg‘a egasi o‘zi belgilaydi."
  }
};

const recipient = "Someone Special"; // Shu yerga ismni yozing.
document.getElementById("recipientName").textContent = recipient.toUpperCase();
document.getElementById("chipName").textContent = recipient;

const backdrop = document.getElementById("panelBackdrop");
const panelEyebrow = document.getElementById("panelEyebrow");
const panelTitle = document.getElementById("panelTitle");
const panelBody = document.getElementById("panelBody");
const panelAction = document.getElementById("panelAction");
const backLink = document.getElementById("backLink");

function openWorld(id) {
  const item = worlds[id];
  if (!item) return;
  panelEyebrow.textContent = item.eyebrow;
  panelTitle.textContent = item.title;
  panelBody.textContent = item.body;
  panelAction.innerHTML = "";

  if (id === "letters") {
    const openButton = document.createElement("button");
    openButton.className = "gold-button";
    openButton.textContent = "Maktubni ochish ✉";
    openButton.addEventListener("click", showLetter);
    panelAction.appendChild(openButton);
  } else if (id === "secret") {
    const note = document.createElement("div");
    note.className = "secret-note";
    note.textContent = "◇  " + item.note;
    panelAction.appendChild(note);
  } else {
    const note = document.createElement("div");
    note.className = "panel-note";
    note.textContent = item.note;
    panelAction.appendChild(note);
  }

  backdrop.classList.add("show");
  backdrop.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function showLetter() {
  const letter = document.createElement("div");
  letter.className = "letter-content";
  letter.innerHTML = `
    <div class="letter-seal">✦</div>
    <h3>Dear ${recipient.replace(/[<>&"']/g, "")},</h3>
    <p>Bu maktub sizga atab yozilgan. Bu yerga o‘zingizning samimiy so‘zlaringizni, tilaklaringizni va hech qachon unutilmas xabaringizni yozishingiz mumkin.</p>
    <span>WITH LOVE ♡</span>
  `;
  panelAction.replaceChildren(letter);
}

function closePanel() {
  backdrop.classList.remove("show");
  backdrop.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

document.querySelectorAll("[data-open]").forEach(button => {
  button.addEventListener("click", () => openWorld(button.dataset.open));
});
document.getElementById("closePanel").addEventListener("click", closePanel);
backLink.addEventListener("click", closePanel);
backdrop.addEventListener("click", event => {
  if (event.target === backdrop) closePanel();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") closePanel();
});

const menuButton = document.getElementById("menuButton");
const nav = document.getElementById("nav");
menuButton.addEventListener("click", () => nav.classList.toggle("open"));
nav.querySelectorAll("a,button").forEach(item => {
  item.addEventListener("click", () => nav.classList.remove("open"));
});
