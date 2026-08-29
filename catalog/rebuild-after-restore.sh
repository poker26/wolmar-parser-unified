#!/usr/bin/env bash
# Восстановление каталога после потери coin_type.
#
# 29.08.2026 запуск build-skeleton-cbr.js снёс весь coin_type (там TRUNCATE ... CASCADE) и вместе
# с ним все связи лот→тип. Данные вернули из суточной копии на малинке
# (/mnt/data/backups/daily/<ДЕНЬ>/postgres.dump, восстанавливать так):
#
#   ssh malinka
#   psql ... -c "TRUNCATE public.coin_type RESTART IDENTITY CASCADE"
#   pg_restore --data-only --no-owner --no-privileges -t coin_type -t lot_type_link \
#              -h <db> -U <user> -d postgres /mnt/data/backups/daily/<ДЕНЬ>/postgres.dump
#   psql ... -c "SELECT setval(pg_get_serial_sequence('coin_type','id'), (SELECT max(id) FROM coin_type))"
#
# Дальше — этот скрипт: он доводит каталог от состояния копии до текущего. Все шаги идемпотентны,
# поэтому его можно запускать повторно и после обычного (не аварийного) обновления данных.
#
#   setsid nohup bash catalog/rebuild-after-restore.sh > /tmp/rebuild.log 2>&1 &
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

LOG_TS() { date "+%H:%M:%S"; }
STEP=0
FAILED=()

run() {                      # run "название" команда...
  local name="$1"; shift
  STEP=$((STEP + 1))
  echo ""
  echo "───── [$(LOG_TS)] шаг $STEP: $name"
  if "$@"; then
    echo "───── [$(LOG_TS)] шаг $STEP готов"
  else
    echo "───── [$(LOG_TS)] шаг $STEP ОШИБКА (код $?), продолжаю"
    FAILED+=("$name")
  fi
}

# Ждём чужую перепривязку: две сразу будут мешать друг другу и жечь базу впустую. Ищем именно
# процесс node: по одному лишь имени файла pgrep цепляет и чужие оболочки, в чьей командной строке
# это имя упоминается, — на таком фантоме скрипт однажды завис навсегда. Ожидание ограничено.
WAIT_LEFT=80                                    # 80 × 30 с = 40 минут потолок
while pgrep -f "node .*relink-orphans\.js" > /dev/null && [ $WAIT_LEFT -gt 0 ]; do
  echo "[$(LOG_TS)] жду, пока закончится уже идущая перепривязка (осталось ждать $((WAIT_LEFT / 2)) мин)"
  sleep 30; WAIT_LEFT=$((WAIT_LEFT - 1))
done
[ $WAIT_LEFT -eq 0 ] && echo "[$(LOG_TS)] ждать надоело, иду дальше"

echo "=== ВОССТАНОВЛЕНИЕ КАТАЛОГА, старт $(date -Is) ==="

# 1. Типы: то, что создаётся поверх копии.
run "территории империи (Финляндия, Царство Польское)" node catalog/empire-territories.js --apply
run "рублёвое значение словесных номиналов"            node catalog/backfill-named-denoms.js --apply
run "спайн ходячки современной России"                 node catalog/build-modern-spine.js --min 5 --apply
run "спайн СССР (полтинники, ряд 1931, червонец)"      node catalog/build-ussr-spine.js --min 10 --apply
run "металл модерна по номиналу и медиане"             node catalog/backfill-modern-metal.js --apply
run "дубли типов по написанию страны"                  node catalog/dedupe-country-spellings.js --apply

# 2. Обогащение из справочников (питон живёт в контейнере numismatics).
NUMIS=numismatics-numis-worker-1
if docker ps --format '{{.Names}}' | grep -qx "$NUMIS"; then
  run "характеристики СССР из Федорина"   docker exec "$NUMIS" python /app/fedorin_specs.py --apply
  run "имперские типы и цены из Биткина"  docker exec "$NUMIS" python /app/bitkin_to_types.py --apply
  run "фотографии Биткина, часть 1"       docker exec "$NUMIS" python /app/bitkin_photos.py part1 --apply
  run "фотографии Биткина, часть 2"       docker exec "$NUMIS" python /app/bitkin_photos.py part2 --apply
else
  echo "контейнер $NUMIS не найден — питоновские шаги пропущены"
  FAILED+=("обогащение из справочников (нет контейнера)")
fi
run "зеркалирование снимков ЦБ" node catalog/mirror-cbr-photos.js --apply

# 3. Разметка предмета и связи.
run "разметка лотов (монета/набор/античность/прочее)" node catalog/mark-coin-lots.js --all --apply
run "снятие связей с не-монет"                        node catalog/unlink-noncoins.js --apply
run "перепривязка сирот"                              node catalog/relink-orphans.js --apply
run "починка связей с дробным номиналом"              node catalog/repair-fraction-links.js --apply
run "починка связей с чужой денежной единицей"        node catalog/repair-unit-links.js --apply

# 4. Итог.
echo ""
echo "=== ИТОГ $(date -Is) ==="
node -e '
const { pool } = require("./catalog/db");
(async () => {
  const q = async (s) => (await pool.query(s)).rows;
  console.log("типы по эрам:", JSON.stringify(await q(
    "SELECT coalesce(era,\x27модерн-РФ\x27) era, count(*)::int c FROM coin_type GROUP BY 1 ORDER BY 2 DESC")));
  const r = (await q(`SELECT count(*)::int lots,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM lot_type_link l WHERE l.lot_id=c.id))::int linked
      FROM coin_lots c`))[0];
  console.log("монет", r.lots, "· с типом", r.linked, "·", (100 * r.linked / r.lots).toFixed(1) + "%");
  console.log("связей всего:", (await q("SELECT count(*)::int c FROM lot_type_link"))[0].c);
  await pool.end();
})().catch((e) => { console.error("сводка не собралась:", e.message); process.exit(1); });'

if [ ${#FAILED[@]} -eq 0 ]; then
  echo "ВСЁ ПРОШЛО БЕЗ ОШИБОК"
else
  echo "ШАГИ С ОШИБКАМИ (${#FAILED[@]}): ${FAILED[*]}"
fi
echo "=== КОНЕЦ $(date -Is) ==="
