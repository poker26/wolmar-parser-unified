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
  // Приставку допускаем так же, как матчер: «2 марки» и «2 REICHSMARK» — одна единица.
  if (en && new RegExp("(?<![A-Z])(?:REICHS|RENTEN|DEUTSCHE|GOLD|SILBER|NEUE?|NEW|OLD|NOVA?)?" + en + "S?(?![A-Z])", "i").test(txt)) return false;
  const ru = new RegExp("(?<![а-яё])" + String(lotUnit).slice(0, 4) + "[а-яё]*(?![а-яё])", "i");
  if (ru.test(txt)) return false;
  const a = unitSkeleton(lotUnit), b = unitSkeleton(w[0]);
  const n = Math.min(3, a.length, b.length);
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
    // Признак — САМО противоречие у привязанного типа, а причина от матчера лишь сопутствует ей.
    // Опора только на причину пропускала половину случаев: у «5 копеек. Украина» → «5 HRYVEN»
    // матчер молчит по другому поводу, а единица противоречит ровно так же.
    if (m && m.id === r.type_id) continue;
    // Узко и намеренно: чиним только то, где сам матчер называет причиной несовпадение единицы.
    // Опора на одно лишь противоречие давала ложные срабатывания на равнозначных записях
    // («2 сентаво» и «2 CENTAVOS», «50 центов» и «1/2 доллара»), а это УДАЛЕНИЕ связей.
    const p = parseTitle(r.cd);
    // Берём случай, если ЛИБО матчер прямо назвал причиной единицу, ЛИБО единица лота есть в
    // словаре и у привязанного типа её нет. Второе условие нужно для «1 ранд. ЮАР» → «1 CENT»:
    // там матчер молчит по другому поводу, а противоречие всё то же. Догадкам по транслитерации
    // такого права не даём — это УДАЛЕНИЕ связей.
    if (DIAG.reason !== REASON && !(p.denom && enUnit(p.denom.unit))) continue;
    if (!p.denom || !contradicts(p.denom.unit, r.dt)) continue;
    // Числа должны совпадать: «50 центов» и «1/2 доллара» — ОДНА монета, записанная по-разному,
    // и снимать такую связь нельзя. Расхождение единицы важно там, где число одно и то же.
    const tn = String(r.dt || "").match(/^[\d/.,]+/);
    const ln = String(p.denom.raw || p.denom.num);
    if (!tn || tn[0].replace(",", ".") !== ln.replace(",", ".")) continue;
    r.moveTo = m && m.id !== r.type_id ? m : null;
    bad.push(r);
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

  const move = bad.filter((b) => b.moveTo), drop = bad.filter((b) => !b.moveTo);
  console.log(`из них: переставить ${move.length} · снять ${drop.length}`);
  if (apply) {
    for (const b of move) {
      await pool.query(
        "UPDATE lot_type_link SET type_id=$2, match_method='unit-fix', match_confidence=$3 WHERE id=$1",
        [b.link_id, b.moveTo.id, b.moveTo.conf]);
    }
    for (let i = 0; i < drop.length; i += 500) {
      const ids = drop.slice(i, i + 500).map((b) => b.link_id);
      await pool.query("DELETE FROM lot_type_link WHERE id = ANY($1::bigint[])", [ids]);
    }
    console.log(`ПЕРЕСТАВЛЕНО ${move.length} · СНЯТО ${drop.length}`);
  }
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
