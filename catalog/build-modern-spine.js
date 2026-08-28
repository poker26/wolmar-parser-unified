/**
 * Спайн ходячки современной России (1992-1993 и с 1997) → coin_type.
 *
 * Зачем: в каталоге модерна лежат только памятные монеты ЦБ (1975 типов) — обиходных монет нет
 * НИ ОДНОЙ. Поэтому «10 копеек 2014 ММД» или «1 рубль 1997» не определялись вообще, хотя таких
 * лотов десятки тысяч. Пятак из обращения мало кто ставит в коллекцию, но узнавать его мы обязаны.
 *
 * Откуда берём годы и дворы: из САМИХ ЛОТОВ, а не из головы. Номиналы обиходного ряда известны
 * твёрдо и заданы списком, а вот годы чеканки по номиналам (1 копейка до 2009, 10 рублей с 2009,
 * рублёвый ряд с перерывом 2000-2004) угадывать нельзя — перепись по 400 тысячам проходов даёт их
 * точнее. Порог в 3 лота отсекает опечатки продавцов вроде «5 копеек 2029».
 *
 * Тип на каждый двор плюс базовый без двора: продавец двор указывает не всегда, и лот без буквы
 * должен садиться на тиражный тип, а не висеть между ММД и СПМД.
 *
 *   node catalog/build-modern-spine.js [--min N] [--apply]
 */
const { pool } = require("./db");
const { parseTitle } = require("./coin-matcher");

// Обиходный ряд. До деноминации (1992-1993) — рублёвый, после (с 1997) — копеечный и рублёвый.
const OLD = { years: [1992, 1993], values: [1, 5, 10, 20, 50, 100], mints: ["ММД", "ЛМД"] };
const NEW = { from: 1997, values: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10], mints: ["ММД", "СПМД"] };
// Десятирублёвая монета обихода появилась только в 2009 (сталь с латунным покрытием). Всё, что
// раньше, — биметаллические юбилейные, они уже есть в каталоге ЦБ со своими сюжетами.
const NOT_BEFORE = { 10: 2009 };

// Тиражную монету от юбилейной отделяем по каталогу ЦБ, а не по списку слов-исключений: список
// сразу же начал выбрасывать и тиражные лоты («5 копеек 2002 без букв монетного двора»). Лот
// считается юбилейным, если его слова пересеклись с сюжетом типа ЦБ того же номинала и года —
// «10 рублей 2002 Дербент» пересекается, «10 копеек 2014г. СПМД» нет.
const commemorative = (p, cbr) => {
  if (p.precious) return true;                       // драгоценный тираж — не обиход
  const names = cbr.get(`${p.denom.value}|${p.year}`);
  if (!names) return false;
  return names.some((n) => p.words.some((w) => n.includes(w)));
};
const NAME = (v) => (v < 1
  ? `${Math.round(v * 100)} ${[1].includes(Math.round(v * 100)) ? "копейка" : "копеек"}`
  : `${v} ${v === 1 ? "рубль" : v < 5 ? "рубля" : "рублей"}`);

(async () => {
  const apply = process.argv.includes("--apply");
  const mi = process.argv.indexOf("--min");
  const MIN = mi > -1 ? parseInt(process.argv[mi + 1], 10) : 3;

  // Сюжеты памятных монет ЦБ — по ним отсеиваем юбилейные лоты из переписи обихода.
  const cbr = new Map();
  for (const r of (await pool.query(
    `SELECT ROUND(denomination_value,6)::float8 v, year, lower(coalesce(name_full,'')) n
       FROM coin_type WHERE country='RU' AND era IS NULL AND source IS DISTINCT FROM 'spine_ru_modern'
        AND denomination_value IS NOT NULL AND year IS NOT NULL`)).rows) {
    const k = `${r.v}|${r.year}`;
    if (!cbr.has(k)) cbr.set(k, []);
    cbr.get(k).push(r.n);
  }
  console.log(`сюжетов ЦБ для отсева: ${[...cbr.values()].reduce((a, b) => a + b.length, 0)}`);

  const lots = (await pool.query(
    `SELECT coin_description cd FROM auction_lots
      WHERE coin_description IS NOT NULL AND coin_description ~ '(199[2-9]|20[0-2][0-9])'`)).rows;
  console.log(`лотов с годом 1992+: ${lots.length}`);

  // Перепись: сколько раз встречается номинал×год×двор среди обиходного ряда.
  const grid = new Map();
  for (const { cd } of lots) {
    const p = parseTitle(cd);
    if (p.isNonCoin || p.isSet || !p.denom || !p.denom.isRf || !p.year) continue;
    const v = p.denom.value;
    const set = p.year <= 1993 ? OLD : p.year >= NEW.from ? NEW : null;
    if (!set || !set.values.includes(v)) continue;
    if (set === OLD && !OLD.years.includes(p.year)) continue;
    if (NOT_BEFORE[v] && p.year >= NEW.from && p.year < NOT_BEFORE[v]) continue;
    const k = `${v}|${p.year}`;
    const g = grid.get(k) || { v, y: p.year, n: 0, tot: 0, mints: new Map() };
    g.tot++;
    grid.set(k, g);
    if (commemorative(p, cbr)) continue;
    g.n++;
    for (const m of p.modMints) if (set.mints.includes(m)) g.mints.set(m, (g.mints.get(m) || 0) + 1);
    grid.set(k, g);
  }

  // Доля тиражных лотов годом чеканки НЕ управляет: на wolmar юбилейные преобладают и в те годы,
  // когда обиход точно был («1 рубль 1997» — 48 тиражных против 522 всего, «5 рублей 1992» — 68 из
  // 236). Порог по доле выбрасывал такие годы, поэтому решает абсолютный счёт, а доля печатается
  // рядом для проверки глазами. Цена ошибки несимметрична: лишний тип ловит лоты, которые иначе
  // висят сиротами, а пропущенный год оставляет их без определения вовсе.
  const want = [];
  for (const g of [...grid.values()].sort((a, b) => a.v - b.v || a.y - b.y)) {
    if (g.n < MIN) continue;
    want.push({ v: g.v, y: g.y, mint: null, n: g.n });
    for (const [m, n] of g.mints) if (n >= MIN) want.push({ v: g.v, y: g.y, mint: m, n });
  }
  console.log(`перепись: сочетаний номинал×год ${grid.size}, прошли порог ${MIN} — типов к созданию ${want.length}`);
  for (const v of [...new Set(want.map((w) => w.v))].sort((a, b) => a - b)) {
    const ys = [...grid.values()].filter((g) => g.v === v && g.n >= MIN).sort((a, b) => a.y - b.y);
    console.log(`  ${NAME(v).padEnd(12)} · ${ys.map((g) => `${g.y}:${g.n}/${g.tot}`).join(" ")}`);
  }

  let made = 0, had = 0;
  for (const w of want) {
    const key = `${w.v}|${w.y}|${w.mint || ""}||spine`;
    const name = NAME(w.v) + (w.mint ? ` ${w.mint}` : "");
    const r = await pool.query(
      `SELECT id FROM coin_type WHERE type_key=$1 OR (country='RU' AND era IS NULL AND name_full=$2
         AND year=$3 AND ROUND(denomination_value,6)=CAST($4 AS numeric))`,
      [key, name, w.y, w.v.toFixed(6)]);
    if (r.rows.length) { had++; continue; }
    if (apply) {
      await pool.query(
        `INSERT INTO coin_type (source, country, era, name_full, theme_core, denomination_text,
                                denomination_value, year, mint, type_key, theme_ru, created_at, updated_at)
         VALUES ('spine_ru_modern','RU',NULL,$1,'',$2,CAST($3 AS numeric),$4,$5,$6,'обиходная монета',now(),now())`,
        [name, NAME(w.v), w.v.toFixed(6), w.y, w.mint, key]);
    }
    made++;
  }
  console.log(`${apply ? "СОЗДАНО" : "К СОЗДАНИЮ"}: ${made} · уже было ${had}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
