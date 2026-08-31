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
  const byCountry = new Map(), byDecade = new Map(), pairs = new Map();
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
    if (dec && c !== "(страна не названа)") {
      const k = c + "|" + dec;
      pairs.set(k, (pairs.get(k) || 0) + 1);
    }
  }
  // Пробел бывает двух разных природ, и лечатся они по-разному: РАЗДЕЛА нет вовсе (нужен другой
  // справочник) либо раздел есть, а нужной строки в нём нет (нужен разбор получше или издание
  // подробнее). Считаем по каждой паре страна+десятилетие, есть ли у нас хоть один тип.
  let sectionMissing = 0, rowMissing = 0;
  const secEx = [], rowEx = [];
  for (const [key, v] of pairs) {
    const [c, dec] = key.split("|");
    const have = (await pool.query(
      `SELECT count(*)::int c FROM coin_type WHERE era='foreign' AND country=$1
         AND COALESCE(year_end, year) >= $2 AND COALESCE(year_start, year) <= $3`,
      [c, +dec, +dec + 9])).rows[0].c;
    if (have) { rowMissing += v; if (rowEx.length < 8) rowEx.push(`${c} ${dec}-е: лотов ${v}, типов в каталоге ${have}`); }
    else { sectionMissing += v; if (secEx.length < 8) secEx.push(`${c} ${dec}-е: лотов ${v}`); }
  }
  console.log(`пробелов в выборке ${rows.length}: ${n}`);
  console.log(`
раздела НЕТ вовсе (нужен другой справочник): ${sectionMissing}`);
  secEx.forEach((e) => console.log("   ", e));
  console.log(`
раздел ЕСТЬ, строки нет (разбор или подробнее издание): ${rowMissing}`);
  rowEx.forEach((e) => console.log("   ", e));
  console.log("\nстраны:");
  [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`));
  console.log("\nдесятилетия:");
  [...byDecade.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k || "год не разобран"}`));
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
