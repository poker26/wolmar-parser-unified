/** Детерминированный Title-case для Latin-ALLCAPS стран foreign (CANADA→Canada). node catalog/country-titlecase.js */
const { pool } = require("./db");
const SMALL = new Set(["of", "and", "the", "de", "da", "du", "la", "le", "el", "des", "del", "von", "van"]);
function tc(s) {
  if (/[a-zа-яё]/.test(s)) return s;          // есть строчные (mixed/Cyrillic) → не трогаем
  return s.toLowerCase().split(/(\s+|-)/).map((w, i) => {
    if (/^\s+$/.test(w) || w === "-") return w;
    if (i > 0 && SMALL.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join("");
}
(async () => {
  const r = await pool.query("SELECT DISTINCT country FROM coin_type WHERE era='foreign' AND country IS NOT NULL");
  let upd = 0;
  for (const row of r.rows) {
    const c = tc(row.country);
    if (c !== row.country) {
      const u = await pool.query("UPDATE coin_type SET country=$1 WHERE era='foreign' AND country=$2", [c, row.country]);
      upd += u.rowCount;
    }
  }
  const n = (await pool.query("SELECT count(DISTINCT country) c FROM coin_type WHERE era='foreign'")).rows[0].c;
  console.log(`title-case: обновлено строк ${upd} | стран после ${n}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
