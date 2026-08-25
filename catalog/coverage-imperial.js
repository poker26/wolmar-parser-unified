// Покрытие имперского каталога по годам: типы + проходы. Запуск: node catalog/coverage-imperial.js
const { pool } = require("./db");
(async () => {
  const r = await pool.query(`
    SELECT ct.year, count(DISTINCT ct.id) types, count(l.id)::int passes
    FROM coin_type ct LEFT JOIN lot_type_link l ON l.type_id=ct.id
    WHERE ct.era='imperial' AND ct.year IS NOT NULL
    GROUP BY ct.year ORDER BY ct.year`);
  const byYear = new Map(r.rows.map(x => [x.year, x]));
  const yrs = r.rows.map(x => x.year);
  const mn = Math.min(...yrs), mx = Math.max(...yrs);
  console.log(`диапазон: ${mn}–${mx}; лет с данными: ${r.rows.length}`);
  // по десятилетиям
  console.log("\nдекада | лет с данными | типов | проходов");
  const dec = new Map();
  for (const x of r.rows) { const d = Math.floor(x.year/10)*10; const o = dec.get(d)||{y:0,t:0,p:0}; o.y++; o.t+=+x.types; o.p+=x.passes; dec.set(d,o); }
  for (const [d,o] of [...dec.entries()].sort((a,b)=>a[0]-b[0])) console.log(`  ${d}s | ${o.y}/10 | ${o.t} | ${o.p}`);
  // пропущенные годы внутри диапазона
  const missing = [];
  for (let y=mn; y<=mx; y++) if (!byYear.has(y)) missing.push(y);
  console.log(`\nпропущенных лет внутри ${mn}–${mx}: ${missing.length}`);
  if (missing.length) console.log("  " + missing.join(", "));
  // тонкие годы (1 тип)
  const thin = r.rows.filter(x => +x.types <= 1).map(x => x.year);
  console.log(`\nлет с <=1 типом: ${thin.length}` + (thin.length?": "+thin.join(", "):""));
  await pool.end();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
