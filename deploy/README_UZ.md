# DigitalOcean — keyingi bosqich

Bu paket hali serverga deploy qilinmagan. Ubuntu/Debian va Docker Compose uchun fayllar tayyor; Docker image bu kompyuterda yig‘ilmadi.

1. Droplet yarating va SSH orqali kiring. Paketni `/opt/jp-booking-agent` ichiga joylashtiring.
2. Mavjud botning `data/` papkasini saqlang. Eski bazasiz yangilash takroriy bronlardan himoya tarixini yo‘qotadi.
3. Shu papkada:

```bash
mkdir -p data
sudo chown -R 1000:1000 data
sudo chown 1000:1000 watcher-config.private.json
chmod 600 watcher-config.private.json
docker compose build
docker compose run --rm agent npm test
```

4. Testlar o‘tgach shu token bilan ishlayotgan eski watcher xizmatini to‘xtating. Keyin:

```bash
docker compose up -d
docker compose logs --tail=50 -f
```

`deploy/start-after-tests.sh` ham build/test/start bosqichlarini bajaradi. Eski `japan-visa-watcher.service` faol bo‘lsa to‘xtaydi; uni avtomatik o‘chirmaydi.

## Admin panelga kirish

Docker paneli serverning faqat 127.0.0.1:4173 portiga chiqarilgan. O‘z kompyuteringizda SSH tunnel oching (`SERVER_IP` o‘rniga Droplet IP’si):

```bash
ssh -L 4173:127.0.0.1:4173 root@SERVER_IP
```

So‘ng brauzerda http://127.0.0.1:4173 manzilini oching. 4173 portni internetga ochish shart emas. SSH oynasi tunnel ishlashi uchun ochiq qoladi.

## Ish tartibi

17:55 tayyorlanish; 18:00–20:00 Toshkent vaqti bilan Short stay qidirish. Default barcha nomzodlar parallel. /status, /add, /parallel all va panel orqali boshqariladi. Ko‘p sessiya server RAM/CPU resursini talab qiladi; 20 nomzod lokal brauzer sinovidan o‘tkazilgan, Droplet’da ham o‘lchash kerak.

Yangilashda `docker compose down`, kodni almashtirish, `data/` va private konfiguratsiyani saqlash, build/test, keyin `docker compose up -d`. Docker va systemd variantini bir vaqtning o‘zida ishlatmang. Brauzer sandboxi yoqilgan; Linux seccomp profili paketda bor.
