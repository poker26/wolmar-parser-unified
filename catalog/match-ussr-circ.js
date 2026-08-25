/**
 * Шаг 2: привязка НАШИХ проходов к погодовке СССР (fcoins_ussr_circ) по номинал+год.
 * 495 (номинал,год)-комбо, 7 мульти (1935 старый/новый) → разрулить ключевиком/Федорин№.
 * Реальные медианы по грейдам считает API из lot_type_link. Re-runnable. Запуск: node catalog/match-ussr-circ.js
 */
const { pool } = require("./db");
const N = require("./normalize");
const CAT = "Монеты РСФСР, СССР, России";

(async () => {
  const t = await pool.query("SELECT id, denomination_value dv, year, name_full, fedorin_number FROM coin_type WHERE source='fcoins_ussr_circ'");
  const byDY = new Map();
  for (const r of t.rows) {
    const k = `${Number(r.dv)}|${r.year}`;
    if (!byDY.has(k)) byDY.set(k, []);
    byDY.get(k).push({ id: r.id, nf: (r.name_full || "").toLowerCase(), fed: r.fedorin_number });
  }
  // re-runnable: снять прошлые circ-привязки
  await pool.query("DELETE FROM lot_type_link l USING coin_type ct WHERE l.type_id=ct.id AND ct.source='fcoins_ussr_circ'");

  const lots = await pool.query(
    `SELECT id, year, condition, coin_description d FROM auction_lots
     WHERE category=$1 AND year BETWEEN 1921 AND 1991 AND coin_description IS NOT NULL
       AND (auction_end_date IS NULL OR auction_end_date < now())`, [CAT]);
  const links = [];
  let matched = 0, ambig = 0, nodenom = 0, notype = 0, excl = 0;
  for (const r of lots.rows) {
    if (N.isExcluded(r.d)) { excl++; continue; }
    const cn = r.d.match(/^(.+?)(?=\s*\d{4}\s*г)/); if (!cn) { nodenom++; continue; }
    const denom = N.denomination(cn[1].trim()); if (denom.value == null) { nodenom++; continue; }
    const cands = byDY.get(`${denom.value}|${r.year}`);
    if (!cands || !cands.length) { notype++; continue; }
    let pick = cands[0];
    if (cands.length > 1) {
      const dl = r.d.toLowerCase();
      const nu = cands.find((c) => /новый/.test(c.nf)), st = cands.find((c) => /старый/.test(c.nf));
      const fm = dl.match(/федорин\s*№?\s*(\d+)/);
      if (/новый/.test(dl) && nu) pick = nu;
      else if (/старый/.test(dl) && st) pick = st;
      else if (fm) { const f = cands.find((c) => (c.fed || "").includes(fm[1])); if (f) pick = f; else { ambig++; continue; } }
      else { ambig++; continue; }
    }
    links.push([r.id, pick.id, r.condition]); matched++;
  }
  for (let i = 0; i < links.length; i += 1000) {
    const ch = links.slice(i, i + 1000), lo = [], ty = [], gr = [];
    for (const x of ch) { lo.push(x[0]); ty.push(x[1]); gr.push(x[2]); }
    await pool.query(`INSERT INTO lot_type_link (lot_id,type_id,grade,match_method)
      SELECT lot,typ,gr,'ussr_circ' FROM unnest($1::int[],$2::int[],$3::text[]) AS u(lot,typ,gr)
      ON CONFLICT (lot_id) DO NOTHING`, [lo, ty, gr]);
  }
  const withp = (await pool.query("SELECT count(DISTINCT type_id) c FROM lot_type_link l JOIN coin_type t ON t.id=l.type_id WHERE t.source='fcoins_ussr_circ'")).rows[0].c;
  console.log(`лотов 1921-91: ${lots.rows.length} | сматчено: ${matched} | мульти-skip: ${ambig} | без номинала: ${nodenom} | нет погодовка-типа: ${notype} | наборы: ${excl}`);
  console.log(`погодовка-типов СССР с проходами: ${withp} / 502`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
