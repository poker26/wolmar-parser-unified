/**
 * Точечная починка ОДНОЙ группы дефектов: связь, противоречащая написанной единице номинала.
 *
 * По хендоффу задачи оценки: «10 миллимов. Тунис» висело на «10 DINARS», «1 ранд. ЮАР» — на
 * «1 CENT», «2 пенго. Венгрия» — на «2 FILLÉR». Причина была в матчере: единицу, которой нет в
 * словаре, не сверяли вовсе, и оставалось одно совпадение числа. Причина устранена; здесь
 * снимаются уже накопленные связи этой группы.
 *
 * Снимаем ТОЛЬКО те, где матчер теперь называет причиной несовпадение единицы. Ни подтверждения,
 * ни перестановки не пишем — общий релинк по этой находке не запускается (просьба хендоффа).
 *
 *   node catalog/repair-unit-mismatch.js [--apply] [--limit N]
 */
const { pool } = require("./db");
const { DIAG, parseTitle, matchType, enUnit, unitSkeleton } = require("./coin-matcher");

// Причина от матчера — сигнал, но не доказательство: в переборе стран она могла прийти от
// ДРУГОЙ страны. Поэтому противоречие проверяем прямо у привязанного типа: его единица и
// единица лота должны расходиться и по словарю, и по транслитерации.
const contradicts = (lotUnit, dtext) => {
  const txt = String(dtext || "");
  const w = txt.match(/[A-Za-zА-Яа-яЁёÀ-ɏ]{3,}/);
  if (!w) return false;                                   // у типа единица не написана
  const en = enUnit(lotUnit);
  if (en && new RegExp("(?<![A-Z])" + en + "S?(?![A-Z])", "i").test(txt)) return false;
  const ru = new RegExp("(?<![а-яё])" + String(lotUnit).slice(0, 4) + "[а-яё]*(?![а-яё])", "i");
  if (ru.test(txt)) return false;
  const a = unitSkeleton(lotUnit), b = unitSkeleton(w[0]);
  const n = Math.min(4, a.length, b.length);
  return !(n >= 3 && a.slice(0, n) === b.slice(0, n));
};

const REASON = "единица номинала не совпала";

(async () => {
  const apply = process.argv.includes("--apply");
  const li = process.argv.indexOf("--limit");
  const limit = li > -1 ? parseInt(process.argv[li + 1], 10) : 0;
  DIAG.on = true;

  const rows = (await pool.query(
    `SELECT l.id link_id, l.type_id, a.id lot_id, a.coin_description cd, c.denomination_text dt, c.name_full
       FROM lot_type_link l JOIN auction_lots a ON a.id = l.lot_id
       JOIN coin_type c ON c.id = l.type_id
       JOIN lot_kind k ON k.lot_id = l.lot_id AND k.kind = 'coin'
      WHERE c.era = 'foreign' AND a.coin_description IS NOT NULL
      ORDER BY l.id ${limit ? "LIMIT " + limit : ""}`)).rows;
  console.log(`иностранных связей к проверке: ${rows.length}${apply ? " (APPLY)" : " (сухой прогон)"}`);

  const bad = [];
  let done = 0;
  for (const r of rows) {
    let m = null;
    try { m = await matchType(pool, parseTitle(r.cd)); } catch (_) {}
    if (!m && DIAG.reason === REASON) {
      const p = parseTitle(r.cd);
      if (p.denom && contradicts(p.denom.unit, r.dt)) bad.push(r);
    }
    if (++done % 50000 === 0) console.log(`  ${done}/${rows.length} проверено, найдено ${bad.length}`);
  }
  console.log(`\nсвязей с чужой единицей: ${bad.length}`);
  const byType = new Map();
  for (const b of bad) {
    const k = `${b.dt} ← ${String(b.cd).replace(/\s+/g, " ").split(".")[0].slice(0, 24)}`;
    byType.set(k, (byType.get(k) || 0) + 1);
  }
  for (const [k, v] of [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(`  ${String(v).padStart(4)}  ${k}`);

  if (apply && bad.length) {
    for (let i = 0; i < bad.length; i += 500) {
      const ids = bad.slice(i, i + 500).map((b) => b.link_id);
      await pool.query("DELETE FROM lot_type_link WHERE id = ANY($1::bigint[])", [ids]);
    }
    console.log(`СНЯТО: ${bad.length}`);
  }
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
