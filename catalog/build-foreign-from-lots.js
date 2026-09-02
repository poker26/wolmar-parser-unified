/**
 * Иностранные типы ИЗ ОПИСАНИЙ ЛОТОВ — там, где справочника нет и не будет.
 *
 * Последнее издание Краузе доходит до 2018 года, а сирот с 2019-го и позже — около четырёх тысяч.
 * Источник для них один: сами лоты, и они называют всё нужное — страну, номинал, год и сюжет.
 * Тип с сюжетом, а не заглушка: иначе «2 доллара. Ниуэ 2021. Дарт Вейдер» и «…Йода» попадут в
 * одну ценовую корзину, а это ровно тот дефект, ради которого заводился аудит смешанных корзин.
 *
 * Берём ТОЛЬКО те лоты, про которые матчер сам говорит «нет типа в каталоге»: значит, кандидата
 * не нашлось вовсе, и新 тип не задвоит существующий.
 *
 *   node catalog/build-foreign-from-lots.js [--from 2019] [--min 1] [--show 40] [--apply]
 */
const { pool } = require("./db");
const { DIAG, parseTitle, matchType, countryList, themeWords, NON_THEME } = require("./coin-matcher");

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > -1 ? Number(process.argv[i + 1]) : d; };
const RU_CACHE = new Map();
async function ruNames(en) {
  if (!RU_CACHE.has(en)) {
    // Русские имена ищем и по КОРОТКОМУ названию: в каталоге страна зовётся «China, People's
    // Republic», а словарь знает «Китай» под «China» — иначе слово «китай» попадало в сюжет.
    const base = String(en).split(/[,(-]/)[0].trim();
    const a = (await pool.query("SELECT ru FROM numis_country_map WHERE en = ANY($1)", [[en, base]])).rows.map((r) => r.ru);
    const b = (await pool.query("SELECT ru FROM numis_country_ru WHERE country = ANY($1)", [[en, base]])).rows
      .flatMap((r) => (Array.isArray(r.ru) ? r.ru : []));
    RU_CACHE.set(en, new Set([...a, ...b].flatMap((x) => themeWords(x))));
  }
  return RU_CACHE.get(en);
}

(async () => {
  const apply = process.argv.includes("--apply");
  const FROM = arg("from", 2019), MIN = arg("min", 1), SHOW = arg("show", 40);
  DIAG.on = true;
  console.log(`${apply ? "(APPLY)" : "(сухой прогон)"} с ${FROM} года, порог ${MIN}`);

  const rows = (await pool.query(`
    SELECT a.coin_description cd FROM auction_lots a
      JOIN lot_kind k ON k.lot_id=a.id AND k.kind='coin'
      LEFT JOIN lot_type_link l ON l.lot_id=a.id
     WHERE l.lot_id IS NULL AND a.coin_description IS NOT NULL AND a.year >= $1`, [FROM])).rows;
  console.log(`сирот с ${FROM} года: ${rows.length}`);

  const grid = new Map();
  for (const r of rows) {
    const p = parseTitle(r.cd);
    if (!p.denom || !p.year || p.year < FROM || p.denom.isRf) continue;
    let m = null;
    try { m = await matchType(pool, p); } catch (_) { continue; }
    if (m || !/нет типа/.test(DIAG.reason || "")) continue;      // только настоящий пробел
    const cs = await countryList(pool, p.title, p.year, p.denom.unit);
    if (!cs.length) continue;
    const skip = new Set([...themeWords(cs[0]), ...(await ruNames(cs[0])),
                          ...themeWords(String(p.denom.raw || p.denom.num) + " " + p.denom.unit)]);
    const subj = (p.headWords || []).filter((w) => !NON_THEME.test(w) && !skip.has(w) && w.length >= 4);
    if (!subj.length) continue;                                   // без сюжета — дело спайна
    const den = `${p.denom.raw || p.denom.num} ${p.denom.unit}`;
    // Ключ по ОСНОВАМ слов сюжета, отсортированным: разный порядок и падежи не должны плодить типы.
    const key = [cs[0], den, p.year, subj.map((w) => w.slice(0, 5)).sort().join("+")].join("|");
    const g = grid.get(key) || { country: cs[0], den, year: p.year, subj, n: 0, ex: r.cd };
    g.n++;
    if (g.subj.length > subj.length) g.subj = subj;               // короче — ближе к сути
    grid.set(key, g);
  }

  const want = [...grid.values()].filter((g) => g.n >= MIN).sort((a, b) => b.n - a.n);
  console.log(`сочетаний страна+номинал+год+сюжет: ${grid.size}, прошли порог: ${want.length}`);
  for (const g of want.slice(0, SHOW))
    console.log(`  ${String(g.n).padStart(3)} · ${g.den}. ${g.country} ${g.year} — ${g.subj.join(" ")}`.slice(0, 118));
  if (want.length > SHOW) console.log(`  … ещё ${want.length - SHOW}`);

  let made = 0;
  for (const g of want) {
    const theme = g.subj.join(" ");
    if (apply) {
      await pool.query(
        `INSERT INTO coin_type (source, country, era, name_full, theme_core, theme_ru, denomination_text,
                                year, type_key, status, created_at, updated_at)
         VALUES ('lots_foreign',$1,'foreign',$2,$3,$3,$4,$5,$6,'catalog',now(),now())
         ON CONFLICT (era, type_key) WHERE era IS NOT NULL DO NOTHING`,
        [g.country, `${g.den}. ${g.country.toUpperCase()} ${g.year} — ${theme}`.slice(0, 250),
         theme.slice(0, 200), g.den, g.year,
         `lots|${g.country.toUpperCase()}|${g.den}|${g.year}|${g.subj.map((w) => w.slice(0, 5)).sort().join("+")}`]);
    }
    made++;
  }
  console.log(`${apply ? "СОЗДАНО" : "К СОЗДАНИЮ"}: ${made}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
