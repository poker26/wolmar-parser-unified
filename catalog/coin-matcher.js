/**
 * Общий матчер «лот → coin_type» для всех источников (meshok/auction.ru/wolmar) и ВСЕХ эр.
 * parseTitle(title) → атрибуты; matchType(pool, parsed) → {id, conf, era} | null (abstain).
 * Эра-роутинг по номиналу+году: имперское<1917 / СССР 1921-1991 / модерн-РФ≥1992 / foreign(нерублёвое|страна).
 * Тема/двор-дизамбигуация при мульти-кандидате; abstention если не различить (не угадываем — чтобы не засорять).
 */
const tc = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
// «коллекци» УБРАН: ловил зазывалку «в коллекцию!» на одиночках. Реальные коллекции ловят набор/подборка/N монет.
const SET = /набор|комплект|подборк|(?<![а-яё])лот(?![а-яё])|\d+\s*монет|\d+\s*шт|перепутк|погодовк|альбом/i;
// НЕ монета: банкноты/боны/жетоны/медали/марки/прочее — отсекаем (маркетплейс мешает всё)
// ВАЖНО: голые «серия»/«номер» НЕ-банкнотный признак (монеты тоже в сериях) → убраны.
// Банкнота-серийник = две заглавные буквы + 6+ цифр (АА 1234567). PMG/PPQ — грейдинг БУМАГИ.
// +бумажные деньги/боны: казначейский/банковый/кредитный билет, ассигнация, «Образец» нот.
const HARD_NONCOIN = /банкнот|купюр|(?<![а-яё])бон[аы](?![а-яё])|(?<![а-яё])боны(?![а-яё])|\bpmg\b|\bppq\b|пачка|облигаци|казначейск|ассигнаци|кредитный\s+билет|банковый\s+билет|билет\s+государственн|сер(?:ия|\.)?\s*[А-ЯЁ]{2}\s*№?\s*\d{6,}|(?<![а-яё])бумага(?![а-яё])|(?<![а-яё])бумажн|(?:расч[её]тн|товарн|денежн)[а-яё]+ +ордер|потребительск|кооператив|товариществ[оа]|шорно|губернск[а-яё]+ +союз|копилк|сувенир|брелок|(?<![а-яё])магнит(?![а-яё])|расч[её]тн[а-яё]+ +знак|водян[а-яё]+ +знак|денежн[а-яё]+ +знак|платежн[а-яё]+ +обязательств|спасская башня|ярославль 1000/i;
// «Мягкие» признаки: эти вещи ходят В ПАРЕ с монетой («с сертификатом», «с 1 жетоном», «в
// футляре»), и раньше такой лот целиком объявлялся не-монетой. Заголовок называет главный
// предмет первым, поэтому мягкий признак учитываем только в его начале. «Марка» отдельно: с
// числом впереди это НОМИНАЛ («2 марки 1934. Германия»), а не почтовая марка.
const SOFT_NONCOIN = /жетон|медал[ьи]|значок|открытк|конверт|купон|лотере|акци[яи](?![а-яё])|вексел|замещени|(?<!\d\s?)(?<![а-яё])марк[аи](?![а-яё])/i;
const isNonCoin = (t) => HARD_NONCOIN.test(t) || SOFT_NONCOIN.test(String(t || "").slice(0, 42));
const MINT = /(?<![А-Яа-яЁё])(СПБ|СПМ|СПМД|ММД|ЛМД|ЕМ|ВМ|КМ|ТМ|АМ|ИМ|БМ|СМ|ММ|МД)(?![А-Яа-яЁё])/g;
// Драг-сигнал в ОПИСАНИИ лота (продавец почти всегда называет металл/пруф — это цена монеты).
const PRECIOUS_SIG = /золот|сереб|платин|паллад|\bпруф\b|\bproof\b|инвестиц|унци|\bau\b|\bag\b|\bpt\b|\bpd\b/i;
// Драг-металл в ТИПЕ каталога (coin_type.metal = «золото 999/1000» / «серебро 925/1000» …).
const PRECIOUS_METAL = /золот|сереб|платин|паллад/i;
// Дизамбиг по металлу: нет драг-сигнала в описании → выкидываем драгоценных кандидатов (дешёвый тёзка ≠ золотой тип).
// Если все кандидаты драгоценные → вернётся пусто → abstain (лучше не сматчить, чем сесть на золото за ×400).
const filterMetal = (rows, precious) => precious ? rows : rows.filter((r) => !PRECIOUS_METAL.test(r.metal || ""));

// Зазывалка стартовой ставки: «С 1 рубля», «Аукцион с 1 рубля», «от 1 руб.». Это НЕ номинал, но
// именно он попадался разбору первым и делал «Замбия 1 квача 2017 года. С 1 рубля» рублёвым лотом
// 1992+ — так в модерн-РФ утекали тысячи иностранных монет. Латинская «c» тоже встречается.
const BID_JARGON = /(?<![а-яёa-z])(?:[сc]|от)\s*\d*\s*руб(?:л[а-яё]*)?\.?(?![а-яёa-z])/gi;
// Оценка по справочнику («Петров - 1,25 рубля», «Ильин - 5 рублей») — тоже не номинал лота.
// Из-за неё «Полуполтинник 1770г. ММД ДМ. Ag. Петров - 1,25 рубля» уходил в рублёвые типы.
const REF_PRICE = /(петров|ильин|уздеников|конрос|биткин)[^|.;]{0,15}?\d+(?:[.,]\d+)?\s*руб[а-яё]*/gi;

// Словесные номиналы: до XX века их писали именно так, и это ЕДИНСТВЕННОЕ указание на номинал в
// заголовке — «Полуполтинник 1770г. ММД ДМ» цифры не содержит вовсе. Таких сирот 17,5 тысяч.
// Червонец сюда не берём намеренно: у него нет постоянного рублёвого значения.
const NAMED_RU = [
  [/(?<![а-яё])полушк[аи]?(?![а-яё])/i, 0.0025, "полушка"],
  [/(?<![а-яё])ден[ьг]?г[аи]?(?![а-яё])/i, 0.005, "денга"],
  [/(?<![а-яё])полуполтинник[а]?(?![а-яё])/i, 0.25, "полуполтинник"],
  [/(?<![а-яё])полтин(?:а|ы|ник[а]?)(?![а-яё])/i, 0.5, "полтина"],
  [/(?<![а-яё])гривенник[а]?(?![а-яё])/i, 0.1, "гривенник"],
  [/(?<![а-яё])пятиалтынн[ыо][йг][оа]?(?![а-яё])/i, 0.15, "пятиалтынный"],
  [/(?<![а-яё])двугривенн[ыо][йг][оа]?(?![а-яё])/i, 0.2, "двугривенный"],
  [/(?<![а-яё])алтын[а]?(?![а-яё])/i, 0.03, "алтын"],
  [/(?<![а-яё])пятак[аи]?(?![а-яё])/i, 0.05, "пятак"],
];

const parseDenom = (t) => {
  const s = String(t || "").replace(REF_PRICE, " ").replace(BID_JARGON, " ").replace(/½/g, "0.5 ").replace(/¼/g, "0.25 ").replace(/¾/g, "0.75 ");
  // Словесный номинал проверяем первым: если он назван, цифры в заголовке — это год, тираж или
  // ссылка на справочник, а не номинал.
  for (const [re, value, unit] of NAMED_RU) if (re.test(s)) return { num: value, unit, value, isRf: true, named: true };
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(рубл[а-яё]*|копе[а-яё]*|евро|доллар[а-яё]*|центов?|пенс[а-яё]*|пенни|фунт[а-яё]*|тенге|гривен|гривн[а-яё]*|сум[а-яё]*|песо|юан[а-яё]*|лир[а-яё]*|динар[а-яё]*|дирхам[а-яё]*|драм[а-яё]*|манат[а-яё]*|франк[а-яё]*|сантим[а-яё]*|раппен[а-яё]*|крон[а-яё]*|эре|эйре|вон[а-яё]*|иен[а-яё]*|йен[а-яё]*|рупи[а-яё]*|реал[а-яё]*|шиллинг[а-яё]*|форинт[а-яё]*|злот[а-яё]*|грош[а-яё]*|стотинк[а-яё]*|бат[а-яё]*|лев[а-яё]*|пфенниг[а-яё]*|марок|марк[аи]|пиастр[а-яё]*|филс|эскудо|афгани)/i);
  if (m) {
    const unit = m[2].toLowerCase();
    // Число берём ОДИН раз с заменой запятой: раньше value считался из сырой строки, и
    // parseFloat("1,25") обрывался на запятой — номинал 1,25 молча превращался в 1.
    const num = parseFloat(m[1].replace(",", "."));
    return { num, unit, value: /^копе/.test(unit) ? num / 100 : num, isRf: /^(рубл|копе)/.test(unit) };
  }
  // Дробные номиналы пишут и знаком, и словами: «1/2 доллара», «1/6 талера». Без этого первая
  // регулярка спотыкалась о косую черту, а запасная выхватывала знаменатель — «1/2 доллара»
  // превращалось в «2 доллара» и уводило матч на другой тип.
  const fr = s.match(/(\d+)\s*\/\s*(\d+)\s*([а-яё]{3,})/i);
  if (fr && +fr[2] !== 0) {
    const unit = fr[3].toLowerCase();
    if (!/^(год|лет|грамм|сохран|экземпл|штук|монет|тысяч|миллион|часть|разн)/.test(unit)) {
      const num = +fr[1] / +fr[2];
      return { num, unit, value: /^копе/.test(unit) ? num / 100 : num, isRf: /^(рубл|копе)/.test(unit), fraction: true };
    }
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
// Название денежной единицы темой не является, а раньше ею считалось — и это ломало сам принцип
// дизамбигуации: слово «рубль» есть в имени КАЖДОГО кандидата, поэтому совпадение находилось у
// всех сразу, и «1 рубль 1992 ММД» садился на первый попавшийся памятный тип с уверенностью 0.8.
const UNIT_WORD = /^(рубл|копе|доллар|цент|евро|франк|фунт|крон|песо|динар|дирхам|шиллинг|злот|гривн|тенге|юан|иен|йен|рупи|лир[аы]|драм|манат|форинт|эскудо|пенни|пенс|марок|пиастр|стотинк|сантим|раппен|афгани|монет|росси)/;
const themeWords = (t) => [...new Set(String(t || "").toLowerCase().replace(/[^а-яёa-z0-9 ]/g, " ").split(/\s+/)
  .filter((w) => w.length >= 4 && !STOP.has(w) && !UNIT_WORD.test(w) && !/^\d+$/.test(w)))];

// Дворы модерна пишут иначе, чем имперские: на рубле «ММД»/«СПМД», а на копейке одна буква
// «М»/«С-П». Разбираем отдельно от MINT — туда одиночную букву класть нельзя: имперская ветка
// сверяет двор ПОДСТРОКОЙ названия типа, и «М» совпала бы почти со всем.
const MOD_MINT = /(?<![А-Яа-яЁё])(СПМД|ММД|ЛМД|С-П|СП|М|Л)(?![А-Яа-яЁё])/g;
const MOD_CANON = { "М": "ММД", "ММД": "ММД", "Л": "ЛМД", "ЛМД": "ЛМД", "СП": "СПМД", "С-П": "СПМД", "СПМД": "СПМД" };
const modernMints = (t) => [...new Set([...String(t || "").matchAll(MOD_MINT)].map((m) => MOD_CANON[m[1]]).filter(Boolean))];

// Год чеканки — не обязательно первое четырёхзначное число в заголовке: у памятных монет впереди
// стоит историческая дата («3 рубля. Северный конвой. 1941-1945 гг. 1992г. ЛМД» — монета 1992-го,
// а разбор брал 1941). Приоритет: год с пометкой «г.»; затем год вне диапазона «1941-1945»; и
// только потом первое попавшееся число.
const YEAR = /(1[5-9]\d{2}|20[0-3]\d)/g;
function parseYear(t) {
  const s = String(t || "");
  const dated = s.match(/(1[5-9]\d{2}|20[0-3]\d)\s*(?:г\b|г\.|год)/i);
  if (dated) return +dated[1];
  const ranges = [...s.matchAll(/(1[5-9]\d{2}|20[0-3]\d)\s*[-–—]\s*(1[5-9]\d{2}|20[0-3]\d)/g)];
  const inRange = (y) => ranges.some((r) => y >= +r[1] && y <= +r[2]);
  const all = [...s.matchAll(YEAR)].map((m) => +m[1]);
  return all.find((y) => !inRange(y)) ?? all[0] ?? null;
}

function parseTitle(title) {
  const t = String(title || "");
  const denom = parseDenom(t);
  const year = parseYear(t);
  const mints = [...new Set([...t.matchAll(MINT)].map((m) => m[1]))];
  const grade = (t.match(/\b(MS\s?7\d|MS\s?6\d|PF\s?7\d|PF\s?6\d|Proof|пруф|UNC|АНЦ|aUNC|AU|XF|VF|VG)\b/i) || [])[1] || null;
  return { title: t, denom, year, mints, modMints: modernMints(t), grade, isSet: SET.test(t), isNonCoin: isNonCoin(t), precious: PRECIOUS_SIG.test(t), words: themeWords(t) };
}

// дизамбиг по словам темы: среди кандидатов выбрать с макс. совпадением; при мульти требовать overlap>0
// Ничью между одинаково подходящими типами решает число уже привязанных лотов: в каталоге есть
// дубли из разных источников («Полтина 1817 СПБ ПС» со 169 проходами и её же копия с одним), и
// произвольный выбор растаскивал проходы одной монеты по двум карточкам.
const better = (a, b) => (+b.links || 0) - (+a.links || 0) || a.id - b.id;
const topOf = (list) => list.slice().sort(better)[0];

function pickByTheme(rows, words, single = 0.65, themed = 0.8) {
  if (!rows.length) return null;
  if (rows.length === 1) return { id: rows[0].id, conf: single };
  let best = null, bs = 0;
  // Слова о состоянии и отсылки к справочникам из отбора убираем: у типов, собранных из описаний
  // wolmar, они попали в САМО НАЗВАНИЕ («20 копеек. Чеканный блеск. Легкая патина»), и лот
  // выбирал разновидность по слову «блеск» вместо тиражного типа.
  const th = words.filter((w) => !NON_THEME.test(w));
  // Сравниваем и с русским сюжетом: у типов из томов Краузе имя собрано по-английски
  // («3 REICHSMARK. GERMANY - Waldeck»), и русские слова заголовка лота с ним не пересекались.
  for (const r of rows) {
    const nf = ((r.name_full || "") + " " + (r.theme_ru || "")).toLowerCase();
    const sc = th.filter((w) => nf.includes(w)).length;
    if (sc > bs || (sc === bs && best && better(r, best) < 0)) { bs = sc; best = r; }
  }
  return best && bs > 0 ? { id: best.id, conf: themed } : null;   // мульти без темы → abstain
}

// Служебные слова заголовка: сохранность, металл, оформление, отсылки к справочникам. Годятся,
// чтобы отличить один памятный тип от другого, не годятся — они есть у всех подряд.
const NON_THEME = /^(исполнени|цветн|специальн|обычн|улучшенн|качеств|мельхиор|латун|стал[иья]|никел|биметалл|бронз|медно|серебр|золот|платин|паллад|проба|блеск|патина|сохран|состоян|отличн|прекрасн|слаб[еы]|оригинал|подлинн|тираж|монетн|двор[еа]?|биткин|уздеников|петров|ильин|конрос|редк|нечаст|немагнит|магнитн|гурт|штемпел|чекан|коллекц|аукцион|лоты|торг)/;

// Знаки на имперской монете — это двор И инициалы минцмейстера («ММД ДМ», «СПБ ЭБ», «СМ АИ»).
// В MINT инициалы не входят, поэтому «Полуполтинник 1770 ММД ДМ» и «…ММД EI» были неразличимы и
// лот садился на любой из них. Собираем из заголовка ВСЕ заглавные аббревиатуры и требуем, чтобы
// знаки типа целиком нашлись среди них. У заголовка, набранного капсом целиком, признак не
// работает — там заглавное всё, поэтому такие пропускаем.
const MARK = /(?<![А-ЯЁA-Za-zа-яё])[А-ЯЁA-Z]{1,3}(?![А-Яа-яЁёA-Za-z])/g;
function titleMarks(t) {
  const words = String(t || "").split(/\s+/).filter((w) => /[А-Яа-яЁёA-Za-z]/.test(w));
  const caps = words.filter((w) => w === w.toUpperCase()).length;
  if (!words.length || caps / words.length > 0.6) return null;      // капс — признак бесполезен
  return [...new Set([...String(t).matchAll(MARK)].map((m) => m[0].toUpperCase()))];
}
// Все знаки типа найдены в заголовке → счёт равен их числу; хотя бы один не найден → тип не наш.
function markScore(typeMint, marks) {
  const tk = String(typeMint || "").toUpperCase().split(/\s+/).filter(Boolean);
  if (!tk.length) return 0;
  return tk.every((x) => marks.includes(x)) ? tk.length : -1;
}

// Простой тип — тот, у кого в названии только номинал: «20 копеек». Разновидности несут описание
// после точки («20 копеек 1975. Ости колосьев…»).
const isPlain = (row) => !/\.\s+\S/.test(String(row.name_full || ""));

// Выбор кандидата с гейтом по металлу и двумя запасными ходами.
// Гейт нужен: без драг-сигнала в описании дешёвый тёзка не должен садиться на золотой тип.
// Но памятные монеты почти все серебряные, а продавец металл сплошь и рядом не пишет — тогда
// гейт убирал ВСЕХ кандидатов, хотя тема совпадала однозначно («3 рубля 1994 Суриков» при
// единственном кандидате «3 рубля. В.И. Суриков»). И отдельно: если тема не различает вовсе,
// а среди кандидатов ровно один простой тип, лот без признаков разновидности логично отдать ему —
// иначе вся ходячка остаётся сиротами.
function pickWithMetal(rows, p, single = 0.65, themed = 0.8, relax = false) {
  // relax — для имперской эры: там серебро и золото это норма, а не дорогой тёзка дешёвого типа,
  // и продавец металл часто не пишет («Полтина 1817 СПБ ПС»). Если гейт убрал ВСЕХ кандидатов,
  // предпочитать всё равно некого — выбираем из исходных.
  let gated = filterMetal(rows, p.precious);
  if (!gated.length && relax) gated = rows;
  const r = pickByTheme(gated, p.words, single, themed);
  if (!r && gated.length > 1) {
    const plain = gated.filter(isPlain);
    if (plain.length === 1) return { id: plain[0].id, conf: 0.6 };
    // Несколько одинаково простых — это дубли одного типа из разных источников: берём тот,
    // на котором уже висят проходы.
    if (plain.length > 1 && (+topOf(plain).links || 0) > 0) return { id: topOf(plain).id, conf: 0.6 };
  }
  if (r || p.precious || !p.words.length) return r;
  // Слова о состоянии, металле и оформлении темой не являются. Без этой оговорки запасной ход
  // ловил «(в специальном исполнении)» и сажал «25 рублей Сочи Факел» на памятного Галилея.
  const th = p.words.filter((w) => !NON_THEME.test(w));
  if (!th.length) return null;
  const hits = rows.filter((row) => {
    const nf = ((row.name_full || "") + " " + (row.theme_ru || "")).toLowerCase();
    return th.some((w) => nf.includes(w));
  });
  return hits.length === 1 ? { id: hits[0].id, conf: 0.7 } : null;
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
  // «Англия» в словаре не было вовсе, а это самое частое русское имя британских монет на маркетплейсе.
  ["Англия", "United Kingdom"], ["Великобритании", "United Kingdom"], ["Шотландия", "Scotland"],
  ["Малайя", "Malaya"], ["Британская Индия", "India-British"], ["Британской Индии", "India-British"],
  ["Остров Мэн", "Isle of Man"], ["Гибралтар", "Gibraltar"], ["Ниуэ", "Niue"], ["Острова Кука", "Cook Islands"],
];
// Заведомо неверные строки словаря: «Виргинские острова» вели на США. Уводим в имя, которого в
// каталоге нет: пусть лучше матчер воздержится, чем сядет на американский тип.
const RU_OVERRIDE = { "Виргинские острова": "Virgin Islands" };

// Русская единица лота → слово, которым Краузе печатает единичный номинал.
const EN_UNIT = [
  [/^доллар/, "DOLLAR"], [/^цент/, "CENT"], [/^пенни/, "PENNY"], [/^пенс/, "PENCE"],
  [/^фунт/, "POUND"], [/^шиллинг/, "SHILLING"], [/^крон/, "CROWN"], [/^марк|^марок/, "MARK"],
  [/^пфенниг/, "PFENNIG"], [/^талер/, "THALER"], [/^гульден/, "GULDEN"], [/^франк/, "FRANC"],
  [/^сантим/, "CENTIME"], [/^лир/, "LIRA"], [/^песо/, "PESO"], [/^песет/, "PESETA"],
  [/^реал/, "REAL"], [/^эскудо/, "ESCUDO"], [/^рупи/, "RUPEE"], [/^иен|^йен/, "YEN"],
  [/^вон/, "WON"], [/^юан/, "YUAN"], [/^злот/, "ZLOTY"], [/^форинт/, "FORINT"],
  [/^динар/, "DINAR"], [/^драхм/, "DRACHMA"], [/^эре/, "ORE"], [/^грош/, "GROSCHEN"],
  [/^дукат/, "DUCAT"], [/^соверен/, "SOVEREIGN"], [/^гривн|^гривен/, "HRYVNIA"], [/^лев/, "LEV"],
];
const enUnit = (u) => { for (const [re, en] of EN_UNIT) if (re.test(String(u || ""))) return en; return null; };

// Номинал в каталоге записан не только цифрой. Встречаются словесные числа («FIVE DOLLARS»),
// именованные монеты США («QUARTER», «DIME», «NICKEL») и запись со знаком доллара («$25»,
// «PLATINUM $10»). Собираем все допустимые написания для конкретного номинала лота.
const NUM_WORD = {
  1: "ONE", 2: "TWO", 3: "THREE", 4: "FOUR", 5: "FIVE", 6: "SIX", 7: "SEVEN", 8: "EIGHT",
  9: "NINE", 10: "TEN", 12: "TWELVE", 15: "FIFTEEN", 20: "TWENTY", 25: "TWENTY[- ]FIVE",
  50: "FIFTY", 100: "(ONE +)?HUNDRED", 0.5: "HALF", 0.25: "QUARTER",
};
// Народные имена монет США и Канады: «25 центов» в каталоге записаны как QUARTER, и наоборот.
const NAMED = [
  { unit: /^цент/, num: 25, re: "^QUARTER" }, { unit: /^доллар/, num: 0.25, re: "^QUARTER" },
  { unit: /^цент/, num: 10, re: "^DIME" }, { unit: /^цент/, num: 5, re: "^(HALF +DIME|NICKEL)" },
  { unit: /^цент/, num: 50, re: "^HALF +DOLLAR" }, { unit: /^доллар/, num: 0.5, re: "^HALF +DOLLAR" },
  { unit: /^цент/, num: 1, re: "^(ONE +)?(CENT|PENNY)" },
];
const sqlLit = (x) => "'" + String(x).replace(/'/g, "''") + "'";

function denomAlternatives(d) {
  const alts = ["denomination_text ~* $3"];                       // цифрой в начале — основной случай
  const numRe = String(d.num).replace(".", "\\.");
  alts.push(`denomination_text ~* ${sqlLit("[$]" + numRe + "([^0-9]|$)")}`);   // «$25», «PLATINUM $10»
  const en = enUnit(d.unit);
  const word = NUM_WORD[d.num];
  if (word && en) alts.push(`denomination_text ~* ${sqlLit("^" + word + "[ -]+" + en)}`);  // «FIVE DOLLARS»
  if (d.num === 1 && en) alts.push(`denomination_text ~* ${sqlLit("^(ONE +)?" + en + "S?( |$)")}`);
  for (const n of NAMED) if (n.num === d.num && n.unit.test(String(d.unit || ""))) alts.push(`denomination_text ~* ${sqlLit(n.re)}`);
  return alts;
}

// Русские имена стран, собранные ИЗ САМОГО КАТАЛОГА (таблица numis_country_ru): словарь
// numis_country_map знал 228 стран из 699, и «Великобритания» (1622 типа), «Китай» (1273),
// «Бавария» матчеру были неизвестны. Здесь имя сразу указывает на каталожное написание.
// Склонения режем по основе: «Германия»/«Германии» → «Германи».
const ruStem = (s) => {
  const t = String(s || "").toLowerCase().trim();
  const cut = t.replace(/[аяиыоеёуюйьъ]$/i, "");
  return cut.length >= 5 ? cut : t;
};
let CRU = null;
async function catalogRu(pool) {
  if (!CRU) {
    const rows = (await pool.query("SELECT country, ru FROM numis_country_ru WHERE ru IS NOT NULL")).rows;
    const list = [];
    for (const r of rows) {
      const vars = Array.isArray(r.ru) ? r.ru : [];
      for (const v of vars) {
        const stem = ruStem(v);
        if (stem.length >= 4) list.push({ stem, country: r.country });
      }
    }
    CRU = list.sort((a, b) => b.stem.length - a.stem.length);
  }
  return CRU;
}

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
  // Курируемый словарь молчит — пробуем имена, собранные из каталога (они уже в его написании).
  for (const r of await catalogRu(pool)) if (t.includes(r.stem)) return r.country;
  return null;
}

async function matchType(pool, p) {
  if (p.isSet || p.isNonCoin || !p.denom || !p.year) return null;
  const d = p.denom;
  if (d.isRf) {
    if (d.value == null) return null;
    if (p.year < 1917) {                                  // ИМПЕРСКОЕ: двор-дизамбиг
      const all = (await pool.query("SELECT id, name_full, metal, theme_ru, mint, (SELECT count(*)::int FROM lot_type_link l WHERE l.type_id=coin_type.id) links FROM coin_type WHERE era='imperial' AND ROUND(denomination_value,6)=ROUND(CAST($1 AS numeric),6) AND year=$2", [String(d.value), p.year])).rows;
      let rows = filterMetal(all, p.precious);
      if (rows.length === 1) return { id: rows[0].id, conf: 0.7, era: "imperial" };
      const marks = titleMarks(p.title);
      if (rows.length > 1 && marks) {
        const scored = rows.map((r) => [r, markScore(r.mint, marks)]).filter(([, sc]) => sc >= 0);
        const top = Math.max(0, ...scored.map(([, sc]) => sc));
        const f = scored.filter(([, sc]) => sc === top).map(([r]) => r);
        if (top > 0 && f.length === 1) return { id: f[0].id, conf: 0.85, era: "imperial" };
        if (f.length) rows = f;
      }
      const r = pickWithMetal(rows.length ? rows : all, p, 0.65, 0.8, true); return r ? { ...r, era: "imperial" } : null;
    }
    if (p.year <= 1991) {                                 // СССР: погодовка/памятные
      let rows = (await pool.query("SELECT id, name_full, metal, theme_ru, (SELECT count(*)::int FROM lot_type_link l WHERE l.type_id=coin_type.id) links FROM coin_type WHERE era='ussr' AND denomination_value=$1 AND year=$2", [d.value, p.year])).rows;
      // relax тот же, что в имперской ветке: серебро СССР (полтинник, рубль 1924, биллон 500-й)
      // это норма номинала, а не дорогой тёзка, и в заголовке металл называют не всегда.
      const r = pickWithMetal(rows, p, 0.65, 0.8, true); return r ? { ...r, era: "ussr" } : null;
    }
    let rows = (await pool.query("SELECT id, name_full, metal, theme_ru, mint, (SELECT count(*)::int FROM lot_type_link l WHERE l.type_id=coin_type.id) links FROM coin_type WHERE era IS NULL AND country='RU' AND denomination_value=$1 AND year=$2", [d.value, p.year])).rows;
    // Сначала тема, и только потом двор. Обратный порядок уже дал промах: у «25 рублей Сочи
    // Факел 2014 СПМД» отбор по двору оставил единственным кандидатом памятную монету Галилею,
    // и она была выбрана как безальтернативная. Двор решает лишь среди ТИРАЖНЫХ типов, где
    // различать больше нечем.
    let r = pickWithMetal(rows, p);
    if (!r) {
      const plain = rows.filter(isPlain);
      let byMint = p.modMints.length
        ? plain.filter((x) => p.modMints.includes(MOD_CANON[String(x.mint || "").trim()] || x.mint))
        : [];
      // Двор не назван — или назван, но отдельного типа под него нет (в спайн он не попал по
      // редкости): общий тиражный тип без двора подходит и в том, и в другом случае.
      if (!byMint.length) byMint = plain.filter((x) => !x.mint);
      if (byMint.length) r = { id: topOf(byMint).id, conf: 0.65 };
    }
    return r ? { ...r, era: "modern" } : null;
  }
  // ТЕРРИТОРИИ ИМПЕРИИ. Финляндия (пенни, марка, с 1864) и Царство Польское (грош, злотый,
  // с 1815) чеканили собственный номинал, но по коллекционерской традиции это русские монеты —
  // и в каталоге они лежат в имперской эре. Ищем их там по ТЕКСТУ номинала: рублёвого значения
  // у таких типов нет намеренно (1 пенни формально равен полушке и склеился бы с русским типом).
  // Германскую марку сюда пускать нельзя, поэтому требуем, чтобы страна лота не была распознана
  // как чужая: подходит только Финляндия, Польша, Россия или отсутствие страны в заголовке.
  const TERR_UNIT = /^(пенни|марк|грош|злот)/;
  if (p.year && p.year >= 1815 && p.year <= 1917 && TERR_UNIT.test(String(d.unit || ""))) {
    const cen = await countryEn(pool, p.title);
    if (!cen || /^(Finland|Poland|RU|Russia)$/.test(cen)) {
      const numStr = String(d.num).replace(".", "\.");
      let rows = (await pool.query(
        `SELECT id, name_full, metal, theme_ru FROM coin_type
         WHERE era='imperial' AND year=$1 AND denomination_text ~* $2`,
        [p.year, "^" + numStr + " *" + String(d.unit).slice(0, 4)])).rows;
      const r = pickWithMetal(rows, p);
      if (r) return { ...r, era: "imperial" };
    }
  }
  // FOREIGN: страна+год+ведущее число (единица м.б. экзотическая/неизвестная). Граница номинала —
  // «^<num>(не-цифра|конец)», чтобы «10» не ловило «100». Единицу НЕ сверяем (даласи/бутут… не в словаре).
  const cen = await countryEn(pool, p.title); if (!cen) return null;
  // Краузе печатает единичный номинал ОДНИМ СЛОВОМ: «DOLLAR», «CROWN», «THALER», «PENNY» —
  // без цифры. Таких типов в каталоге 16 430, и требование ведущего числа делало их невидимыми.
  // Поэтому для номинала «1» принимаем и запись без цифры; для остальных — как было.
  // Дробные типы («1/2 DOLLAR») исключаем, если сам лот не дробный, иначе «1 доллар» садится на половину.
  const denomRe = "^" + String(d.num).replace(".", "\\.") + "([^0-9]|$)";
  // ...но принимать ЛЮБУЮ бесцифровую запись нельзя: под «1» попадут разом DOLLAR, HALF DOLLAR и
  // TWENTY DOLLARS, кандидатов станет много и матчер воздержится. Поэтому сверяем ЕДИНИЦУ:
  // «1 доллар» ищет «DOLLAR»/«ONE DOLLAR», а не всё подряд.
  const denomCond = "(" + denomAlternatives(d).join(" OR ") + ")";
  const fracGuard = d.fraction ? "" : " AND denomination_text !~ '^[0-9]+ *[/] *[0-9]'";
  // Тип Краузе — это KM#, а не отдельный год: одна строка каталога покрывает весь период чеканки
  // (Пруссия KM#481 — 1861-1873), и в колонке year лежит только ПЕРВЫЙ год. Сверка по нему теряла
  // лоты всех остальных годов, а таких типов в спайне 10 тысяч. Ищем попадание года В ДИАПАЗОН,
  // а где диапазона нет — по-прежнему точное совпадение.
  let rows = (await pool.query(
    `SELECT id, name_full, metal, theme_ru FROM coin_type WHERE era='foreign' AND country=$1
       AND $2 BETWEEN COALESCE(year_start, year) AND COALESCE(year_end, year)
       AND ${denomCond}${fracGuard}`, [cen, p.year, denomRe])).rows;
  const r = pickWithMetal(rows, p); return r ? { ...r, era: "foreign" } : null;
}

module.exports = { parseTitle, matchType, parseDenom, themeWords, countryEn };
