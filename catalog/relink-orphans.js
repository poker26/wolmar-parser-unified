/**
 * Релинк сирот новым матчером (после foreign-denom фикса + ужесточения NONCOIN).
 * Привязывает auction_lots БЕЗ lot_type_link к СУЩЕСТВУЮЩИМ типам. Только ADD (идемпотентно), без создания типов.
 * node catalog/relink-orphans.js [--apply]   (без --apply = только счёт)
 */
const { pool } = require("./db");
const { parseTitle, matchType } = require("./coin-matcher");

(async () => {
  const apply = process.argv.includes("--apply");
  const rows = (await pool.query(`
    SELECT a.id, a.coin_description cd FROM auction_lots a LEFT JOIN lot_type_link l ON l.lot_id=a.id
    WHERE l.lot_id IS NULL AND a.source_site IN ('numismat.ru','auction.ru','meshok.net','wolmar.ru')
      AND a.coin_description IS NOT NULL`)).rows;
  // wolmar раньше был исключён — считалось, что его лоты привязывает сборка каталога. На деле у него
  // 193 тысячи лотов без типа, и матчер узнаёт примерно каждый пятый: это самый большой запас связей.
  console.log("сирот к проверке:", rows.length, apply ? "(APPLY)" : "(dry)");
  const era = {}; let linked = 0, done = 0;
  for (const r of rows) {
    done++;
    let m = null;
    try { m = await matchType(pool, parseTitle(r.cd)); } catch (_) {}
    if (m) {
      era[m.era] = (era[m.era] || 0) + 1; linked++;
      if (apply) await pool.query("INSERT INTO lot_type_link (lot_id,type_id,match_method,match_confidence) VALUES ($1,$2,'relink-v2',$3) ON CONFLICT (lot_id) DO NOTHING", [r.id, m.id, m.conf]).catch(() => {});
    }
    if (done % 20000 === 0) console.log(`  ${done}/${rows.length} проверено, привязано ${linked}`);
  }
  console.log(`\nИТОГ: проверено ${done}, привязано ${linked} | по эрам: ${JSON.stringify(era)}`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
