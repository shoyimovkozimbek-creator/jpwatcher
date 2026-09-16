#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test -f watcher-config.private.json
test -d data || mkdir data
echo '1/3: Docker image tayyorlanmoqda'
docker compose build
echo '2/3: Faqat lokal namunaviy saytlar bilan barcha testlar'
docker compose run --rm agent npm test
echo '3/3: Testlar o‘tdi. Eski watcher o‘chirilganini tekshiring.'
if systemctl is-active --quiet japan-visa-watcher.service 2>/dev/null; then
  echo 'Eski japan-visa-watcher.service hali ishlayapti. Uni to‘xtating va ushbu skriptni qayta ishga tushiring.'
  exit 1
fi
docker compose up -d
docker compose ps
