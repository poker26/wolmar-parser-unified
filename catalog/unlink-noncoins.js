/**
 * Снятие связей с лотов, которые монетами не являются.
 *
 * Опирается на разметку lot_kind (catalog/mark-coin-lots.js): снимаем всё, что не 'coin'. Это не
 * косметика — цена бумажного рубля 1866 года и серебряного рубля того же года различаются в разы,
 * а медиана типа считается по привязанным лотам. Античность снимаем по той же причине: типов для
 * неё в каталоге нет, значит любая такая связь — промах.
 *
 *   node catalog/unlink-noncoins.js [--apply]
 */
const { pool } = require("./db");

(async () => {
  const apply = process.argv.includes("--apply");
  const before = (await pool.query(
    `SELECT k.kind, count(*)::int c FROM lot_type_link l JOIN lot_kind k ON k.lot_id = l.lot_id
      WHERE k.kind <> 'coin' GROUP BY 1 ORDER BY 2 DESC`)).rows;
  const total = before.reduce((a, b) => a + b.c, 0);
  console.log(`связей на не-монеты: ${total}${total ? " (" + before.map((r) => r.kind + ":" + r.c).join(", ") + ")" : ""}`);
  const unmarked = (await pool.query(
    `SELECT count(*)::int c FROM lot_type_link l
      WHERE NOT EXISTS (SELECT 1 FROM lot_kind k WHERE k.lot_id = l.lot_id)`)).rows[0].c;
  if (unmarked) console.log(`⚠ лотов без разметки: ${unmarked} — сначала node catalog/mark-coin-lots.js --apply`);
  if (apply && total) {
    const r = await pool.query(
      `DELETE FROM lot_type_link l USING lot_kind k WHERE k.lot_id = l.lot_id AND k.kind <> 'coin'`);
    console.log("СНЯТО:", r.rowCount);
  }
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
