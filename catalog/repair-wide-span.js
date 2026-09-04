/**
 * Пересмотр связей, ведущих на иностранный тип с НЕПРАВДОПОДОБНО ШИРОКИМ диапазоном чеканки.
 *
 * Сборщик типов из Краузе расширял границы годов по всем строкам с одним ключом, и там, где ключ
 * склеил разные монеты, диапазон растянулся на века. Такой тип перестаёт быть монетой и работает
 * воронкой: «DOLLAR. SHAWNEE TRIBAL NATION 1652-2003» собрал 2923 прохода — доллары Моргана
 * 1885 года по 8500 ₽ вместе с Эйзенхауэром 1972-го по 1500 ₽. Медиана по такой корзине не значит
 * ничего, а в покрытии дефект невидим: связь есть и выглядит подтверждённой.
 *
 * Правило в матчере (WIDE_SPAN): узкий тип вытесняет широкий, а если все кандидаты широкие —
 * воздерживаемся. Здесь разбираются связи, накопленные до этого правила. Решает ровно матчер:
 *   тот же тип   → оставить (после правки такого быть не должно);
 *   другой тип   → переставить;
 *   воздержание  → снять связь.
 *
 * Цена решения известна заранее и принята: часть лотов останется без типа, потому что узкого типа
 * для них в каталоге нет (талер Марии Терезии с рестрайками — настоящий долгоживущий тип, и он
 * тоже попадает под правило). Пустая корзина честнее смешанной.
 *
 *   node catalog/repair-wide-span.js [--apply] [--limit N]
 */
const { pool } = require("./db");
const { parseTitle, matchType } = require("./coin-matcher");

const BATCH = 500;

(async () => {
  const apply = process.argv.includes("--apply");
  const li = process.argv.indexOf("--limit");
  const limit = li > -1 ? parseInt(process.argv[li + 1], 10) : 0;

  const rows = (await pool.query(
    `SELECT l.id link_id, l.type_id, a.coin_description cd
       FROM lot_type_link l
       JOIN coin_type t ON t.id = l.type_id
       JOIN auction_lots a ON a.id = l.lot_id
       JOIN lot_kind k ON k.lot_id = l.lot_id AND k.kind = 'coin'
      WHERE t.era = 'foreign'
        AND COALESCE(t.year_end, t.year) - COALESCE(t.year_start, t.year) > 50
        AND a.coin_description IS NOT NULL
      ORDER BY l.id ${limit ? "LIMIT " + limit : ""}`)).rows;
  console.log(`связей в широких типах: ${rows.length}${apply ? " (APPLY)" : " (сухой прогон)"}`);

  let same = 0, moved = 0, dropped = 0, done = 0;
  const moveBuf = [], dropBuf = [];

  const flush = async () => {
    if (!apply) { moveBuf.length = 0; dropBuf.length = 0; return; }
    for (const [linkId, typeId] of moveBuf)
      await pool.query("UPDATE lot_type_link SET type_id=$1 WHERE id=$2", [typeId, linkId]);
    if (dropBuf.length)
      await pool.query("DELETE FROM lot_type_link WHERE id = ANY($1)", [dropBuf]);
    moveBuf.length = 0; dropBuf.length = 0;
  };

  for (const r of rows) {
    let m = null;
    try { m = await matchType(pool, parseTitle(r.cd)); } catch (_) {}
    if (!m) { dropped++; dropBuf.push(r.link_id); }
    else if (m.id === r.type_id) same++;
    else { moved++; moveBuf.push([r.link_id, m.id]); }
    if (moveBuf.length + dropBuf.length >= BATCH) await flush();
    if (++done % 2000 === 0) console.log(`  ${done}/${rows.length} · оставлено ${same} · переставлено ${moved} · снято ${dropped}`);
  }
  await flush();
  console.log(`ИТОГ: оставлено ${same} · переставлено ${moved} · снято ${dropped}`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
