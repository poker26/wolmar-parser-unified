/**
 * Интеграция numismat.ru → каталог. 9k+ лотов уже лежат в auction_lots(source_site='numismat.ru'),
 * но 0% связаны с coin_type. Прогоняем coin_description через общий coin-matcher (все эры) →
 * lot_type_link. БЕЗ скрейпа/кредитов (данные в БД). Re-runnable, только дополняет связи.
 *   node catalog/integrate-numismat.js --dry     — только статистика причин, БЕЗ записи
 *   node catalog/integrate-numismat.js           — боевой: создаёт lot_type_link
 */
const { pool } = require("./db");
const { parseTitle, matchType } = require("./coin-matcher");

(async () => {
  const dry = process.argv.includes("--dry");
  const lots = (await pool.query(
    `SELECT id, coin_description, year FROM auction_lots
     WHERE source_site='numismat.ru' AND id NOT IN (SELECT lot_id FROM lot_type_link)`
  )).rows;
  console.log(`numismat.ru без связи: ${lots.length}${dry ? " (DRY)" : ""}`);

  const stat = {};
  for (const l of lots) {
    const p = parseTitle(l.coin_description);
    if (p.isNonCoin) { stat.noncoin = (stat.noncoin || 0) + 1; continue; }
    if (p.isSet)     { stat.set     = (stat.set     || 0) + 1; continue; }
    if (!p.denom)    { stat.nodenom = (stat.nodenom || 0) + 1; continue; }
    if (!p.year && l.year) p.year = l.year;                 // год из колонки, если в тексте нет
    if (!p.year)     { stat.noyear  = (stat.noyear  || 0) + 1; continue; }
    const m = await matchType(pool, p);
    if (!m) { stat.nomatch = (stat.nomatch || 0) + 1; continue; }
    if (!dry) {
      await pool.query(
        `INSERT INTO lot_type_link (lot_id,type_id,grade,match_method,match_confidence)
         VALUES ($1,$2,$3,'numismat',$4) ON CONFLICT (lot_id) DO NOTHING`,
        [l.id, m.id, p.grade, m.conf]);
    }
    stat.ok = (stat.ok || 0) + 1;
    stat["era_" + m.era] = (stat["era_" + m.era] || 0) + 1;
  }
  console.log("итог:", JSON.stringify(stat));
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
