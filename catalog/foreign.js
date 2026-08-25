/**
 * Каталог монет — ИНОСТРАННЫЕ. Парсер + нормализатор страны/эмитента.
 * Грамматика: «<номинал> <валюта>. <Страна>[. <Эмитент|Тема>] <год>г. <Металл>. | заметки»
 * Само-сборка типов из проходов (нет внешнего референса). Страна — главный разделитель;
 * субэмитенты (Германия.Пруссия) — ОТДЕЛЬНЫЕ типы, country=верхний уровень для группировки.
 * Неизвестная страна/тема → abstain (НЕ выдумывать). Копии/подделки/брак/батчи → excluded.
 *
 * countrySet и substateSet строятся ИЗ ДАННЫХ в build/measure и передаются в parse().
 * ВАЖНО: JS \b и \w НЕ работают с кириллицей — используем lookaround по [а-яё] явно.
 */

const METALS = ["Ag", "Au", "Pt", "Pd", "Cu-Ni", "Cu-Zn", "Al-Br", "Al-Bronze", "Cu", "Ni", "Br", "Bm", "Bi", "Al", "Fe", "Zn", "Sn", "Pb", "St", "Mel", "Bil", "Sb", "Met", "Lt"];
const METAL_ALT = METALS.join("|");
const METAL_RE = new RegExp(`(?<![A-Za-z])(${METAL_ALT})(?![A-Za-z])`, "i");
const YEAR_RE = /\b(1[5-9]\d\d|20\d\d)\b/;

// кириллице-безопасная граница слова
const cyrB = (alt) => new RegExp(`(?<![а-яёa-zА-ЯЁA-Z])(${alt})(?![а-яёa-zА-ЯЁA-Z])`, "ig");

// Алиасы/OCR/синонимы → канон (ключи lower, ё→е нормализованы при поиске).
const ALIASES = {
  "тайланд": "Таиланд", "юар": "Южная Африка",
  "оаэ": "Объединённые Арабские Эмираты", "объединенные арабские эмираты": "Объединённые Арабские Эмираты",
  "стрейтс-сетлментс": "Стрейтс-Сеттлментс", "стрейтс сетлментс": "Стрейтс-Сеттлментс", "стрейтс сеттлментс": "Стрейтс-Сеттлментс",
  "вликобритания": "Великобритания", "велибритания": "Великобритания",
  "поргугалия": "Португалия", "франия": "Франция", "камбожда": "Камбоджа",
  "преднистровье": "Приднестровье", "нидерланады": "Нидерланды", "нидерладская индия": "Нидерландская Индия",
  "филлипины": "Филиппины", "шри ланка": "Шри-Ланка", "багамы": "Багамские острова",
  "бермуды": "Бермудские острова", "олдерней": "Олдерни", "бирма": "Мьянма",
  "альбания": "Албания", "родезия и ньясаленд": "Родезия и Ньясленд",
  "француский индокитай": "Французский Индокитай",
  "папуа - новая гвинея": "Папуа-Новая Гвинея", "папуа новая гвинея": "Папуа-Новая Гвинея",
};

// Голые субэмитенты без страны → родитель (для случаев типа «Пруссия» в одиночку).
const SUBSTATE_PARENT = {
  "пруссия": "Германия", "бавария": "Германия", "саксония": "Германия", "баден": "Германия",
  "вюртемберг": "Германия", "ганновер": "Германия", "гамбург": "Германия", "бремен": "Германия",
  "любек": "Германия", "франкфурт": "Германия", "франкфурт-на-майне": "Германия", "нассау": "Германия",
  "бранденбург": "Германия", "силезия": "Германия", "майнц": "Германия", "брауншвейг": "Германия",
  "вестфалия": "Германия", "данциг": "Германия", "веймар": "Германия", "байройт": "Германия",
  "тироль": "Австрия", "зальцбург": "Австрия",
  "сицилия": "Италия", "неаполь": "Италия", "тоскана": "Италия", "ломбардия": "Италия",
  "парма": "Италия", "сардиния": "Италия", "венеция": "Италия", "милан": "Италия", "генуя": "Италия",
  "рига": "Речь Посполитая", "вильно": "Речь Посполитая", "краков": "Речь Посполитая",
};

// Квалификаторы-нестраны (срезать из позиции эмитента). Кириллице-безопасно.
const STRIP_QUAL = cyrB("рестрайк|перечекан|топ[\\s-]?грейд|токен|нотгельд|викариатный|викариатная|запайк[а-яё]*|проба|реставрац[а-яё]*|щитов[а-яё]*|отверстие|гетто|новодел[а-яё]*");
// Отделка/заметки (не место и не металл) — тоже не эмитент.
const FINISH_RE = cyrB("серебрен[а-яё]*|серебрён[а-яё]*|позолот[а-яё]*|золочен[а-яё]*|чернен[а-яё]*|чернён[а-яё]*|оксидиров[а-яё]*|патин[а-яё]*|эмаль|серебрение");
// Маркеры НЕ-подлинной монеты → исключить лот.
const EXCLUDE_RE = cyrB("копи[яйи]|подделк[а-яё]*|фантазийн[а-яё]*|не оригинальн[а-яё]*|брак");
// Батч (сборный лот).
const BATCH_RE = /подборк|набор|\d+\s*шт|лот из|комплект|из \d+ монет/i;

const collapse = (s) => String(s || "").replace(/\s+/g, " ").trim();
const stripEdge = (s) => collapse(s).replace(/^[.,\s\-|]+/, "").replace(/[.,\s\-|]+$/, "").trim();
const yo = (s) => String(s || "").toLowerCase().replace(/ё/g, "е");
const isPlaceLike = (s) => /[а-яё]/i.test(s) && !METAL_RE.test(s) && !/\d/.test(s);
// эмитент-субгосударство: place-like И >=3 букв (отсекает буквы двора «А», «КВ», «G»)
const letters = (s) => String(s || "").replace(/[^а-яёa-z]/gi, "").length;
const isIssuerLike = (s) => isPlaceLike(s) && letters(s) >= 3;

function normToken(raw) {
  let s = stripEdge(raw).replace(/\s*-\s*/g, "-");
  if (!s) return null;
  const k = yo(s);
  if (ALIASES[k]) return ALIASES[k];
  return s;
}
// ключ для членства в множествах: lower + ё→е
const setKey = (s) => yo(normToken(s) || "");

function parse(desc, countrySet, substateSet) {
  let d0 = collapse(desc);
  if (!d0) return null;
  if (BATCH_RE.test(d0)) return { excluded: true, reason: "batch" };
  if (EXCLUDE_RE.test(d0)) { EXCLUDE_RE.lastIndex = 0; return { excluded: true, reason: "fake" }; }
  EXCLUDE_RE.lastIndex = 0;

  const ym = d0.match(YEAR_RE); const year = ym ? Number(ym[1]) : null;
  const mm = d0.match(METAL_RE); const metal = mm ? mm[1] : null;

  const head = d0.split("|")[0].trim(); // факты монеты — до заметок
  const segs = head.split(". ").map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2) return { excluded: false, reason: "no-segments", year, metal };

  // номинал
  const denomRaw = segs[0];
  let denomValue = null, unit = null;
  const dm = denomRaw.match(/^\s*(\d+(?:\s+\d+)?(?:[.,/]\d+)?)\s*(.+?)\s*$/);
  if (dm) { denomValue = dm[1].replace(",", "."); unit = collapse(dm[2]); } else { unit = collapse(denomRaw); }

  // сегменты-кандидаты после номинала: срезать год/металл/квалификаторы/отделку
  const rest = segs.slice(1).map((s) => {
    let t = s.replace(STRIP_QUAL, " ").replace(FINISH_RE, " ");
    STRIP_QUAL.lastIndex = 0; FINISH_RE.lastIndex = 0;
    t = t.replace(/\s*(1[5-9]\d\d|20\d\d).*$/, "");
    t = t.replace(new RegExp(`(?<![A-Za-z])(${METAL_ALT})(?![A-Za-z]).*$`, "i"), "");
    return stripEdge(t);
  });

  // страна-якорь
  let parent = null, parentIdx = -1;
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i]) continue;
    if (countrySet.has(setKey(rest[i]))) { parent = normToken(rest[i]); parentIdx = i; break; }
  }

  let issuer = null;
  if (parent) {
    for (const j of [parentIdx + 1, parentIdx - 1]) {
      if (j < 0 || j >= rest.length || j === parentIdx) continue;
      const seg = rest[j];
      if (!seg || !isIssuerLike(seg)) continue;
      if (countrySet.has(setKey(seg))) continue;       // вторая страна — не эмитент
      if (substateSet && !substateSet.has(setKey(seg))) continue; // только известные субгосударства
      issuer = normToken(seg); break;
    }
  } else {
    for (const seg of rest) {
      const p = SUBSTATE_PARENT[setKey(seg)];
      if (p) { parent = p; issuer = normToken(seg); break; }
    }
  }

  // ТЕМА/сюжет памятной монеты = описательный сегмент после страны, НЕ субгосударство и НЕ страна
  // (напр. «Золотой век открытий - Австралия», «Еврейское гетто»). Берём самый длинный такой.
  let theme = null;
  if (parent) {
    for (let j = 0; j < rest.length; j++) {
      if (j === parentIdx) continue;
      const seg = rest[j];
      if (!seg) continue;
      const k = setKey(seg);
      if (countrySet.has(k)) continue;
      if (substateSet && substateSet.has(k)) continue;   // это эмитент, не тема
      if (SUBSTATE_PARENT[k]) continue;
      if (letters(seg) >= 4) { if (!theme || seg.length > theme.length) theme = normToken(seg); }
    }
  }

  if (!parent) return { excluded: false, reason: "no-country", year, metal, raw1: rest.find(Boolean) || null };
  return { excluded: false, denom: denomRaw, denomValue, unit, country: parent, issuer: issuer || null, theme: theme || null, year, metal };
}

// ── общая деривация множеств страна/субгосударство из данных (для build и measure) ──
const DEFAULT_STOPLIST = new Set(["африка", "европа", "азия", "америка", "топ-грейд", "топ грейд", "бронтозавр", "банковский токен", "зомбобык"]);

function cleanSeg(s) {
  let t = String(s || "").replace(STRIP_QUAL, " ").replace(FINISH_RE, " ");
  STRIP_QUAL.lastIndex = 0; FINISH_RE.lastIndex = 0;
  t = t.replace(/\s*(1[5-9]\d\d|20\d\d).*$/, "");
  t = t.replace(new RegExp(`(?<![A-Za-z])(${METAL_ALT})(?![A-Za-z]).*$`, "i"), "");
  return stripEdge(t);
}
function restOf(desc) {
  const head = collapse(desc).split("|")[0];
  const segs = head.split(". ").map((s) => s.trim()).filter(Boolean);
  return segs.slice(1).map(cleanSeg);
}
function isLive(d) {
  if (BATCH_RE.test(d)) return false;
  const f = EXCLUDE_RE.test(d); EXCLUDE_RE.lastIndex = 0;
  return !f;
}
function deriveSets(descs, opts = {}) {
  const thresh = opts.thresh || 2;
  const stoplist = opts.stoplist || DEFAULT_STOPLIST;
  const live = descs.filter(isLive);
  // PASS A: страновой якорь
  const cf = new Map();
  for (const d of live) {
    const rest = restOf(d);
    const cand = rest.find((x) => x && isPlaceLike(x) && !stoplist.has(setKey(x)) && !SUBSTATE_PARENT[setKey(x)]);
    if (cand) cf.set(setKey(cand), (cf.get(setKey(cand)) || 0) + 1);
  }
  const countrySet = new Set([...cf.entries()].filter(([, n]) => n >= thresh).map(([k]) => k));
  // PASS B: словарь субгосударств (сосед страны)
  const sf = new Map();
  for (const d of live) {
    const rest = restOf(d);
    let pi = -1; for (let i = 0; i < rest.length; i++) if (rest[i] && countrySet.has(setKey(rest[i]))) { pi = i; break; }
    if (pi < 0) continue;
    for (const j of [pi + 1, pi - 1]) {
      if (j < 0 || j >= rest.length || j === pi) continue;
      const seg = rest[j];
      if (seg && isIssuerLike(seg) && !countrySet.has(setKey(seg)) && !stoplist.has(setKey(seg))) sf.set(setKey(seg), (sf.get(setKey(seg)) || 0) + 1);
    }
  }
  const substateSet = new Set([...sf.entries()].filter(([, n]) => n >= 2).map(([k]) => k));
  return { countrySet, substateSet };
}

module.exports = { parse, deriveSets, restOf, cleanSeg, isLive, normToken, setKey, isPlaceLike, isIssuerLike, letters, yo, ALIASES, SUBSTATE_PARENT, DEFAULT_STOPLIST, EXCLUDE_RE, BATCH_RE, FINISH_RE, STRIP_QUAL, METALS, METAL_RE };
