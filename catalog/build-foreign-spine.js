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
const { parseTitle, countryList, themeWords, NON_THEME, enUnit, unitSkeleton } = require("./coin-matcher");

// Тип «уже есть» — только если сходится и ЕДИНИЦА. Проверка по одному ведущему числу считала
// закрытым «10 миллимов. Тунис 1993», для которого в каталоге лежат одни «10 DINARS»: число и
// год те же, монета другая. Из-за этой поблажки спайн видел 259 пробелов вместо настоящего числа.
const unitFits = (unit, dtext) => {
  const txt = String(dtext || "");
  const en = enUnit(unit);
  if (en && new RegExp("(?<![A-Z])(?:REICHS|RENTEN|DEUTSCHE|GOLD|SILBER|NEUE?|NEW|OLD|NOVA?)?" + en + "S?(?![A-Z])", "i").test(txt)) return true;
  if (new RegExp("(?<![а-яё])" + String(unit).slice(0, 4) + "[а-яё]*(?![а-яё])", "i").test(txt)) return true;
  const w = txt.match(/[A-Za-zА-Яа-яЁё\u00c0-\u024f]{3,}/);
  if (!w) return true;                       // единица у типа не написана — не противоречит
  const a = unitSkeleton(unit), b = unitSkeleton(w[0]);
  const n = Math.min(4, a.length, b.length);
  return n >= 3 && a.slice(0, n) === b.slice(0, n);
};

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
    const g = grid.get(k) || { country: cs[0], den, unit: p.denom.unit, year: p.year, n: 0, subj: 0, ex: cd, metal: new Map() };
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
  const subjYears = new Map();
  const skip = { сюжет: 0, "сюжет-лотов": 0, "тип есть": 0, "тип есть-лотов": 0, "номинал без числа": 0 };
  for (const g of grid.values()) {
    if (g.n < 1) continue;
    // Учитываем, ПОЧЕМУ сочетание не попало в спайн: без этого не видно, из чего состоит
    // корзина «нет типа в каталоге» и что именно надо строить.
    if (g.subj > g.n / 2) {
      skip["сюжет"]++; skip["сюжет-лотов"] += g.n;
      const band = g.year >= 2019 ? "2019+" : g.year >= 2001 ? "2001-2018" : g.year >= 1901 ? "1901-2000" : "до 1901";
      subjYears.set(band, (subjYears.get(band) || 0) + g.n);
      continue;
    }
    const lead = String(g.den).match(/^[\d/.,]+/);
    if (!lead) { skip["номинал без числа"]++; continue; }
    const rows = (await pool.query(
      `SELECT denomination_text FROM coin_type WHERE era='foreign' AND country=$1
         AND $2 BETWEEN COALESCE(year_start, year) AND COALESCE(year_end, year)
         AND denomination_text ~* ('^' || $3 || '([^0-9]|$)')`,
      [g.country, g.year, lead[0].replace(".", "[.]")])).rows;
    if (rows.some((x) => unitFits(g.unit, x.denomination_text))) {
      skip["тип есть"]++; skip["тип есть-лотов"] += g.n; continue;
    }
    want.push(g);
  }
  want.sort((a, b) => b.n - a.n);
  // Порог — решение о размене, поэтому показываем его цену: сколько сочетаний и сколько лотов
  // добавляет каждое значение. Иначе число берётся по аналогии, а не по данным.
  const tiers = [1, 2, 3, 4, 6, 10];
  console.log("\nразмен по порогу (сочетаний / лотов в них):");
  for (const t of tiers) {
    const w = want.filter((g) => g.n >= t);
    console.log(`  порог ${String(t).padStart(2)}: сочетаний ${String(w.length).padStart(5)} · лотов ${String(w.reduce((a, g) => a + g.n, 0)).padStart(6)}`);
  }
  const y19 = want.filter((g) => g.year >= 2019);
  console.log("не попало в спайн:", JSON.stringify(skip, null, 0));
  console.log("лоты с НАЗВАННЫМ сюжетом по эпохам:", JSON.stringify([...subjYears.entries()].sort()));
  console.log(`из них 2019 и позже: сочетаний ${y19.length} · лотов ${y19.reduce((a, g) => a + g.n, 0)}`);
  console.log(`сочетаний без типа, прошли порог ${MIN}: ${want.length}`);
  const chosen = want.filter((g) => g.n >= MIN);
  for (const g of chosen.slice(0, SHOW))
    console.log(`  ${(g.den + ". " + g.country + " " + g.year).padEnd(46)} лотов ${String(g.n).padStart(4)} · ${g.ex.replace(/\s+/g, " ").slice(0, 54)}`);
  if (chosen.length > SHOW) console.log(`  … ещё ${chosen.length - SHOW}`);

  let made = 0;
  for (const g of chosen) {
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
