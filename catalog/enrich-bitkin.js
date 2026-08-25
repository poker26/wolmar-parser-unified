// Обогащение русских типов референсом из описаний лотов (Биткин#/Уздеников#/тираж).
// Источник — auction_lots.coin_description (уже содержит «Биткин №# 923.160, тираж 648 333, Уздеников №# 3853»).
// Без vision/PDF: регулярка + мода по типу. Идемпотентно (re-run стабилен).
const { pool } = require('./db');

const reBit = /(?:Биткин|Bitkin|Бит\.)\s*№?\s*#?\s*(\d+(?:\.\d+)?)/i;
const reUzd = /(?:Уздеников|Uzdenikov)\s*№?\s*#?\s*(\d+)/i;
const reMint = /тираж[а-яё]*\s*[:\-]?\s*(\d[\d\s]{1,}\d)/i;

const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const mode = (m) => { let best = null, bc = 0; for (const [k, c] of m) if (c > bc) { bc = c; best = k; } return best; };

(async () => {
  await pool.query(`ALTER TABLE coin_type
      ADD COLUMN IF NOT EXISTS bitkin_number TEXT,
      ADD COLUMN IF NOT EXISTS uzdenikov_number TEXT`);

  console.log('тяну (type_id, description) для русских эр…');
  const { rows } = await pool.query(`
    SELECT l.type_id tid, al.coin_description d
    FROM lot_type_link l
    JOIN auction_lots al ON al.id = l.lot_id
    JOIN coin_type ct ON ct.id = l.type_id
    WHERE (ct.era IN ('imperial','ussr') OR (ct.era IS NULL AND ct.country = 'RU'))
      AND al.coin_description IS NOT NULL`);
  console.log('строк лот↔тип:', rows.length);

  const agg = new Map(); // tid -> {bit,uzd,mint}
  for (const r of rows) {
    const d = r.d;
    let a = agg.get(r.tid);
    if (!a) { a = { bit: new Map(), uzd: new Map(), mint: new Map() }; agg.set(r.tid, a); }
    const mb = d.match(reBit); if (mb) inc(a.bit, mb[1]);
    const mu = d.match(reUzd); if (mu) inc(a.uzd, mu[1]);
    const mm = d.match(reMint);
    if (mm) { const n = parseInt(mm[1].replace(/\s/g, ''), 10); if (n >= 100 && n < 1e12) inc(a.mint, String(n)); }
  }

  const updates = [];
  for (const [tid, a] of agg) {
    const bit = mode(a.bit), uzd = mode(a.uzd), mint = mode(a.mint);
    if (bit || uzd || mint) updates.push({ tid, bit, uzd, mint: mint ? parseInt(mint, 10) : null });
  }
  console.log('типов с референсом:', updates.length, 'из', agg.size, 'затронутых');

  let n = 0, cb = 0, cu = 0, cm = 0;
  for (const u of updates) {
    await pool.query(
      `UPDATE coin_type SET bitkin_number = COALESCE($2, bitkin_number),
         uzdenikov_number = COALESCE($3, uzdenikov_number),
         mintage = COALESCE($4, mintage)
       WHERE id = $1`,
      [u.tid, u.bit, u.uzd, u.mint]);
    if (u.bit) cb++; if (u.uzd) cu++; if (u.mint) cm++;
    if (++n % 500 === 0) console.log('  обновлено', n, '/', updates.length);
  }
  console.log(`DONE: типов ${updates.length} | с Биткин# ${cb} | Уздеников# ${cu} | тираж ${cm}`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
