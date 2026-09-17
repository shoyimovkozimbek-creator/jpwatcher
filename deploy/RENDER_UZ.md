# Render backend + Vercel frontend: o‘rnatish qo‘llanmasi

Frontend — Vercel’dagi boshqaruv paneli. Backend — Render’da doim ishlaydigan Node.js bot, Chromium sessiyalari va SQLite bazasi. Telegram tokeni faqat backendga beriladi. Vercel’ga token qo‘shmang.

## 1. Tayyorlang

- GitHub repository: https://github.com/shoyimovkozimbek-creator/jpwatcher
- Eski paketdagi `watcher-config.private.json` ichidan `telegram_bot_token` va `owner_chat_id` qiymatlarini oling. Ularni GitHub’ga yuklamang.
- Admin panel uchun alohida tasodifiy maxfiy kalit yarating. Bu Telegram tokenidan boshqa bo‘lsin. Kompyuterda PowerShell ochib:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Chiqqan 64 belgili qiymat — quyidagi ADMIN_API_KEY. Uni parol menejerida saqlang.

## 2. Render’da xizmat oching

1. https://dashboard.render.com ga kiring.
2. **New → Web Service** tanlang. Static Site yoki Cron Job tanlamang.
3. GitHub’ni ulang, `shoyimovkozimbek-creator/jpwatcher` repository’sini tanlang.
4. Name: masalan `jpwatcher-backend`.
5. Branch: `main`. Root Directory: bo‘sh.
6. Runtime/Language: **Docker**. Dockerfile Path: `./Dockerfile`.
7. Docker Command/Start Command override: bo‘sh. Dockerfile’dagi `node service.cjs` ishlatiladi.
8. Region: kerakli hududni tanlang. Keyin disk va xizmat shu hududda bo‘lsin.
9. **Paid instance** tanlang. Ushbu agent uchun persistent disk kerak; free xizmat bu talabni bajarmaydi. Ko‘p Chromium sessiyasi RAM talab qiladi: 20 nomzod uchun kamida 4 GB RAM bilan boshlash va /test orqali real server resursini o‘lchash tavsiya qilinadi; bu sig‘im kafolati emas.

Render web xizmatlari `0.0.0.0` host va PORT portida tinglashi kerak. Kod bunga moslangan. [Render Web Services](https://render.com/docs/web-services)

## 3. Environment Variables

Quyidagilarni Render xizmatidagi **Environment** bo‘limiga kiriting:

| Key | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | O‘z botingizning haqiqiy tokeni |
| `OWNER_CHAT_ID` | O‘z Telegram user ID’ingiz — raqam |
| `ADMIN_API_KEY` | 1-bosqichda yaratilgan 64 belgili kalit |
| `FRONTEND_ORIGIN` | Vercel production manzili, masalan `https://jpwatcher-xxx.vercel.app` — oxirida `/` bo‘lmasin |
| `AGENT_PANEL` | `true` |
| `AGENT_PANEL_HOST` | `0.0.0.0` |
| `AGENT_HEADLESS` | `true` |
| `AGENT_SCREENSHOTS` | `false` |
| `AGENT_DATA_DIR` | `/app/data` |
| `TZ` | `Asia/Tashkent` |

`PORT` va `RENDER_EXTERNAL_HOSTNAME`ni qo‘lda qo‘shish shart emas: Render ularni beradi, kod o‘qiydi. `BROWSER_CHANNEL=chrome` qo‘shmang: Docker image Chromium’ni o‘zi o‘rnatadi. Vercel uchun hech qanday secret environment variable talab qilinmaydi.

Bot tokeni va ADMIN_API_KEY faqat Render environment’da qoladi. ADMIN_API_KEY keyin brauzerdagi panelga kirish uchun ham kerak bo‘ladi. [Render environment variables](https://render.com/docs/environment-variables)

## 4. Persistent Disk — majburiy

Advanced / Disks bo‘limida disk qo‘shing:

- Name: `jpwatcher-data`.
- Mount Path: **`/app/data`** — aynan shu yo‘l.
- Size: kamida 1 GB; SQLite bazasi va tarix shu yerda saqlanadi.

Faqat shu disk ostidagi fayllar restart va deploy’dan keyin saqlanadi. SQLite bazani diskdan tashqarida qoldirish nomzodlar va oldingi bron tarixini yo‘qotishi mumkin. Persistent disk paid xizmatga ulanadi. [Render Persistent Disks](https://render.com/docs/disks)

## 5. Deploy

1. Health Check Path: **`/healthz`**.
2. Instance soni: **1**. Bir tokenni ikkita polling xizmatida ishlatmang.
3. Ofisdagi/kompyuterdagi eski botni to‘xtating.
4. **Create Web Service / Deploy** tugmasini bosing.
5. Build’da Node paketlari, Chromium va Linux kutubxonalari o‘rnatiladi. Birinchi build keyingilaridan uzoqroq bo‘lishi mumkin.
6. Log’da `Telegram agent: @...` va `Admin API port: ...` chiqishini kuting.
7. Render bergan `https://...onrender.com/healthz` manzilini oching: `{"ok":true}` bo‘lishi kerak.

Dockerfile repoda bor; qo‘lda `npm start` yoki Playwright install buyruqlarini Render start maydoniga yozish shart emas. [Docker on Render](https://render.com/docs/docker)

## 6. Vercel panelini ulang

1. Vercel’dagi frontend manzilini oching.
2. **Backendga ulanish** bo‘limida Render URL’ni yozing: `https://...onrender.com`.
3. **Admin kaliti** maydoniga Render’dagi ADMIN_API_KEY bilan bir xil qiymatni kiriting.
4. **Ulanish**ni bosing. Telegram tokenini bu yerga kiritmang.
5. Admin kaliti faqat brauzer sessiyasida saqlanadi. **Chiqish** uni o‘chiradi.

Frontend sahifasi ochiq bo‘lishi mumkin, ammo nomzodlar, skrinshotlar va boshqaruv API’lari admin kalitisiz ochilmaydi. Backend manzili o‘zgarsa shu formadan yangilaysiz; frontendni qayta build qilish kerak emas.

## 7. Ishga tushirishdan oldingi tekshiruv

1. Botga `/status` yuboring — jadval va parallel rejim ko‘rinsin.
2. `/schedule off` — sozlash paytida avtomatik ishni vaqtincha o‘chiring.
3. Haqiqiy nomzodlarni `/add` yoki paneldan kiriting. Oldin bron olingan odamni qayta navbatga qo‘ymang.
4. `/parallel all` — barcha navbatdagi nomzodlar alohida sessiyalarda ishlaydi.
5. `/test` — ochiq joy bo‘lsa forma va tasdiqlash sahifasigacha boradi, Reserve bosilmaydi. Telegram skrinshotlari kelishini tekshiring. Joy yopiq bo‘lsa yakuniy forma testi bajarilmaydi.
6. `/stop` — sinovni to‘xtating.
7. Testdan `review` holatiga o‘tgan nomzodlar uchun, bron olinmaganini bilgan holda `/no_booking KOD` bilan qayta navbatga qo‘ying.
8. `/schedule on`. Default: 18:55 tayyorlanish, 19:00–20:00 qidirish; Toshkent vaqti.

`/stop` bugungi avtomatik ishni ham to‘xtatadi. Shu kunning o‘zida qayta ishga tushirish kerak bo‘lsa `/run`; u 30 daqiqalik qo‘lda qidiruvni boshlaydi. Ertangi jadval saqlanadi.

## 8. Xatolar

| Holat | Tekshiring |
|---|---|
| Panel 401 qaytaradi | ADMIN_API_KEY ikki joyda bir xilmi? |
| Panel “Failed to fetch” deydi | Backend Live’mi; URL https’mi; FRONTEND_ORIGIN Vercel manziliga aynan tengmi? |
| Telegram 409 | Shu token bilan eski bot boshqa joyda hali ishlayapti |
| Bot ishga tushmaydi | Token, OWNER_CHAT_ID, ADMIN_API_KEY uzunligi va Render loglari |
| Restartdan keyin nomzodlar yo‘q | Disk mount `/app/data` va AGENT_DATA_DIR bir xilmi? |
| Chromium / sandbox / namespace xatosi | Render muhiti brauzer sandboxini qo‘llashini tekshiring. Bu muhitda ishlamasa paketdagi DigitalOcean Docker variantidan foydalaning; sandboxni avtomatik o‘chirish kiritilmagan |
| Xotira yetmayapti / brauzer yopiladi | RAM’ni oshiring yoki `/parallel 3` bilan resursni tekshiring |
| Reserve javobi noaniq | Emailni tekshiring; bot uni avtomatik takror yubormaydi |

## 9. Yangilash va saqlash

- GitHub’dagi yangi commit Render auto-deploy yoqilgan bo‘lsa qayta deploy boshlashi mumkin. Qabul oynasida deploy qilmang; avval /stop bilan ishni yakunlang.
- `data/`ni o‘chirmang. Baza ko‘chirilsa, botni to‘xtatib SQLite fayli va mavjud `-wal`/`-shm` fayllarini, evidence papkasini birga ko‘chiring.
- Serverga boshqa nusxani qo‘shib scale qilmang: bir polling bot + bitta SQLite disk uchun bitta instance.
- Ushbu backend Render’da hali jonli deploy qilib tekshirilmagan. Lokal avtomatik testlar o‘tgan; Render’dagi brauzer ishlashi va haqiqiy Short stay yuklamasi yuqoridagi tekshiruvda tasdiqlanadi.
