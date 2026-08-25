/**
 * Backfill metal для МОДЕРН-РФ NULL-metal золотых типов, чтобы матчер-гейт (filterMetal) их ловил.
 * Критерий (узкий, безопасный): era IS NULL, country='RU', metal пуст, номинал ≥25 (отсекает биметалл-10₽
 * вроде ЯНАО — золотых модерн <25₽ нет), И (имя ~ Победоносец/червонец/Сеятель ИЛИ аукц.-медиана ≥50000).
 * После апдейта — разлинковка маркетплейс-связей на эти типы без драг-сигнала в описании (как _clean_metal_links).
 *   node catalog/backfill-modern-metal.js            — dry-run
 *   node catalog/backfill-modern-metal.js --apply
 */
const { pool } = require("./db");
const { parseTitle } = require("./coin-matcher");
const PRECIOUS_METAL = /золот|сереб|платин|паллад/i;

(async () => {
  const apply = process.argv.includes("--apply");
  const cand = (await pool.query(`
    WITH m AS (
      SELECT ct.id, ct.name_full, ct.denomination_value dv, ct.year,
        (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY al.winning_bid))::int
           FROM lot_type_link l JOIN auction_lots al ON al.id=l.lot_id
           WHERE l.type_id=ct.id AND al.winning_bid>0 AND al.lot_status IS DISTINCT FROM 'active'
             AND al.source_site IN ('wolmar.ru','numismat.ru')) med
      FROM coin_type ct
      WHERE ct.era IS NULL AND ct.country='RU' AND (ct.metal IS NULL OR ct.metal=''))
    SELECT * FROM m
    WHERE (name_full ~* 'Победоносец' AND dv >= 25)
       OR name_full ~* 'червонец|Сеятель'
       OR (dv >= 25 AND med >= 50000)
    ORDER BY med DESC NULLS LAST`)).rows;

  console.log(`кандидатов в золото (модерн-РФ NULL-metal): ${cand.length}`);
  for (const r of cand) console.log(`  #${r.id} ${r.dv}р ${r.year} med=${r.med} | ${(r.name_full || "").slice(0, 48)}`);

  if (!apply) { console.log("\n(dry-run; --apply чтобы записать metal + разлинковать)"); await pool.end(); return; }

  const ids = cand.map((r) => r.id);
  const up = await pool.query(`UPDATE coin_type SET metal='золото 999/1000' WHERE id = ANY($1::int[])`, [ids]);
  console.log(`\nmetal проставлен: ${up.rowCount} типов`);

  // разлинковка маркетплейс-связей на эти типы, где в описании нет драг-сигнала (дешёвый тёзка)
  const links = (await pool.query(`
    SELECT l.lot_id, al.coin_description cd FROM lot_type_link l JOIN auction_lots al ON al.id=l.lot_id
    WHERE l.type_id = ANY($1::int[]) AND al.source_site IN ('auction.ru','meshok.net')`, [ids])).rows;
  const bad = links.filter((r) => !parseTitle(r.cd || "").precious).map((r) => r.lot_id);
  if (bad.length) {
    const del = await pool.query(`DELETE FROM lot_type_link WHERE lot_id = ANY($1::int[])`, [bad]);
    console.log(`разлинковано битых маркетплейс-связей: ${del.rowCount}`);
  } else console.log("битых маркетплейс-связей нет");
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
