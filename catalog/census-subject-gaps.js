/**
 * Сироты, у которых в заголовке НАЗВАН сюжет: чего им не хватает.
 *
 * Названный сюжет — лучший материал для каталога: лот сообщает страну, номинал, год и сюжет,
 * то есть полную карточку. Но заводить тип можно не всегда:
 *   · типа для этого сюжета нет вовсе      → заводим, это чистый выигрыш;
 *   · тип есть, а матчер не выбрал         → заводить НЕЛЬЗЯ: задвоим монету и растащим проходы.
 * Разделяем по причине, которую называет сам матчер.
 *
 *   node catalog/census-subject-gaps.js [выборка]
 */
const { pool } = require("./db");
const { DIAG, parseTitle, matchType, countryList, themeWords, NON_THEME } = require("./coin-matcher");

// Русские написания страны из обоих словарей каталога.
const RU_CACHE = new Map();
async function ruNames(en) {
  if (!RU_CACHE.has(en)) {
    const a = (await pool.query("SELECT ru FROM numis_country_map WHERE en=$1", [en])).rows.map((r) => r.ru);
    const b = (await pool.query("SELECT ru FROM numis_country_ru WHERE country=$1", [en])).rows
      .flatMap((r) => (Array.isArray(r.ru) ? r.ru : []));
    RU_CACHE.set(en, new Set([...a, ...b].flatMap((x) => themeWords(x))));
  }
  return RU_CACHE.get(en);
}

(async () => {
  const N = +(process.argv[2] || 20000);
  DIAG.on = true;
  const rows = (await pool.query(`
    SELECT a.coin_description cd FROM auction_lots a
      JOIN lot_kind k ON k.lot_id=a.id AND k.kind='coin'
      LEFT JOIN lot_type_link l ON l.lot_id=a.id
     WHERE l.lot_id IS NULL AND a.coin_description IS NOT NULL
     ORDER BY a.id % 61, a.id LIMIT $1`, [N])).rows;

  const cnt = new Map(), ex = new Map(), years = new Map();
  let withSubj = 0;
  for (const r of rows) {
    const p = parseTitle(r.cd);
    if (p.isSet || p.isNonCoin || !p.denom || !p.year || p.denom.isRf) continue;
    let m = null;
    try { m = await matchType(pool, p); } catch (_) {}
    if (m) continue;
    const cs = await countryList(pool, p.title, p.year, p.denom.unit);
    if (!cs.length) continue;
    // Имя страны ПО-РУССКИ сюжетом не является: «1 экю. Франция 1998» ничего кроме страны не
    // называет. Без этой оговорки в «названный сюжет» попадала половина всех сирот, и цифра
    // получалась завышенной вдвое.
    const cw = new Set([...themeWords(cs[0]), ...(await ruNames(cs[0]))]);
    const du = new Set(themeWords(String(p.denom.raw || p.denom.num) + " " + p.denom.unit));
    const subj = (p.headWords || []).filter((w) => !NON_THEME.test(w) && !cw.has(w) && !du.has(w));
    if (!subj.length) continue;                       // сюжет не назван — материал заглушки
    withSubj++;
    const k = DIAG.reason || "прочее";
    cnt.set(k, (cnt.get(k) || 0) + 1);
    if (!ex.has(k)) ex.set(k, []);
    if (ex.get(k).length < 3) ex.get(k).push(`${String(r.cd).replace(/\s+/g, " ").slice(0, 66)} · сюжет: ${subj.slice(0, 3).join(" ")}`);
    const band = p.year >= 2019 ? "2019+" : p.year >= 2001 ? "2001-2018" : p.year >= 1901 ? "1901-2000" : "до 1901";
    const bk = k + " | " + band;
    years.set(bk, (years.get(bk) || 0) + 1);
  }
  console.log(`выборка ${rows.length} · сирот с НАЗВАННЫМ сюжетом: ${withSubj}\n`);
  for (const [k, v] of [...cnt.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(5)}  ${k}`);
    for (const e of ex.get(k)) console.log(`         ${e}`);
  }
  console.log("\nпо эпохам:");
  for (const [k, v] of [...years.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))
    console.log(`  ${String(v).padStart(5)}  ${k}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
