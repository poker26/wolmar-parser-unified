/**
 * Шаг 4: обогащение типов СССР из описаний лотов — Федорин# (АФ/Ф) + тираж, мода по типу.
 * Additive (COALESCE): погодовка уже несёт Федорин# из fcoins — не перезатираем; заполняем NULL
 * (в основном памятные) + mintage где пусто. Без vision. node catalog/enrich-ussr.js
 */
const { pool } = require("./db");

const reFedA = /(?<![А-Яа-яЁёA-Za-z])(?:Федорин\s*№?\s*|АФ\s*№?\s*)(\d+[а-яё]?)/i;
const reFedF = /(?<![А-Яа-яЁёA-Za-z])Ф\.?\s*(\d{2,}[а-яё]?)/;
const reMint = /тираж[а-яё]*\s*[:\-]?\s*(\d[\d\s]{1,}\d)/i;
const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const mode = (m) => { let b = null, bc = 0; for (const [k, c] of m) if (c > bc) { bc = c; b = k; } return b; };

(async () => {
  const { rows } = await pool.query(
    `SELECT l.type_id tid, al.coin_description d FROM lot_type_link l
     JOIN auction_lots al ON al.id=l.lot_id JOIN coin_type ct ON ct.id=l.type_id
     WHERE ct.era='ussr' AND al.coin_description IS NOT NULL`);
  console.log("строк лот↔тип СССР:", rows.length);
  const agg = new Map();
  for (const r of rows) {
    const d = r.d; let a = agg.get(r.tid);
    if (!a) { a = { fed: new Map(), mint: new Map() }; agg.set(r.tid, a); }
    const fm = d.match(reFedA) || d.match(reFedF); if (fm) inc(a.fed, "Федорин-" + fm[1]);
    const mm = d.match(reMint); if (mm) { const n = parseInt(mm[1].replace(/\s/g, ""), 10); if (n >= 100 && n < 1e12) inc(a.mint, String(n)); }
  }
  let cf = 0, cm = 0;
  for (const [tid, a] of agg) {
    const fed = mode(a.fed), mint = mode(a.mint);
    if (!fed && !mint) continue;
    await pool.query("UPDATE coin_type SET fedorin_number=COALESCE(fedorin_number,$2), mintage=COALESCE(mintage,$3) WHERE id=$1",
      [tid, fed, mint ? parseInt(mint, 10) : null]);
    if (fed) cf++; if (mint) cm++;
  }
  const c = await pool.query("SELECT count(fedorin_number) f, count(mintage) m, count(*) t FROM coin_type WHERE era='ussr'");
  console.log(`кандидатов: Федорин# ${cf}, тираж ${cm}`);
  console.log(`итого ussr (${c.rows[0].t} типов): с Федорин# ${c.rows[0].f}, с тиражом ${c.rows[0].m}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
