/**
 * Недостающие тиражные типы иностранных монет → coin_type (era='foreign').
 *
 * Пробелы каталога на 81 % — это строки, не извлечённые из имеющихся томов, а два верхних
 * десятилетия (2010-е и 2020-е) не покрыты НИ ОДНИМ справочником: последнее издание Краузе
 * доходит до 2018 года. Ждать книгу неоткуда, зато сами лоты называют монету полностью:
 * страна, номинал, год. Из этого и собираем тип — ровно так же, как спайны модерна, СССР и
 * империи, и по тем же правилам.
 *
 * Тип создаётся ТОЛЬКО когда лоты о сюжете молчат: «1 доллар. Тувалу 2015» — это ответ на
 * «монета такого номинала и года», а памятную монету с названным сюжетом обязан описывать
 * настоящий каталожный тип, а не заглушка.
 *
 *   node catalog/build-foreign-spine.js [--min N] [--apply] [--show N]
 */
const { pool } = require("./db");
const { parseTitle, countryList, themeWords, NON_THEME } = require("./coin-matcher");

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > -1 ? Number(process.argv[i + 1]) : d; };

(async () => {
  const apply = process.argv.includes("--apply");
  const MIN = arg("min", 4);
  const SHOW = arg("show", 30);
  console.log(apply ? "(APPLY)" : "(сухой прогон)");

  const lots = (await pool.query(`
    SELECT a.coin_description cd FROM auction_lots a
      JOIN lot_kind k ON k.lot_id=a.id AND k.kind='coin'
      LEFT JOIN lot_type_link l ON l.lot_id=a.id
     WHERE l.lot_id IS NULL AND a.coin_description IS NOT NULL`)).rows;
  console.log(`сирот-монет: ${lots.length}`);

  const grid = new Map();
  for (const { cd } of lots) {
    const p = parseTitle(cd);
    if (p.isSet || p.isNonCoin || p.isAncient || !p.denom || !p.year) continue;
    if (p.denom.isRf) continue;                                   // рублёвые эры не наша забота
    if (p.year < 1800 || p.year > 2030) continue;
    const cs = await countryList(pool, p.title, p.year);
    if (!cs.length) continue;                                     // страна не распознана — не гадаем
    const den = (p.denom.raw ? p.denom.raw + " " + p.denom.unit : p.denom.num + " " + p.denom.unit);
    const k = `${cs[0]}|${den}|${p.year}`;
    const g = grid.get(k) || { country: cs[0], den, year: p.year, n: 0, subj: 0, ex: cd, metal: new Map() };
    g.n++;
    // Сюжет в заголовке: слова сверх страны и номинала. Если лоты его называют, заглушку не ставим.
    const cw = new Set(themeWords(cs[0]));
    const extra = (p.headWords || []).filter((w) => !NON_THEME.test(w) && !cw.has(w)
      && !themeWords(den).includes(w));
    if (extra.length) g.subj++;
    const m = /золот|(?<![а-яёa-z])au(?![а-яёa-z])/i.test(cd) ? "золото"
      : /сереб|(?<![а-яёa-z])ag(?![а-яёa-z])/i.test(cd) ? "серебро" : null;
    if (m) g.metal.set(m, (g.metal.get(m) || 0) + 1);
    grid.set(k, g);
  }
  console.log(`сочетаний страна+номинал+год: ${grid.size}`);

  // Уже существующие типы: страна + год в диапазоне + ведущее число номинала.
  const want = [];
  for (const g of grid.values()) {
    if (g.n < MIN) continue;
    if (g.subj > g.n / 2) continue;                               // больше половины лотов с сюжетом
    const lead = String(g.den).match(/^[\d/.,]+/);
    if (!lead) continue;
    const has = (await pool.query(
      `SELECT count(*)::int c FROM coin_type WHERE era='foreign' AND country=$1
         AND $2 BETWEEN COALESCE(year_start, year) AND COALESCE(year_end, year)
         AND denomination_text ~* ('^' || $3 || '([^0-9]|$)')`,
      [g.country, g.year, lead[0].replace(".", "[.]")])).rows[0].c;
    if (has) continue;
    want.push(g);
  }
  want.sort((a, b) => b.n - a.n);
  console.log(`сочетаний без типа, прошли порог ${MIN}: ${want.length}`);
  for (const g of want.slice(0, SHOW))
    console.log(`  ${(g.den + ". " + g.country + " " + g.year).padEnd(46)} лотов ${String(g.n).padStart(4)} · ${g.ex.replace(/\s+/g, " ").slice(0, 54)}`);
  if (want.length > SHOW) console.log(`  … ещё ${want.length - SHOW}`);

  let made = 0;
  for (const g of want) {
    const metal = [...g.metal.entries()].sort((a, b) => b[1] - a[1])[0];
    const mv = metal && metal[1] > g.n / 2 ? metal[0] : null;
    if (apply) {
      await pool.query(
        `INSERT INTO coin_type (source, country, era, name_full, theme_core, denomination_text,
                                year, type_key, metal, status, created_at, updated_at)
         VALUES ('spine_foreign',$1,'foreign',$2,'',$3,$4,$5,$6,'catalog',now(),now())
         ON CONFLICT (era, type_key) WHERE era IS NOT NULL DO NOTHING`,
        [g.country, `${g.den}. ${g.country.toUpperCase()} ${g.year}`, g.den, g.year,
         `spine|${g.country.toUpperCase()}|${g.den}|${g.year}`, mv]);
    }
    made++;
  }
  console.log(`${apply ? "СОЗДАНО" : "К СОЗДАНИЮ"}: ${made}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
