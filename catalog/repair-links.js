/**
 * Пересмотр ВСЕХ существующих связей лот→тип текущим матчером.
 *
 * Связи копились месяцами разными версиями правил, и часть из них матчер сегодня уже не
 * подтверждает: неверный номинал, чужая единица, разные монеты одной серии в одной ценовой
 * корзине. Для цены это не косметика — медиана типа считается по привязанным лотам.
 *
 * Решение принимает ровно матчер, никаких дополнительных правил здесь нет:
 *   тот же тип   → оставить;
 *   другой тип   → переставить;
 *   воздержание  → снять связь (лучше пусто, чем неверно).
 *
 * Работает только по монетам (lot_kind='coin'); бумагу и наборы снимает unlink-noncoins.js.
 *
 *   node catalog/repair-links.js [--apply] [--limit N]
 */
const { pool } = require("./db");
const { parseTitle, matchType } = require("./coin-matcher");

const BATCH = 500;

(async () => {
  const apply = process.argv.includes("--apply");
  const li = process.argv.indexOf("--limit");
  const limit = li > -1 ? parseInt(process.argv[li + 1], 10) : 0;
  // Пересмотр ОДНОГО типа: смешанная ценовая корзина чинится точечно, не трогая остальной каталог.
  const ti = process.argv.indexOf("--type");
  const onlyType = ti > -1 ? parseInt(process.argv[ti + 1], 10) : null;

  const rows = (await pool.query(
    `SELECT l.id link_id, l.type_id, a.coin_description cd
       FROM lot_type_link l
       JOIN auction_lots a ON a.id = l.lot_id
       JOIN lot_kind k ON k.lot_id = l.lot_id AND k.kind = 'coin'
      WHERE a.coin_description IS NOT NULL ${onlyType ? "AND l.type_id = " + onlyType : ""}
      ORDER BY l.id ${limit ? "LIMIT " + limit : ""}`)).rows;
  console.log(`связей к пересмотру: ${rows.length}${apply ? " (APPLY)" : " (сухой прогон)"}`);

  let same = 0, moved = 0, dropped = 0, done = 0;
  const moveBuf = [], dropBuf = [];
  const exMoved = [], exDropped = [];

  const flush = async () => {
    if (!apply) { moveBuf.length = 0; dropBuf.length = 0; return; }
    for (const [linkId, typeId, conf] of moveBuf) {
      await pool.query(
        "UPDATE lot_type_link SET type_id=$2, match_method='repair-v3', match_confidence=$3 WHERE id=$1",
        [linkId, typeId, conf]);
    }
    if (dropBuf.length) await pool.query("DELETE FROM lot_type_link WHERE id = ANY($1::bigint[])", [dropBuf]);
    moveBuf.length = 0; dropBuf.length = 0;
  };

  for (const r of rows) {
    let m = null;
    try { m = await matchType(pool, parseTitle(r.cd)); } catch (_) {}
    if (m && m.id === r.type_id) same++;
    else if (m) {
      moved++; moveBuf.push([r.link_id, m.id, m.conf]);
      if (exMoved.length < 6) exMoved.push(`${r.type_id} → ${m.id} ← ${r.cd.replace(/\s+/g, " ").slice(0, 56)}`);
    } else {
      dropped++; dropBuf.push(r.link_id);
      if (exDropped.length < 6) exDropped.push(`${r.type_id} ← ${r.cd.replace(/\s+/g, " ").slice(0, 62)}`);
    }
    if (moveBuf.length + dropBuf.length >= BATCH) await flush();
    if (++done % 25000 === 0) console.log(`  ${done}/${rows.length}: подтверждено ${same}, переставлено ${moved}, снято ${dropped}`);
  }
  await flush();

  console.log("\nпримеры переставленных:");
  for (const e of exMoved) console.log("  ", e);
  console.log("примеры снятых:");
  for (const e of exDropped) console.log("  ", e);
  console.log(`\nИТОГ: подтверждено ${same} · переставлено ${moved} · снято ${dropped}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
