/**
 * Недостающие тиражные типы СССР → coin_type (era='ussr').
 *
 * Каталог СССР собран из погодовки fcoins и покрывает только медно-никелевый ряд: серебра в нём
 * нет вовсе — ни полтинника 1924-1927, ни рубля 1924, хотя одних полтинников в проходах больше
 * шести тысяч. Кроме того у части сочетаний номинал+год есть только РАЗНОВИДНОСТИ («20 копеек
 * 1931. Средний луч…») и нет тиражного типа, поэтому обычный лот повисал между ними.
 *
 * Годы, как и в спайне модерна, берём из переписи лотов, а не из головы. Юбилейные лоты
 * вычитаются сверкой с названиями уже имеющихся типов того же номинала и года.
 *
 *   node catalog/build-ussr-spine.js [--min N] [--apply]
 */
const { pool } = require("./db");
const { parseTitle } = require("./coin-matcher");

const VALUES = [0.01, 0.02, 0.03, 0.05, 0.1, 0.15, 0.2, 0.5, 1];
// Шпицбергенские боны «Арктикугля» номинированы в копейках и по разбору неотличимы от монет
// СССР, но выпускал их трест, а не государство: в спайн государственного чекана они не идут.
const NOT_USSR = /шпицберген|арктикугол/i;
const Y0 = 1921, Y1 = 1991;
const NAME = (v) => (v < 1 ? `${Math.round(v * 100)} ${Math.round(v * 100) === 1 ? "копейка" : "копеек"}` : "1 рубль");
// Серебро называем: без металла гейт матчера пропускал бы дорогие лоты к дешёвым типам, а с ним
// карточка сразу показывает пробу. 10-20 копеек — биллон 500-й, полтинник и рубль — 900-я.
// 1931-й НЕ трогаем: в этом году один и тот же номинал чеканили и серебром, и никелем, металл у
// типа один быть не может — а названный ошибочно он хуже неназванного, гейт отбрасывал никелевые
// лоты («20 копеек 1931г. Ni.») от серебряного типа.
const METAL = (v, y) => (y <= 1930 && v >= 0.1 && v <= 0.2 ? "серебро 500/1000"
  : (v === 0.5 || v === 1) && y <= 1927 ? "серебро 900/1000" : null);

(async () => {
  const apply = process.argv.includes("--apply");
  const mi = process.argv.indexOf("--min");
  const MIN = mi > -1 ? parseInt(process.argv[mi + 1], 10) : 10;

  const types = (await pool.query(
    `SELECT ROUND(denomination_value,6)::float8 v, year, lower(coalesce(name_full,'')) n
       FROM coin_type WHERE era='ussr' AND denomination_value IS NOT NULL AND year IS NOT NULL`)).rows;
  const have = new Map();
  for (const r of types) {
    const k = `${r.v}|${r.year}`;
    if (!have.has(k)) have.set(k, { names: [], plain: 0 });
    have.get(k).names.push(r.n);
    if (!/\.\s+\S/.test(r.n)) have.get(k).plain++;
  }
  console.log(`типов СССР с номиналом и годом: ${types.length} в ${have.size} сочетаниях`);

  const lots = (await pool.query(
    `SELECT a.coin_description cd FROM auction_lots a LEFT JOIN lot_type_link l ON l.lot_id=a.id
      WHERE l.lot_id IS NULL AND a.coin_description IS NOT NULL AND a.coin_description ~ '19[2-9][0-9]'`)).rows;

  const grid = new Map();
  for (const { cd } of lots) {
    const p = parseTitle(cd);
    if (p.isNonCoin || p.isSet || !p.denom || !p.denom.isRf || !p.year) continue;
    if (p.year < Y0 || p.year > Y1 || !VALUES.includes(p.denom.value)) continue;
    if (NOT_USSR.test(cd)) continue;
    const k = `${p.denom.value}|${p.year}`;
    const h = have.get(k);
    if (h && h.plain) continue;                                   // тиражный тип уже есть
    if (h && h.names.some((n) => p.words.some((w) => n.includes(w)))) continue;   // лот про разновидность
    const g = grid.get(k) || { v: p.denom.value, y: p.year, n: 0, ex: cd };
    g.n++;
    grid.set(k, g);
  }

  const want = [...grid.values()].filter((g) => g.n >= MIN).sort((a, b) => a.v - b.v || a.y - b.y);
  console.log(`сочетаний без тиражного типа: ${grid.size}, прошли порог ${MIN}: ${want.length}`);
  for (const g of want)
    console.log(`  ${(NAME(g.v) + " " + g.y).padEnd(18)} лотов ${String(g.n).padStart(4)} · ${g.ex.replace(/\s+/g, " ").slice(0, 74)}`);

  let made = 0;
  for (const g of want) {
    if (apply) {
      await pool.query(
        `INSERT INTO coin_type (source, country, era, name_full, theme_core, denomination_text,
                                denomination_value, year, type_key, metal, theme_ru, created_at, updated_at)
         VALUES ('spine_ussr','RU','ussr',$1,'',$2,CAST($3 AS numeric),$4,$5,$6,'тиражная монета',now(),now())`,
        [`${NAME(g.v)} ${g.y}`, NAME(g.v), g.v.toFixed(6), g.y, `${g.v}|${g.y}||spine_ussr`, METAL(g.v, g.y)]);
    }
    made++;
  }
  console.log(`${apply ? "СОЗДАНО" : "К СОЗДАНИЮ"}: ${made}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
