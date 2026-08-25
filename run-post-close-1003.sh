#!/bin/bash
# Одноразовый пост-клоуз прогон аукциона 1003 (запускается systemd-таймером после закрытия).
# 1) Финальный дешёвый свип winning_bid по ВСЕМ 5367 лотам (включая непрогнозируемые категории).
# 2) Тяжёлый проход истории ставок (lot_bids) ТОЛЬКО по прогнозируемым категориям (predictableOnly).
set -u
cd /var/www/wolmar-parser || exit 1
TS() { date -u +%Y-%m-%dT%H:%M:%SZ; }

echo "[$(TS)] post-close 1003: старт финального дешёвого свипа" >> /tmp/postclose-1003.log
node update-current-auction-fixed.js 1003 >> /tmp/postclose-1003-sweep.log 2>&1
echo "[$(TS)] post-close 1003: свип завершён (exit=$?), запускаю тяжёлый lot_bids predictableOnly" >> /tmp/postclose-1003.log

curl -s -X POST http://localhost:3001/api/admin/temporal/start-parse \
  -H 'Content-Type: application/json' \
  -d '{"auctionNumber":"1003","updateCategories":false,"updateBids":true,"predictableOnly":true}' \
  >> /tmp/postclose-1003.log 2>&1
echo "" >> /tmp/postclose-1003.log
echo "[$(TS)] post-close 1003: тяжёлый проход поставлен в Temporal" >> /tmp/postclose-1003.log
