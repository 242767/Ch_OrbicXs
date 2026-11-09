# OrbicXs: yopiq, ikki kishilik chat

Bu to'plam eski ochiq chatning o'rniga ishlaydi: faqat siz tanlagan **ikki akkaunt** kiradi,
xabarlar va rasmlar boshqalarga ko'rinmaydi, yangi xabar kelganda telefonga bildirishnoma boradi.

## Nima qayerda

| Papka / fayl | Nima uchun | Qayerga qo'yiladi |
|---|---|---|
| `orbicxs-sayt/` | Sayt: `index.html`, `sw.js`, `manifest.json`, ikonkalar | **Hostingga** (Vercel va hokazo), hammasi bitta papkada |
| `orbicxs-supabase/` | `1-sozlash.sql`, `2-azolar.sql`, `3-...IXTIYORIY.sql`, `functions/send-push/index.ts` | **Faqat Supabase** ga, hostingga yuklamang |
| `MAXFIY-kalitlar.txt` | Push uchun maxfiy kalitlar | Hech qayerga yuklamang |

## Sozlash tartibi (taxminan 15 daqiqa)

### 1. Supabase → Authentication

1. **Sign In / Providers**: *Email* yoqilgan bo'lsin, **"Allow new users to sign up" ni o'chiring**.
   Shunda begona odam akkaunt yarata olmaydi.
2. **Email Templates → Magic Link**: xat matniga `{{ .Token }}` ni qo'shing, masalan:
   `Kirish kodi: <b>{{ .Token }}</b>`. Ilova emailga kelgan **kod** bilan kiritadi.
   Bu kerak, chunki iPhone'da Bosh ekrandagi ilova pochtadagi havolani ochmaydi, kod esa har joyda ishlaydi.
3. **Users → Add user → Create new user**: ikkala emailni qo'shing, **Auto Confirm User** ni yoqing.
4. **URL Configuration**: *Site URL* ga sayt manzilini (`https://...`) yozing va *Redirect URLs* ga ham shuni qo'shing.
5. Eslatma: Supabase'ning o'rnatilgan pochtasi soatiga juda kam xat yuboradi. Kod kelmasa, "Spam" papkasini
   tekshiring va ketma-ket ko'p urinmang. Doimiy ishlashi uchun *Authentication → Emails → SMTP* da o'zingizning
   pochta xizmatingizni (Resend, Brevo...) ulang.

### 2. Supabase → SQL Editor

1. `orbicxs-supabase/1-sozlash.sql` ni to'liq nusxalab ishga tushiring (Run). Hech narsani o'zgartirish shart emas.
2. `2-azolar.sql` ni oching, ichidagi ikki emailni **o'zingizniki bilan** almashtiring (kichik harflarda), ishga tushiring.
   Pastda ikki qator (ikki email) chiqishi kerak.

### 3. Supabase → Edge Functions (bildirishnomalar uchun)

1. **Deploy a new function → Via Editor**, nomi aynan `send-push`. `functions/send-push/index.ts` mazmunini yopishtirib, Deploy qiling.
2. Funksiya sozlamasida **Verify JWT** ni o'chiring (funksiya o'zining maxfiy so'zi bilan himoyalangan).
3. **Edge Functions → Secrets** ga `MAXFIY-kalitlar.txt` dagi to'rtta qiymatni qo'shing
   (`VAPID_SUBJECT` ga o'zingizning emailingizni yozing: `mailto:...`).

### 4. Saytni joylash

`orbicxs-sayt/` ichidagi fayllarni hostingga yuklang (HTTPS bo'lishi shart). Eski `index.html`, `sw.js`, `manifest.json`
o'rniga yangilarini qo'ying, eski `vapid_public_key.txt` ni **o'chiring**: unda VAPID kaliti emas, boshqa kalit yozilgan edi.

### 5. Tekshirish

1. Saytni oching: email → emailga kelgan kod → ismingiz → chat.
2. Ikkinchi odam ham shunday kiradi.
3. **Bildirishnoma**: chat tepasidagi qo'ng'iroqcha tugmasini bosib, ruxsat bering.
   - **iPhone**: avval Safari'da *Ulashish → Bosh ekranga qo'shish*, so'ng ilovani o'sha belgidan oching, keyin qo'ng'iroqcha.
   - **Android/kompyuter**: qo'ng'iroqchani bosib ruxsat berish kifoya.
4. Sinov: bittangiz ilovani yopib qo'ysin, ikkinchisi xabar yozsin: bildirishnoma kelishi kerak.

### 6. (Ixtiyoriy) Eski ochiq chatni tozalash

Eski xabarlar kerak bo'lmasa, `3-eski-chatni-tozalash-IXTIYORIY.sql` ni o'qib, ishga tushiring va
*Storage* dan eski `chat-images` va `avatars` omborlarini o'chiring (ular ochiq edi).

## Nosozliklar

| Belgi | Sabab va yechim |
|---|---|
| "Bu akkaunt chatga qo'shilmagan" | `2-azolar.sql` dagi email *Authentication → Users* dagi bilan bir xil emas. |
| "Bu email chatga qo'shilmagan" (kod so'rashda) | Bunday foydalanuvchi *Users* da yo'q. Avval 1.3-qadamdagi akkauntni yarating. |
| Kod kelmayapti | Spam; yoki pochta limiti (1.5). Magic Link shabloniga `{{ .Token }}` qo'shilganini tekshiring. |
| Bildirishnoma kelmayapti | SQL Editor'da `select id, status_code, content::text, created from net._http_response order by created desc limit 5;` ni ishga tushiring. `200` normal; `401` bo'lsa `WEBHOOK_SECRET` mos emas; `404` bo'lsa funksiya nomi `send-push` emas; yo'q bo'lsa qo'ng'iroqcha bosilmagan. Funksiya jurnali: *Edge Functions → send-push → Logs*. |
| iPhone'da qo'ng'iroqcha ruxsat so'ramayapti | Ilova Bosh ekrandan ochilmagan (Safari oynasida iPhone push bermaydi). iOS 16.4 yoki yangiroq kerak. |

## Xavfsizlik

- `index.html` dagi `anon` kalit ochiq bo'lishi uchun mo'ljallangan; chatni **ruxsat qoidalari (RLS)** himoyalaydi:
  faqat `ox_members` dagi ikki akkaunt xabarlarni o'qiy va yoza oladi, yuboruvchini soxtalashtirib bo'lmaydi.
- Rasmlar yopiq omborda, ularga havola faqat tizimga kirganlarga 1 soatga beriladi.
- `service_role` kaliti bu loyihada **ishlatilmaydi**. Uni hech qachon saytga qo'ymang.
- VAPID kalitini almashtirsangiz, ochiq qismini `index.html` dagi `VAPID_PUBLIC_KEY` ga, maxfiy qismini Supabase sirlariga yozing.
- `WEBHOOK_SECRET` ni almashtirsangiz, `1-sozlash.sql` dagi `x-webhook-secret` qiymatini ham yangilab, SQL ni qayta ishga tushiring.
- Joriy cheklov: ilova oxirgi 150 xabarni ko'rsatadi; xabarni tahrirlash/o'chirish yo'q.
