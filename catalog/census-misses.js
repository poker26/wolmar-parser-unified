/**
 * Перепись причин, по которым монета осталась без типа.
 *
 * Матчер отказывается по многим разным поводам, и они требуют РАЗНОГО лечения: «страна не
 * распознана» — это словарь, «нет типа в каталоге» — это пробел справочника, «не выбрать из
 * кандидатов» — это признаки различения. Без такой разбивки любая работа над покрытием идёт вслепую.
 *
 *   node catalog/census-misses.js [размер выборки]
 */
const { pool } = require("./db");
const { DIAG, parseTitle, matchType } = require("./coin-matcher");

(async () => {
  const N = +(process.argv[2] || 30000);
  DIAG.on = true;
  const rows = (await pool.query(`
    SELECT a.id, a.coin_description cd FROM auction_lots a
      JOIN lot_kind k ON k.lot_id=a.id AND k.kind='coin'
      LEFT JOIN lot_type_link l ON l.lot_id=a.id
     WHERE l.lot_id IS NULL AND a.coin_description IS NOT NULL
     ORDER BY a.id % 97, a.id LIMIT $1`, [N])).rows;
  console.log("выборка:", rows.length);

  const cnt = new Map();
  const ex = new Map();
  let ok = 0;
  for (const r of rows) {
    let m = null;
    try { m = await matchType(pool, parseTitle(r.cd)); } catch (e) { DIAG.reason = "ошибка: " + e.message.slice(0, 40); }
    if (m) { ok++; continue; }
    const key = DIAG.reason || "прочее";
    cnt.set(key, (cnt.get(key) || 0) + 1);
    if (!ex.has(key)) ex.set(key, []);
    if (ex.get(key).length < 4) ex.get(key).push(String(r.cd).slice(0, 66));
  }
  console.log("привязалось бы сейчас:", ok);
  const sorted = [...cnt.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted) {
    console.log(`\n${String(v).padStart(6)}  ${(v * 100 / rows.length).toFixed(1)}%  ${k}`);
    for (const e of ex.get(k)) console.log("        ", e);
  }
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
