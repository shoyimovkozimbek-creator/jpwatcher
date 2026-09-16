# Yaponiya Short stay agenti — v2.1

Telegram orqali boshqariladigan Short stay navbat agenti. Repository maxfiy token va shaxsiy ma’lumotlarni o‘z ichiga olmaydi.

## Ishga tushirish

Avval `watcher-config.example.json` faylidan `watcher-config.private.json` nusxa yarating va o‘z bot tokeningiz hamda Telegram user ID’ingizni kiriting. Muqobil: TELEGRAM_BOT_TOKEN va OWNER_CHAT_ID muhit o‘zgaruvchilari. Private fayl Git’dan chiqarilgan.

Windows: avval **TEST.cmd**, so‘ng **START.cmd**.
Admin panel: **http://127.0.0.1:4173**.
Shu token bilan ofisdagi eski bot ishlayotgan bo‘lsa, yangi nusxani ishga tushirishdan oldin uni to‘xtating. Bir token uchun bitta polling jarayoni ishlasin.

Boshqa kompyuter uchun Node.js 24+ va Google Chrome kerak:

```powershell
npm ci
npm test
npm run panel
```

Bundled Codex Node va Playwright mavjud bo‘lsa, Windows skripti kutubxonalarni o‘zi topadi. Kutubxona topilmasa testlar o‘tgan deb ko‘rsatilmaydi.

## Kunlik ish

- 17:55 — har bir navbatdagi nomzod uchun alohida brauzer sessiyasi tayyorlanadi.
- 18:00–20:00 — Toshkent vaqti bilan Short stay (Applicant) kuzatiladi.
- Default parallel rejim: **all — barcha navbatdagi nomzodlar**.
- Joy ochilganda barcha tayyor sessiyalar ishga kirishadi. Bir nechta vaqt bo‘lsa nomzodlar ular orasida taqsimlanadi.
- Har nomzodning cookie/session’i alohida. Bitta pasport ikki ishchiga berilmaydi.
- Taqvim taxminan har bir skandan keyin 1 soniya kutib tekshiriladi. Yangi sayt amallari uchun umumiy minimal oraliq 150 ms; 429 bo‘lsa serverning Retry-After talabi ustun.

## F5 taktikasi

Administrator bilan bog‘lanish, 5xx yoki vaqtinchalik tarmoq xatosida agent **o‘sha sahifani reload qiladi**. Avvalgi yuklanish yakuni kutiladi, keyin bitta yangilash bajariladi. Bu taqvim, boshlang‘ich forma, ma’lumotlar va Reserve oldidagi tasdiqlash sahifalariga qo‘llanadi. Pre-Reserve POST qayta yuklanganda sessiya va POST qiymatlari saqlanadi. 45 soniyalik yuklanish timeout’i bor; /stop yoki qidiruv muddati qayta urinishlarni to‘xtatadi.

**Reserve yuborilgandan keyingi noaniq javob qayta yuborilmaydi.** Server bronni yaratib, javob yo‘lda yo‘qolgan bo‘lishi mumkin. Bunday nomzod `uncertain` bo‘ladi; email orqali tekshiriladi. 403, CAPTCHA yoki noma’lum forma avtomatik chetlab o‘tilmaydi, xabar yuboriladi.

## Skrinshotlar va Telegram

Har nomzod uchun PNG fayl olinadi va Telegram’dagi egaga yuboriladi:

1. Barcha ma’lumotlar maydonlarga yozilganda — **hali bron emas**.
2. Sana, vaqt va ma’lumotlar Reserve oldidan tekshirilganda — **hali bron emas**.
3. Yakuniy bron tasdig‘i / kutish ro‘yxati / noaniq natija.

Xatodagi skrinshotlar ham saqlanadi. Paneldagi “Jarayon skrinshotlari” bo‘limi tarixni ko‘rsatadi. Telegram uzilganda xabarlar SQLite outbox’da qoladi va ulanish qaytganda yuboriladi; Telegram uzilishi bron holatini bekor qilmaydi.

## Boshqaruv

| Buyruq | Vazifa |
|---|---|
| /add | Nomzodni bosqichma-bosqich kiritish |
| /list | Nomzodlar va kodlar |
| /edit KOD | Yuborilmagan nomzodni tahrirlash |
| /remove KOD | Navbatdan olish |
| /screens KOD | Oxirgi jarayon skrinshotlarini qayta yuborish |
| /panel | Admin panel manzili |
| /status | Joriy holat va jadval |
| /parallel all | Barcha nomzodlarni parallel ishlatish |
| /parallel 3 | Parallel ishchilar sonini 1–20 bilan cheklash |
| /schedule on yoki off | Kunlik jadvalni yoqish/o‘chirish |
| /end 20:00 | Yakun vaqtini o‘zgartirish |
| /run | Hozir 30 daqiqalik avtomatik bron qidiruvi |
| /test | Hozir tekshirish; Reserve bosilmaydi |
| /stop | Bugungi ishni to‘xtatish |
| /booked KOD | Noaniq natijani emaildan tasdiqlash |
| /no_booking KOD | Bron yo‘qligi tekshirilgach qayta navbatga qo‘yish |
| /waitlisted KOD | Kutish ro‘yxatini belgilash |
| /cancel | Nomzod kiritishni bekor qilish |

Panelda nomzod qo‘shish/tahrirlash/arxivlash, natijani belgilash, jadvalning boshlanish va yakunini o‘zgartirish, parallel rejim, jarayon tarixi, skrinshotlar va Telegram xabarlarini qayta yuborish mavjud. Panel localhost’da ishlaydi; tashqi sayt sifatida ochilmagan.

## Ma’lumotlarni saqlash

`data/` — ish bazasi, tarix va skrinshotlar. Mavjud botni yangilashda **data papkasini saqlang va ko‘chiring**. Uni yo‘qotish avvalgi bronlarning takrorlanishdan himoyasini yo‘qotadi. Ushbu ZIP’ga lokal test nomzodlari kiritilmagan.

`watcher-config.private.json` tokenni saqlaydi; uni GitHub’ga yuklamang. Docker uni image’ga qo‘shmaydi, faqat read-only fayl sifatida ulaydi.

## Tekshiruv va DigitalOcean

Natijalar: **TESTS_UZ.md**, **TEST.cmd** lokal test-results.txt hisobotini yaratadi.
DigitalOcean ko‘rsatmasi: **deploy/README_UZ.md**. Hozir deploy qilinmagan. Real Short stay yuklamasida joy olish kafolatlanmaydi; testlar botning mexanizmlarini tekshiradi, sayt sig‘imi va raqobatini boshqarmaydi.
