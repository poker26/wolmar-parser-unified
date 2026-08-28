/**
 * Починка связей, созданных из-за неверного разбора дробного номинала.
 *
 * До исправления «1/2 копейки 1840» разбиралось как «2 копейки», и лот мог сесть на тип вчетверо
 * крупнее. Связи на ПРАВИЛЬНЫЙ тип (тот же «1/2 копейки») при этом тоже существуют и трогать их
 * нельзя — аудит соседней задачи помечает их как ложную тревогу.
 *
 * Поэтому чиним адресно: берём только лоты с дробным номиналом в начале описания, сверяем номинал
 * связанного типа с разобранным и, если он не совпал, переспрашиваем матчер. Связь переставляем
 * ТОЛЬКО когда матчер нашёл тип с нужным номиналом. Ничего не удаляем: первая версия скрипта
 * предлагала снять 1086 связей вида «1/13 шиллинга. Джерси» → «1/13 SHILLING. JERSEY», то есть
 * совершенно правильных — просто матчер в тот момент ещё искал дробь десятичным числом. Молчание
 * матчера не доказывает, что связь плохая.
 *
 *   node catalog/repair-fraction-links.js [--apply]
 */
const { pool } = require("./db");
const { parseTitle, matchType } = require("./coin-matcher");

const EPS = 1e-9;

(async () => {
  const apply = process.argv.includes("--apply");
  const rows = (await pool.query(
    `SELECT l.id link_id, l.lot_id, l.type_id, a.coin_description cd,
            t.name_full, t.denomination_value::float8 tv
       FROM lot_type_link l
       JOIN auction_lots a ON a.id = l.lot_id
       JOIN coin_type t ON t.id = l.type_id
      WHERE a.coin_description ~ '^[^0-9]{0,20}[0-9]+ *[/] *[0-9]+'`)).rows;
  console.log(`связей с дробным номиналом в описании: ${rows.length}${apply ? " (APPLY)" : " (сухой прогон)"}`);

  let ok = 0, moved = 0, kept = 0, noValue = 0;
  const ex = [];
  for (const r of rows) {
    const p = parseTitle(r.cd);
    if (!p.denom || p.denom.value == null) { noValue++; continue; }
    if (r.tv == null) { noValue++; continue; }
    if (Math.abs(r.tv - p.denom.value) < EPS) { ok++; continue; }
    const m = await matchType(pool, p).catch(() => null);
    if (!m || m.id === r.type_id) { kept++; continue; }
    // Переставляем, только если у нового типа номинал ДЕЙСТВИТЕЛЬНО совпал с разобранным.
    const nv = (await pool.query("SELECT denomination_value::float8 v, name_full FROM coin_type WHERE id=$1", [m.id])).rows[0];
    if (!nv || nv.v == null || Math.abs(nv.v - p.denom.value) >= EPS) { kept++; continue; }
    moved++;
    if (ex.length < 8) ex.push(`${r.cd.replace(/\s+/g, " ").slice(0, 46)} : «${(r.name_full || "").slice(0, 26)}» → «${(nv.name_full || "").slice(0, 26)}»`);
    if (apply) await pool.query(
      "UPDATE lot_type_link SET type_id=$2, match_method='fraction-repair', match_confidence=$3 WHERE id=$1",
      [r.link_id, m.id, m.conf]);
  }
  for (const e of ex) console.log("  ", e);
  console.log(`номинал совпал ${ok} · переставлено ${moved} · оставлено как есть ${kept} · без сравнения ${noValue}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
