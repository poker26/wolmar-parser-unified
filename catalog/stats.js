// Сводка по каталогу. Запуск: node catalog/stats.js
const { pool } = require("./db");
(async () => {
  const t = await pool.query(`SELECT COALESCE(era,'modern/cbr') era, source, count(*) types FROM coin_type GROUP BY 1,2 ORDER BY 1,2`);
  console.log("=== coin_type по эрам/источникам ===");
  for (const r of t.rows) console.log(`  ${r.era.padEnd(14)} ${String(r.source).padEnd(16)} ${r.types}`);
  const l = await pool.query(`SELECT COALESCE(ct.era,'modern/cbr') era, count(*) passes FROM lot_type_link l JOIN coin_type ct ON ct.id=l.type_id GROUP BY 1 ORDER BY 2 DESC`);
  console.log("=== проходов (lot_type_link) по эрам ===");
  for (const r of l.rows) console.log(`  ${r.era.padEnd(14)} ${r.passes}`);
  await pool.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
