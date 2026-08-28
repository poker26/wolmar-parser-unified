/**
 * Территории Российской империи — по коллекционерской традиции их выпуски считаются российскими.
 * Финляндия (1864-1917, великое княжество) и Царство Польское (1815-1917) лежали в каталоге как
 * отдельные иностранные страны, хотя монеты чеканились для империи и собираются вместе с ней.
 * Переносим такие типы в era='imperial', country='RU', сохраняя номинал и добавляя территорию
 * в название — связи лотов при этом остаются, меняется только сам тип.
 *   node catalog/empire-territories.js [--apply]
 */
const { pool } = require("./db");

// Годы, когда территория была частью империи. За их пределами страна снова иностранная.
const TERR = [
  { country: "Finland", y0: 1864, y1: 1917, ru: "Финляндия" },
  { country: "Poland", y0: 1815, y1: 1917, ru: "Царство Польское" },
];

(async () => {
  const apply = process.argv.includes("--apply");
  let moved = 0;
  for (const t of TERR) {
    const rows = (await pool.query(
      `SELECT id, name_full, year FROM coin_type
       WHERE era='foreign' AND country=$1
         AND COALESCE(year_start, year) <= $3 AND COALESCE(year_end, year) >= $2`, [t.country, t.y0, t.y1])).rows;
    console.log(`${t.ru} (${t.country} ${t.y0}-${t.y1}): типов ${rows.length}`);
    for (const r of rows) {
      const name = String(r.name_full || "").includes(t.ru) ? r.name_full : `${r.name_full} · ${t.ru}`;
      if (apply) {
        await pool.query(
          `UPDATE coin_type SET era='imperial', country='RU', name_full=$2, issuer=COALESCE(issuer,$3), updated_at=now()
           WHERE id=$1`, [r.id, name.slice(0, 250), t.ru]);
      }
      moved++;
    }
  }
  console.log(`${apply ? "ПЕРЕНЕСЕНО" : "БУДЕТ ПЕРЕНЕСЕНО"}: ${moved} типов`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
