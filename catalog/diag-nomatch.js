// Диагностика: почему no_match? Сколько восстановится при year±1 / без года.
const { pool } = require("./db");
const N = require("./normalize");

(async () => {
  const t = await pool.query("SELECT denomination_value, year, theme_core, spec_flag FROM coin_type");
  const byDenomYearCoreSpec = new Set(); // dv|year|core|spec
  const byDenomCoreSpec = new Set();     // dv|core|spec (без года)
  const byCore = new Set();              // core (любой деном/год)
  for (const r of t.rows) {
    const dv = r.denomination_value == null ? null : Number(r.denomination_value);
    const s = r.spec_flag ? "S" : "";
    byDenomYearCoreSpec.add([dv, r.year, r.theme_core, s].join("|"));
    byDenomCoreSpec.add([dv, r.theme_core, s].join("|"));
    byCore.add(r.theme_core);
  }
  // no_match лоты: берём из auction_lots по review_queue
  const rq = await pool.query("SELECT lot_id, bucket, our_theme FROM review_queue WHERE finding='no_match'");
  const stat = { total: rq.rows.length, yearPM1: 0, anyYear: 0, coreOnly: 0, trulyAbsent: 0 };
  const samplesAbsent = [], samplesYear = [];
  for (const r of rq.rows) {
    const [dvS, yearS] = r.bucket.split("|");
    const dv = dvS === "null" ? null : Number(dvS);
    const year = Number(yearS);
    const core = N.core(r.our_theme);
    const s = r.our_theme && N.specFlag(r.our_theme) ? "S" : "";
    let hitYear = false;
    for (const dy of [year - 1, year + 1, year - 2, year + 2]) {
      if (byDenomYearCoreSpec.has([dv, dy, core, s].join("|"))) { hitYear = true; break; }
    }
    if (hitYear) { stat.yearPM1++; if (samplesYear.length < 8) samplesYear.push(`${r.bucket}  «${core}»`); continue; }
    if (byDenomCoreSpec.has([dv, core, s].join("|"))) { stat.anyYear++; continue; }
    if (byCore.has(core)) { stat.coreOnly++; continue; }
    stat.trulyAbsent++; if (samplesAbsent.length < 12) samplesAbsent.push(`${r.bucket}  «${core}»`);
  }
  console.log("=== ДИАГНОСТИКА no_match ===");
  console.log(JSON.stringify(stat, null, 1));
  console.log("\n-- восстановимы сдвигом года (year±1/2, тот же деном+ядро+спец): примеры --");
  samplesYear.forEach(x => console.log("  " + x));
  console.log("\n-- ядра НЕТ в скелете вообще (примеры) --");
  samplesAbsent.forEach(x => console.log("  " + x));
  await pool.end();
})().catch(e => { console.error("FATAL", e.message); process.exit(1); });
