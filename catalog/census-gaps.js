/**
 * Из чего состоит корзина «нет типа в каталоге»: страна и десятилетие.
 * Пробел в справочнике лечится пополнением каталога, и лечить его имеет смысл там, где лотов много.
 *
 *   node catalog/census-gaps.js [выборка]
 */
const { pool } = require("./db");
const { DIAG, parseTitle, matchType, countryList } = require("./coin-matcher");

(async () => {
  const N = +(process.argv[2] || 10000);
  DIAG.on = true;
  const rows = (await pool.query(`
    SELECT a.coin_description cd FROM auction_lots a
      JOIN lot_kind k ON k.lot_id=a.id AND k.kind='coin'
      LEFT JOIN lot_type_link l ON l.lot_id=a.id
     WHERE l.lot_id IS NULL AND a.coin_description IS NOT NULL
     ORDER BY a.id % 71, a.id LIMIT $1`, [N])).rows;
  const byCountry = new Map(), byDecade = new Map();
  let n = 0;
  for (const r of rows) {
    let m = null;
    try { m = await matchType(pool, parseTitle(r.cd)); } catch (_) {}
    if (m || !/нет типа/.test(DIAG.reason || "")) continue;
    n++;
    const p = parseTitle(r.cd);
    const c = (await countryList(pool, p.title, p.year))[0] || "(страна не названа)";
    byCountry.set(c, (byCountry.get(c) || 0) + 1);
    const dec = p.year ? Math.floor(p.year / 10) * 10 : 0;
    byDecade.set(dec, (byDecade.get(dec) || 0) + 1);
  }
  console.log(`пробелов в выборке ${rows.length}: ${n}`);
  console.log("\nстраны:");
  [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`));
  console.log("\nдесятилетия:");
  [...byDecade.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k || "год не разобран"}`));
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
