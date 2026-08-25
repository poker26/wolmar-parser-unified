/**
 * Шаг 3: кросс-референс Краузе KM# на погодовку СССР. Советский coin_ref (USSR/CCCP + RUSSIA с 1921)
 * → индекс (номинал-значение, год)→km → проставить km_number на fcoins_ussr_circ типах где пусто.
 * Additive. node catalog/attach-km-ussr.js
 */
const { pool } = require("./db");

const enDenom = (s) => {
  s = String(s || "").toUpperCase();
  let m = s.match(/(\d+)\s*\/\s*(\d+)\s*KOPEK/); if (m) return (+m[1] / +m[2]) / 100;
  m = s.match(/(\d+(?:\.\d+)?)\s*KOPE/); if (m) return parseFloat(m[1]) / 100;
  m = s.match(/(\d+(?:\.\d+)?)\s*(ROUBLE|RUBLE)/); if (m) return parseFloat(m[1]);
  if (/^ROUBLE|^RUBLE/.test(s)) return 1;
  if (/KOPEK/.test(s)) return 0.01;
  return null;
};

(async () => {
  const cr = await pool.query(
    `SELECT km, country_norm, denomination, issues FROM coin_ref
     WHERE source='scwc' AND km IS NOT NULL
       AND (country_norm IN ('USSR','CCCP (U.S.S.R.)') OR country_norm='RUSSIA')`);
  const idx = new Map(); // dv|year -> km (first wins)
  for (const r of cr.rows) {
    const dv = enDenom(r.denomination); if (dv == null) continue;
    const soviet = r.country_norm !== 'RUSSIA';
    for (const i of (r.issues || [])) {
      const y = parseInt(i.year, 10); if (!Number.isFinite(y)) continue;
      if (!soviet && y < 1921) continue;          // RUSSIA bucket: только советские годы
      const k = `${dv}|${y}`; if (!idx.has(k)) idx.set(k, String(r.km));
    }
  }
  console.log("советских (номинал,год)→KM# ключей:", idx.size);
  const t = await pool.query("SELECT id, denomination_value dv, year FROM coin_type WHERE source='fcoins_ussr_circ' AND km_number IS NULL");
  let set = 0;
  for (const r of t.rows) {
    const km = idx.get(`${Number(r.dv)}|${r.year}`);
    if (km) { await pool.query("UPDATE coin_type SET km_number=$1 WHERE id=$2", [km, r.id]); set++; }
  }
  const c = (await pool.query("SELECT count(km_number) c FROM coin_type WHERE source='fcoins_ussr_circ'")).rows[0].c;
  console.log(`проставлен KM#: ${set} | итого погодовки с KM#: ${c} / 502`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
