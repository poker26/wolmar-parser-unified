// Демонстрация «карточки типа»: тип ЦБ + его проходы (наши auction_lots) с ценами по грейдам.
const { pool } = require("./db");
(async () => {
  // топ-тип по числу наших проходов
  const top = await pool.query(`
    SELECT ct.id, ct.name_full, ct.cbr_cat_num, ct.mint, ct.year, count(*) passes
    FROM coin_type ct JOIN lot_type_link l ON l.type_id = ct.id
    GROUP BY ct.id ORDER BY passes DESC LIMIT 1`);
  const t = top.rows[0];
  console.log(`КАРТОЧКА ТИПА #${t.id}: «${t.name_full}»`);
  console.log(`ЦБ №${t.cbr_cat_num} | ${t.mint} | ${t.year} | проходов у нас: ${t.passes}`);
  // цены по грейдам
  const g = await pool.query(`
    SELECT al.condition grade, count(*) n,
           min(al.winning_bid) lo, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY al.winning_bid)) med, max(al.winning_bid) hi
    FROM lot_type_link l JOIN auction_lots al ON al.id = l.lot_id
    WHERE l.type_id = $1 AND al.winning_bid > 0
    GROUP BY al.condition ORDER BY med DESC NULLS LAST LIMIT 12`, [t.id]);
  console.log("\nгрейд            n     min     медиана   max");
  for (const r of g.rows)
    console.log(`  ${String(r.grade || "—").padEnd(14)} ${String(r.n).padStart(3)}  ${String(r.lo).padStart(7)}  ${String(r.med).padStart(8)}  ${String(r.hi).padStart(7)}`);
  // последние проходы
  const last = await pool.query(`
    SELECT al.auction_number, al.lot_number, al.condition, al.winning_bid, al.auction_end_date::date d
    FROM lot_type_link l JOIN auction_lots al ON al.id = l.lot_id
    WHERE l.type_id = $1 AND al.winning_bid > 0
    ORDER BY al.auction_end_date DESC NULLS LAST LIMIT 5`, [t.id]);
  console.log("\nпоследние проходы:");
  for (const r of last.rows) console.log(`  ауц${r.auction_number} лот${r.lot_number}  ${r.condition}  ${r.winning_bid}₽  ${r.d || ""}`);
  await pool.end();
})().catch(e => { console.error("FATAL", e.message); process.exit(1); });
