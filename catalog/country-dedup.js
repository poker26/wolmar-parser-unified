/** Дедуп вариантов написания coin_type.country (era=foreign). node catalog/country-dedup.js [apply] */
const { pool } = require("./db");
const APPLY = process.argv.includes("apply");

const HOMO = { c: "с", e: "е", o: "о", a: "а", p: "р", x: "х", y: "у", k: "к", m: "м", t: "т", h: "н", b: "в" };
const GEO = new Set(["острова", "остров", "республика", "страна"]);
const key = (s) => {
  let t = String(s || "").toLowerCase().replace(/ё/g, "е");
  t = t.replace(/[a-z]/g, (ch) => HOMO[ch] || ch);  // латиница-гомоглифы → кириллица (строки RU, латиница = OCR-артефакт)
  t = t.replace(/(.)\1+/g, "$1");                    // схлопнуть удвоенные буквы (Сеттлментс→Сетлментс)
  const toks = t.replace(/[^а-я0-9]+/g, " ").split(/\s+/).filter((w) => w && !GEO.has(w));
  return toks.sort().join(" ");                      // сорт токенов — порядок слов не важен
};

(async () => {
  const r = await pool.query(
    "SELECT country, count(*) c FROM coin_type WHERE era='foreign' AND country IS NOT NULL GROUP BY country");
  const groups = new Map();   // key -> [{country, c}]
  for (const row of r.rows) {
    const k = key(row.country);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ country: row.country, c: Number(row.c) });
  }
  const dups = [...groups.values()].filter((g) => g.length > 1);
  console.log(`групп с вариантами: ${dups.length}`);
  let updated = 0;
  for (const g of dups) {
    g.sort((a, b) => b.c - a.c || b.country.length - a.country.length);  // канон = самый частый, затем длиннее
    const canon = g[0].country;
    console.log(`  «${canon}» ← ${g.slice(1).map((x) => `«${x.country}»(${x.c})`).join(", ")}`);
    if (APPLY) {
      for (const v of g.slice(1)) {
        const u = await pool.query("UPDATE coin_type SET country=$1 WHERE era='foreign' AND country=$2", [canon, v.country]);
        updated += u.rowCount;
      }
    }
  }
  console.log(APPLY ? `ПРИМЕНЕНО: обновлено строк ${updated}` : "(показ; для применения: node catalog/country-dedup.js apply)");
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
