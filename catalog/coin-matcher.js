/**
 * Общий матчер «лот → coin_type» для всех источников (meshok/auction.ru/wolmar) и ВСЕХ эр.
 * parseTitle(title) → атрибуты; matchType(pool, parsed) → {id, conf, era} | null (abstain).
 * Эра-роутинг по номиналу+году: имперское<1917 / СССР 1921-1991 / модерн-РФ≥1992 / foreign(нерублёвое|страна).
 * Тема/двор-дизамбигуация при мульти-кандидате; abstention если не различить (не угадываем — чтобы не засорять).
 */
const tc = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
// «коллекци» УБРАН: ловил зазывалку «в коллекцию!» на одиночках. Реальные коллекции ловят набор/подборка/N монет.
const SET = /набор|комплект|подборк|\bлот\b|\d+\s*монет|\d+\s*шт|перепутк|погодовк|альбом/i;
// НЕ монета: банкноты/боны/жетоны/медали/марки/прочее — отсекаем (маркетплейс мешает всё)
// ВАЖНО: голые «серия»/«номер» НЕ-банкнотный признак (монеты тоже в сериях) → убраны.
// Банкнота-серийник = две заглавные буквы + 6+ цифр (АА 1234567). PMG/PPQ — грейдинг БУМАГИ.
// +бумажные деньги/боны: казначейский/банковый/кредитный билет, ассигнация, «Образец» нот.
const NONCOIN = /банкнот|купюр|\bбон[аы]?\b|\bбоны\b|\bpmg\b|\bppq\b|пачка|облигаци|сертификат|жетон|медал[ьи]|значок|\bмарк[аи]\b|открытк|конверт|купон|лотере|акци[яи]\b|вексел|замещени|казначейск|ассигнаци|кредитный\s+билет|банковый\s+билет|билет\s+государственн|\bсер(?:ия|\.)?\s*[А-ЯЁ]{2}\s*№?\s*\d{6,}|спасская башня|ярославль 1000/i;
const MINT = /\b(СПБ|СПМ|СПМД|ММД|ЛМД|ЕМ|ВМ|КМ|ТМ|АМ|ИМ|БМ|СМ|ММ|МД)\b/g;
// Драг-сигнал в ОПИСАНИИ лота (продавец почти всегда называет металл/пруф — это цена монеты).
const PRECIOUS_SIG = /золот|сереб|платин|паллад|\bпруф\b|\bproof\b|инвестиц|унци|\bau\b|\bag\b|\bpt\b|\bpd\b/i;
// Драг-металл в ТИПЕ каталога (coin_type.metal = «золото 999/1000» / «серебро 925/1000» …).
const PRECIOUS_METAL = /золот|сереб|платин|паллад/i;
// Дизамбиг по металлу: нет драг-сигнала в описании → выкидываем драгоценных кандидатов (дешёвый тёзка ≠ золотой тип).
// Если все кандидаты драгоценные → вернётся пусто → abstain (лучше не сматчить, чем сесть на золото за ×400).
const filterMetal = (rows, precious) => precious ? rows : rows.filter((r) => !PRECIOUS_METAL.test(r.metal || ""));

const parseDenom = (t) => {
  const s = String(t || "").replace(/½/g, "0.5 ").replace(/¼/g, "0.25 ").replace(/¾/g, "0.75 ");
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(рубл[а-яё]*|копе[а-яё]*|евро|доллар[а-яё]*|центов?|пенс[а-яё]*|пенни|фунт[а-яё]*|тенге|гривен|гривн[а-яё]*|сум[а-яё]*|песо|юан[а-яё]*|лир[а-яё]*|динар[а-яё]*|дирхам[а-яё]*|драм[а-яё]*|манат[а-яё]*|франк[а-яё]*|сантим[а-яё]*|раппен[а-яё]*|крон[а-яё]*|эре|эйре|вон[а-яё]*|иен[а-яё]*|йен[а-яё]*|рупи[а-яё]*|реал[а-яё]*|шиллинг[а-яё]*|форинт[а-яё]*|злот[а-яё]*|грош[а-яё]*|стотинк[а-яё]*|бат[а-яё]*|лев[а-яё]*|пфенниг[а-яё]*|марок|марк[аи]|пиастр[а-яё]*|филс|эскудо|афгани)/i);
  if (m) {
    const unit = m[2].toLowerCase();
    return { num: parseFloat(m[1].replace(",", ".")), unit, value: /^копе/.test(unit) ? parseFloat(m[1]) / 100 : parseFloat(m[1]), isRf: /^(рубл|копе)/.test(unit) };
  }
  // fallback для ИНОСТРАННЫХ экзотических единиц (даласи/бутут/нгултрум/квача…): «<число> <слово>»,
  // исключая не-номинальные слова (год/вес/набор). value=null (неизвестна рублёвая привязка), isRf=false.
  const g = s.match(/(?:^|[^\wа-яё])(\d+(?:[.,]\d+)?)\s+([а-яё]{3,})/i);
  if (g) {
    const unit = g[2].toLowerCase();
    if (/^(год|лет|грамм|сохран|экземпл|штук|монет|рубл|копе|тысяч|миллион|часть|разн)/.test(unit)) return null;
    return { num: parseFloat(g[1].replace(",", ".")), unit, value: null, isRf: false, generic: true };
  }
  return null;
};
const STOP = new Set(["года", "год", "монета", "штук", "редкая", "оригинал", "слаб", "топ", "грейд", "аукцион", "рубля", "копеек", "редкость", "состояние"]);
const themeWords = (t) => [...new Set(String(t || "").toLowerCase().replace(/[^а-яёa-z0-9 ]/g, " ").split(/\s+/)
  .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)))];

function parseTitle(title) {
  const t = String(title || "");
  const denom = parseDenom(t);
  const ym = t.match(/\b(1[5-9]\d{2}|20[0-3]\d)\b/);
  const year = ym ? +ym[1] : null;
  const mints = [...new Set([...t.matchAll(MINT)].map((m) => m[1]))];
  const grade = (t.match(/\b(MS\s?7\d|MS\s?6\d|PF\s?7\d|PF\s?6\d|Proof|пруф|UNC|АНЦ|aUNC|AU|XF|VF|VG)\b/i) || [])[1] || null;
  return { title: t, denom, year, mints, grade, isSet: SET.test(t), isNonCoin: NONCOIN.test(t), precious: PRECIOUS_SIG.test(t), words: themeWords(t) };
}

// дизамбиг по словам темы: среди кандидатов выбрать с макс. совпадением; при мульти требовать overlap>0
function pickByTheme(rows, words, single = 0.65, themed = 0.8) {
  if (!rows.length) return null;
  if (rows.length === 1) return { id: rows[0].id, conf: single };
  let best = null, bs = 0;
  for (const r of rows) { const nf = (r.name_full || "").toLowerCase(); const sc = words.filter((w) => nf.includes(w)).length; if (sc > bs) { bs = sc; best = r; } }
  return best && bs > 0 ? { id: best.id, conf: themed } : null;   // мульти без темы → abstain
}

// ── Страна лота → страна каталога ───────────────────────────────────────────────
// Словарь numis_country_map и спайн coin_type пришли из разных источников и писали имена
// по-разному: «США» вело на «United States Of America», а типы лежат под «United States» —
// 984 типа были невидимы, и на этом одном расхождении терялось 5212 меш-лотов. Поэтому имя
// из словаря не подставляем в запрос как есть, а СВОДИМ с тем, как страна названа в каталоге.
const normCountry = (s) => String(s || "").toLowerCase().replace(/\b(of|the|and)\b/g, " ").replace(/[^a-z0-9]/g, "");
// Пары, которые нормализацией не сводятся — разные слова для одной страны.
const COUNTRY_ALIAS = {
  unitedstatesamerica: "unitedstates",
  greatbritain: "unitedkingdom",
  koreasouth: "southkorea",
  koreanorth: "northkorea",
};
// Исторические земли и территории, которых в словаре нет вовсе (в каталоге типы есть).
const RU_EXTRA = [
  ["Пруссия", "Prussia"], ["Бавария", "Bavaria"], ["Саксония", "Saxony"], ["Баден", "Baden"],
  ["Гессен-Дармштадт", "Hesse-Darmstadt"], ["Гессен", "Hesse"], ["Гамбург", "Hamburg"], ["Бремен", "Bremen"],
  ["Мекленбург-Шверин", "Mecklenburg-Schwerin"], ["Антильские острова", "Netherlands Antilles"],
];
// Заведомо неверные строки словаря: «Виргинские острова» вели на США. Уводим в имя, которого в
// каталоге нет: пусть лучше матчер воздержится, чем сядет на американский тип.
const RU_OVERRIDE = { "Виргинские острова": "Virgin Islands" };

let CMAP = null, CATC = null;
async function catalogCountry(pool, en) {
  if (!CATC) {
    CATC = new Map();
    const rows = (await pool.query("SELECT country, count(*)::int c FROM coin_type WHERE era='foreign' AND country IS NOT NULL GROUP BY 1")).rows;
    for (const r of rows) {                       // на коллизии ключа берём написание с бОльшим числом типов
      const k = normCountry(r.country);
      const cur = CATC.get(k);
      if (!cur || cur.c < r.c) CATC.set(k, r);
    }
  }
  const k = normCountry(en);
  const hit = CATC.get(COUNTRY_ALIAS[k] || k) || CATC.get(k);
  return hit ? hit.country : tc(en);             // нет такой страны в каталоге — вернём как есть (совпадений не будет)
}
async function countryEn(pool, title) {
  if (!CMAP) {
    const rows = (await pool.query("SELECT ru,en FROM numis_country_map WHERE en IS NOT NULL")).rows
      .map((r) => ({ ru: r.ru, en: RU_OVERRIDE[r.ru] || r.en }))
      .concat(RU_EXTRA.map(([ru, en]) => ({ ru, en })));
    CMAP = rows.sort((a, b) => b.ru.length - a.ru.length).map((r) => ({ ...r, ruLc: r.ru.toLowerCase() }));
  }
  const t = String(title || "").toLowerCase();    // заголовки на маркетплейсе часто КАПСОМ — сравниваем без регистра
  for (const r of CMAP) if (t.includes(r.ruLc)) return await catalogCountry(pool, r.en);
  return null;
}

async function matchType(pool, p) {
  if (p.isSet || p.isNonCoin || !p.denom || !p.year) return null;
  const d = p.denom;
  if (d.isRf) {
    if (d.value == null) return null;
    if (p.year < 1917) {                                  // ИМПЕРСКОЕ: двор-дизамбиг
      let rows = (await pool.query("SELECT id, name_full, metal FROM coin_type WHERE era='imperial' AND denomination_value=$1 AND year=$2", [d.value, p.year])).rows;
      rows = filterMetal(rows, p.precious);
      if (!rows.length) return null;
      if (rows.length === 1) return { id: rows[0].id, conf: 0.7, era: "imperial" };
      if (p.mints.length) { const f = rows.filter((r) => p.mints.some((mt) => (r.name_full || "").includes(mt))); if (f.length === 1) return { id: f[0].id, conf: 0.85, era: "imperial" }; if (f.length) rows.length = 0, rows.push(...f); }
      const r = pickByTheme(rows, p.words); return r ? { ...r, era: "imperial" } : null;
    }
    if (p.year <= 1991) {                                 // СССР: погодовка/памятные
      let rows = (await pool.query("SELECT id, name_full, metal FROM coin_type WHERE era='ussr' AND denomination_value=$1 AND year=$2", [d.value, p.year])).rows;
      rows = filterMetal(rows, p.precious);
      const r = pickByTheme(rows, p.words); return r ? { ...r, era: "ussr" } : null;
    }
    let rows = (await pool.query("SELECT id, name_full, metal FROM coin_type WHERE era IS NULL AND country='RU' AND denomination_value=$1 AND year=$2", [d.value, p.year])).rows;
    rows = filterMetal(rows, p.precious);
    const r = pickByTheme(rows, p.words); return r ? { ...r, era: "modern" } : null;
  }
  // FOREIGN: страна+год+ведущее число (единица м.б. экзотическая/неизвестная). Граница номинала —
  // «^<num>(не-цифра|конец)», чтобы «10» не ловило «100». Единицу НЕ сверяем (даласи/бутут… не в словаре).
  const cen = await countryEn(pool, p.title); if (!cen) return null;
  const denomRe = "^" + String(d.num).replace(".", "\\.") + "([^0-9]|$)";
  // Тип Краузе — это KM#, а не отдельный год: одна строка каталога покрывает весь период чеканки
  // (Пруссия KM#481 — 1861-1873), и в колонке year лежит только ПЕРВЫЙ год. Сверка по нему теряла
  // лоты всех остальных годов, а таких типов в спайне 10 тысяч. Ищем попадание года В ДИАПАЗОН,
  // а где диапазона нет — по-прежнему точное совпадение.
  let rows = (await pool.query(
    `SELECT id, name_full, metal FROM coin_type WHERE era='foreign' AND country=$1
       AND $2 BETWEEN COALESCE(year_start, year) AND COALESCE(year_end, year)
       AND denomination_text ~* $3`, [cen, p.year, denomRe])).rows;
  rows = filterMetal(rows, p.precious);
  const r = pickByTheme(rows, p.words); return r ? { ...r, era: "foreign" } : null;
}

module.exports = { parseTitle, matchType, parseDenom, themeWords };
