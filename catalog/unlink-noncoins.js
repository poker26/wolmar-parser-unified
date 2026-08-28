/**
 * Снятие связей с лотов, которые монетами не являются.
 *
 * Проверка 431 тысячи связей показала: на карточках монет висят кредитные билеты, кооперативные
 * боны 1920-х и сборные лоты из нескольких монет. Это не косметика — цена бумажного рубля 1866
 * года и серебряного рубля того же года различаются в разы, а медиана типа считается по проходам.
 *
 *   node catalog/unlink-noncoins.js [--apply]
 */
const { pool } = require("./db");
const { parseTitle } = require("./coin-matcher");

(async () => {
  const apply = process.argv.includes("--apply");
  const rows = (await pool.query(
    `SELECT l.id, a.coin_description cd FROM lot_type_link l
       JOIN auction_lots a ON a.id=l.lot_id WHERE a.coin_description IS NOT NULL`)).rows;
  const kill = [];
  let noncoin = 0, sets = 0;
  for (const r of rows) {
    const p = parseTitle(r.cd);
    if (p.isNonCoin) { noncoin++; kill.push(r.id); }
    else if (p.isSet) { sets++; kill.push(r.id); }
  }
  console.log(`связей ${rows.length} · не монета ${noncoin} · набор ${sets} · к снятию ${kill.length}`);
  if (apply) {
    let done = 0;
    for (let i = 0; i < kill.length; i += 1000) {
      const r = await pool.query("DELETE FROM lot_type_link WHERE id = ANY($1::bigint[])", [kill.slice(i, i + 1000)]);
      done += r.rowCount;
    }
    console.log("СНЯТО:", done);
  }
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
