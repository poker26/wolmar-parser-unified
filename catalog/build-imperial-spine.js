/**
 * Недостающие тиражные типы имперской эры → coin_type (era='imperial').
 *
 * Имперский каталог собран из описаний проходов и из Биткина, а там монета почти всегда названа
 * ВМЕСТЕ с двором и разновидностью. Поэтому у части сочетаний номинал+год тиражного типа нет
 * вовсе: «1/2 копейки 1910», «1/4 копейки 1909», «Денежка 1853» — в каталоге эти номиналы
 * обрываются на 1899 годе, хотя лотов по ним тысячи. Лот, где двор не назван (а его часто не
 * называют — «монетный двор не определён»), повисал между дворовыми кандидатами.
 *
 * Тип создаётся БЕЗ двора намеренно: он отвечает на «монета такого номинала и года, двор
 * неизвестен». Лоты с названным двором по-прежнему уходят к дворовым типам — запасной ход
 * матчера срабатывает, только когда двор в заголовке не назван.
 *
 * Годы и написание номинала берутся из переписи лотов, а не из головы: «полушка», «денежка» и
 * «1/2 копейки» — одна и та же монета в разные эпохи, и называть тип надо так, как его называют
 * продавцы этого года.
 *
 *   node catalog/build-imperial-spine.js [--min N] [--apply]
 */
const { pool } = require("./db");
const { parseTitle } = require("./coin-matcher");

const Y0 = 1700, Y1 = 1917;
// Рублёвые значения имперских номиналов. Всё, что вне списка, — разбор ошибся (цена по
// справочнику, тираж, вес), и заводить под это тип нельзя.
const VALUES = [0.0025, 0.005, 0.01, 0.02, 0.03, 0.05, 0.1, 0.15, 0.2, 0.25, 0.5,
                1, 1.5, 2, 3, 5, 7.5, 10, 12, 15, 20, 25, 37.5];

(async () => {
  const apply = process.argv.includes("--apply");
  const mi = process.argv.indexOf("--min");
  const MIN = mi > -1 ? parseInt(process.argv[mi + 1], 10) : 10;
  const si = process.argv.indexOf("--show");
  const LIMIT = si > -1 ? parseInt(process.argv[si + 1], 10) : 40;

  const types = (await pool.query(
    `SELECT ROUND(denomination_value,6)::float8 v, year, mint, lower(coalesce(name_full,'')) n
       FROM coin_type WHERE era='imperial' AND denomination_value IS NOT NULL AND year IS NOT NULL`)).rows;
  const have = new Map();
  for (const r of types) {
    const k = `${r.v}|${r.year}`;
    if (!have.has(k)) have.set(k, { names: [], plain: 0 });
    have.get(k).names.push(r.n);
    // Тиражный тип — без двора и без уточнения после точки («2 копейки 1797 ЕМ» не тиражный).
    if (!r.mint && !/\.\s+\S/.test(r.n)) have.get(k).plain++;
  }
  console.log(`имперских типов с номиналом и годом: ${types.length} в ${have.size} сочетаниях`);

  const lots = (await pool.query(
    `SELECT a.coin_description cd FROM auction_lots a
       JOIN lot_kind k ON k.lot_id=a.id AND k.kind='coin'
       LEFT JOIN lot_type_link l ON l.lot_id=a.id
      WHERE l.lot_id IS NULL AND a.coin_description IS NOT NULL`)).rows;
  console.log(`сирот-монет к переписи: ${lots.length}`);

  const grid = new Map();
  for (const { cd } of lots) {
    const p = parseTitle(cd);
    if (p.isNonCoin || p.isSet || !p.denom || !p.denom.isRf || !p.year) continue;
    if (p.year < Y0 || p.year > Y1) continue;
    if (!VALUES.includes(p.denom.value)) continue;
    const k = `${p.denom.value}|${p.year}`;
    const h = have.get(k);
    if (h && h.plain) continue;                                   // тиражный тип уже есть
    const g = grid.get(k) || { v: p.denom.value, y: p.year, n: 0, ex: cd, forms: new Map() };
    // Написание номинала считаем по лотам: «денежка» и «1/2 копейки» — одна монета разных эпох.
    // Дробный номинал пишем так, как он напечатан («1/4 копейки»), а не долей единицы: raw хранит
    // исходную запись, а num — её значение, и «0.25 копейки» именем типа быть не может.
    const form = p.denom.named ? p.denom.unit : `${p.denom.raw || p.denom.num} ${p.denom.unit}`;
    g.forms.set(form, (g.forms.get(form) || 0) + 1);
    g.n++;
    grid.set(k, g);
  }

  const nameOf = (g) => [...g.forms.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const want = [...grid.values()].filter((g) => g.n >= MIN).sort((a, b) => a.v - b.v || a.y - b.y);
  console.log(`сочетаний без тиражного типа: ${grid.size}, прошли порог ${MIN}: ${want.length}`);
  for (const g of want.slice(0, LIMIT))
    console.log(`  ${(nameOf(g) + " " + g.y).padEnd(22)} лотов ${String(g.n).padStart(4)} · ${g.ex.replace(/\s+/g, " ").slice(0, 66)}`);
  if (want.length > LIMIT) console.log(`  … ещё ${want.length - LIMIT}`);

  let made = 0;
  for (const g of want) {
    const nm = nameOf(g);
    if (apply) {
      await pool.query(
        // Статус задаём ЯВНО: у колонки умолчание 'draft', а черновики матчер в общий имперский
        // отбор не берёт (это заготовки вариантов Биткина). Спайн — не заготовка.
        `INSERT INTO coin_type (source, country, era, name_full, theme_core, denomination_text,
                                denomination_value, year, type_key, theme_ru, status, created_at, updated_at)
         VALUES ('spine_imperial','RU','imperial',$1,'',$2,CAST($3 AS numeric),$4,$5,'тиражная монета','catalog',now(),now())
         ON CONFLICT (era, type_key) WHERE era IS NOT NULL DO NOTHING`,
        [`${nm} ${g.y}`, nm, g.v.toFixed(6), g.y, `${g.v}|${g.y}||spine_imperial`]);
    }
    made++;
  }
  console.log(`${apply ? "СОЗДАНО" : "К СОЗДАНИЮ"}: ${made}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
