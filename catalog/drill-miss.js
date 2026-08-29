/**
 * Разбор одной корзины промахов: показать лот и то, из чего матчер выбирал.
 * Без этого «не выбрать из кандидатов» ничего не говорит — неизвестно, воздержание это по делу
 * (в каталоге правда две разные монеты) или дефект признаков.
 *
 *   node catalog/drill-miss.js "имперское: не выбрать" [сколько] [выборка]
 */
const { pool } = require("./db");
const { DIAG, parseTitle, matchType } = require("./coin-matcher");

(async () => {
  const want = process.argv[2] || "имперское: не выбрать";
  const show = +(process.argv[3] || 12);
  const N = +(process.argv[4] || 20000);
  DIAG.on = true;
  const rows = (await pool.query(`
    SELECT a.id, a.coin_description cd FROM auction_lots a
      JOIN lot_kind k ON k.lot_id=a.id AND k.kind='coin'
      LEFT JOIN lot_type_link l ON l.lot_id=a.id
     WHERE l.lot_id IS NULL AND a.coin_description IS NOT NULL
     ORDER BY a.id % 89, a.id LIMIT $1`, [N])).rows;
  let seen = 0;
  for (const r of rows) {
    let m = null;
    try { m = await matchType(pool, parseTitle(r.cd)); } catch (_) {}
    if (m || DIAG.reason !== want) continue;
    const p = parseTitle(r.cd);
    const d = p.denom || {};
    const cands = (await pool.query(
      `SELECT name_full, mint, metal, era, (SELECT count(*)::int FROM lot_type_link l WHERE l.type_id=coin_type.id) links
         FROM coin_type
        WHERE ((era='imperial' AND $1::numeric IS NOT NULL AND ROUND(denomination_value,6)=ROUND($1,6) AND year=$2)
            OR (era='ussr' AND denomination_value=$1 AND year=$2)
            OR (era IS NULL AND country='RU' AND denomination_value=$1 AND year=$2))
        ORDER BY links DESC LIMIT 8`, [d.value ?? null, p.year])).rows;
    console.log(`\n· ${String(r.cd).replace(/\s+/g, " ").slice(0, 88)}`);
    console.log(`  кандидатов ${DIAG.n}:`);
    for (const c of cands) console.log(`    [${c.era || "modern"}] ${String(c.name_full).slice(0, 56)} · двор ${c.mint || "—"} · ${c.metal || "—"} · проходов ${c.links}`);
    if (++seen >= show) break;
  }
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
