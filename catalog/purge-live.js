// Вычистить ЛАЙВ-аукцион(ы) (auction_end_date > now) из проходов каталога. Запуск: node catalog/purge-live.js
const { pool } = require("./db");
(async () => {
  const live = await pool.query(`SELECT DISTINCT auction_number, max(auction_end_date)::date e FROM auction_lots WHERE auction_end_date > now() GROUP BY auction_number ORDER BY auction_number`);
  console.log("ЛАЙВ-аукционы (end>now):", live.rows.map(r => `${r.auction_number}(${r.e})`).join(", ") || "нет");
  const del = await pool.query(`
    DELETE FROM lot_type_link l USING auction_lots al
    WHERE al.id = l.lot_id AND al.auction_end_date > now()`);
  console.log(`удалено проходов лайв-аукциона из lot_type_link: ${del.rowCount}`);
  await pool.end();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
