/**
 * Связи на иностранные типы с ЧУЖОЙ денежной единицей.
 *
 * До того как матчер начал сверять единицу номинала, отбор шёл по одному ведущему числу: «1 флорин
 * 1953» садился на SHILLING, «10 фунтов» — на 10 PENCE. Для цены это существенно: флорин и шиллинг
 * стоят по-разному, а медиана типа считается по привязанным лотам.
 *
 * Чиним адресно и осторожно: берём только связи, где единица лота известна словарю и НЕ найдена у
 * связанного типа, переспрашиваем матчер и переставляем связь, лишь если у нового типа единица
 * совпала. Ничего не удаляем — молчание матчера не доказывает, что связь плохая.
 *
 *   node catalog/repair-unit-links.js [--apply] [--limit N]
 */
const { pool } = require("./db");
const { parseTitle, matchType, enUnit } = require("./coin-matcher");

const unitRe = (en, ru) => ({
  en: new RegExp("(?<![A-Z])" + en + "S?(?![A-Z])", "i"),
  ru: new RegExp("(?<![а-яё])" + String(ru).slice(0, 4) + "[а-яё]*(?![а-яё])", "i"),
});
const fits = (txt, re) => re.en.test(txt) || re.ru.test(txt);

(async () => {
  const apply = process.argv.includes("--apply");
  const li = process.argv.indexOf("--limit");
  const limit = li > -1 ? parseInt(process.argv[li + 1], 10) : 0;

  const rows = (await pool.query(
    `SELECT l.id link_id, a.coin_description cd, t.id type_id, t.name_full, t.denomination_text
       FROM lot_type_link l JOIN auction_lots a ON a.id = l.lot_id JOIN coin_type t ON t.id = l.type_id
      WHERE t.era = 'foreign' AND a.coin_description IS NOT NULL ${limit ? "LIMIT " + limit : ""}`)).rows;
  console.log(`связей на иностранные типы: ${rows.length}${apply ? " (APPLY)" : " (сухой прогон)"}`);

  let ok = 0, bad = 0, moved = 0, kept = 0;
  const ex = [];
  for (const r of rows) {
    const p = parseTitle(r.cd);
    if (!p.denom || p.denom.isRf) continue;
    const en = enUnit(p.denom.unit);
    if (!en) continue;
    const re = unitRe(en, p.denom.unit);
    const txt = String(r.denomination_text || "") + " " + String(r.name_full || "");
    if (fits(txt, re)) { ok++; continue; }
    bad++;
    const m = await matchType(pool, p).catch(() => null);
    if (!m || m.id === r.type_id) { kept++; continue; }
    const nt = (await pool.query("SELECT name_full, denomination_text FROM coin_type WHERE id=$1", [m.id])).rows[0];
    if (!nt || !fits(String(nt.denomination_text || "") + " " + String(nt.name_full || ""), re)) { kept++; continue; }
    moved++;
    if (ex.length < 8) ex.push(`${r.cd.replace(/\s+/g, " ").slice(0, 44)} : «${(r.name_full || "").slice(0, 26)}» → «${(nt.name_full || "").slice(0, 26)}»`);
    if (apply) await pool.query(
      "UPDATE lot_type_link SET type_id=$2, match_method='unit-repair', match_confidence=$3 WHERE id=$1",
      [r.link_id, m.id, m.conf]);
  }
  for (const e of ex) console.log("  ", e);
  console.log(`единица совпала ${ok} · чужая ${bad} · переставлено ${moved} · оставлено как есть ${kept}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
