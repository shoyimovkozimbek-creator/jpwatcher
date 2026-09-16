# v2.1 — yakuniy test natijalari, 2026-09-16

**45/45 avtomatik test o‘tdi. Fail: 0. Skipped: 0. Cancelled: 0.**
Konsol natijasini qayta olish: npm test yoki TEST.cmd. Muhit: Windows, Node.js 24.19.0, Playwright 1.62.1, Google Chrome, browser sandbox yoqilgan.

## Tasdiqlangan ishlar

- F5: option, forma, nomzodlar POST sahifasi va Reserve oldidagi POST tasdiqlash sahifasida ketma-ket ikkita 503/administrator xatosidan tiklandi.
- O‘sha sessiya, URL va POST maydonlari saqlandi. Testda bitta sessiyaning so‘rovlari ustma-ust ketmadi.
- Taqvimda ikkita xatodan so‘ng AJAX kun jadvalidagi uchta vaqt o‘qildi.
- 429 Retry-After: yangi so‘rov yuborishdan oldin server so‘ragan muddat kutildi.
- /stop F5 jarayonini bron yubormasdan to‘xtatdi.
- Reserve’dan keyingi 500 javobida nomzod uncertain holatida qoldi; ikkinchi POST va refresh bajarilmadi.
- **20 nomzod / 20 alohida sessiya / 20 alohida pasport / 20 takrorlanmagan yakuniy yuborish.** Uchta ochiq vaqt orasida taqsimlandi. Yakuniy lokal o‘lchov: **15 247 ms**, bir vaqtdagi sayt so‘rovlari maksimumi 4. Har nomzodning brauzer sessiyasi mustaqil ishladi; test serveri har javobga 250 ms kechikish qo‘shdi.
- Har nomzod uchun filled, review va booked bosqichlarida uchta haqiqiy PNG yaratildi. 20 nomzodda jami 60 ta skrinshot qaydi tekshirildi.
- Ikki ishchi bir nomzodni bir vaqtning o‘zida olganda bittagina bron yuborildi.
- Osilib qolgan brauzer resursi uchun vaqt chegarasi tekshirildi.
- Admin panelda haqiqiy brauzer orqali qo‘shish, tahrirlash, navbatdan olish, all rejimi, jadval, PNG ochish va Telegram qayta yuborish boshqaruvlari sinovdan o‘tdi; JavaScript xatosi chiqmadi.
- API’da CSRF/Origin, pasportni yashirish va skrinshot yo‘lini tekshirish sinovlari o‘tdi.
- Avvalgi 29 ta validatsiya, jadval, restart, outbox, Telegram egasi va takroriy bron himoyasi testlari ham o‘tdi.

## Haqiqiy Telegram yetkazilishi

Egasi bilan o‘tkazilgan sinovda Telegram API 4 ta PNG hujjatini qabul qilgan, yuborilmay qolgan xabarlar soni 0 bo‘lgan. Shaxsiy chat, bron, token va skrinshotlar repository’ga kiritilmagan. Oddiy avtomatik testlar haqiqiy Telegram xabari yubormaydi.

## Jonli Short stay sayti

Yangilangan agentning Agent.calendar funksiyasi orqali sentabr va oktabr taqvimlari ochildi. 2026-09-16 21:56 Toshkent vaqtidagi tekshiruvda ikkala oyda ham ochiq slot topilmadi. Skrinshotlar saqlandi. Nomzod va Reserve yuborilmadi.

## Kafolat chegarasi

F5 mexanizmi va parallel ish **lokal integratsiya sinovida tasdiqlandi**. Elchixonaning 18:00–20:00 haqiqiy yuklamasi, joylar sig‘imi, boshqa arizachilar bilan raqobat va serverning keyingi o‘zgarishlari uchun 100% bron kafolati berilmaydi. Short stay haqiqiy bron bilan end-to-end yakun hali tekshirilmagan, chunki jonli tekshiruvda joy yopiq edi. Docker/DigitalOcean build va yuklama keyingi bosqichda serverda tekshiriladi.
