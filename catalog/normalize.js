/**
 * Каталог монет — общая нормализация типов.
 * Используется И скрейпером скелета (fcoins), И матчером лотов.
 * ВАЖНО: JS \w НЕ матчит кириллицу — везде явные классы [а-яё].
 */

// Убрать ведущий номинал из имени/темы: «3 рубля. Псковский кремль» -> «Псковский кремль»
function stripNominal(name) {
  return String(name || "")
    .replace(/^\s*\d+(?:[.,]\d+)?\s*(рубл[а-яё]*|копе[а-яё]*)\.?\s*/i, "")
    .trim();
}

// Нормализованное ЯДРО темы — ключ сопоставления. Срезает спец/цветное исполнение,
// «Серия: …», скобочные квалификаторы, числовые HTML-entity, пунктуацию.
function core(theme) {
  return String(theme || "")
    .toLowerCase()
    .replace(/&#\d+;/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/в\s+(специальном|цветном)\s+исполнени[а-яё]*/g, " ")
    .replace(/сери[а-яё]*\s*:.*/g, " ")
    .replace(/[\s.,"«»'–—-]+/g, " ")
    .trim();
}

// Флаг «в специальном/цветном исполнении» (= цветной вариант = отдельный тип)
function specFlag(s) {
  return /в\s+(специальном|цветном)\s+исполнени/i.test(String(s || ""));
}

// Извлечь номинал (текст + числовое значение в рублях) из начала строки
function denomination(name) {
  const m = String(name || "").match(/^\s*(\d+(?:[.,]\d+)?)\s*(рубл[а-яё]*|копе[а-яё]*)/i);
  if (!m) return { text: null, value: null };
  const num = parseFloat(m[1].replace(",", "."));
  const isKop = /копе/i.test(m[2]);
  return { text: `${m[1]} ${m[2]}`, value: isKop ? num / 100 : num };
}

// Наборы/брак — не типы
function isExcluded(s) {
  return /набор|из \d+ монет|брак|неверная заготовка/i.test(String(s || ""));
}

// Составной ключ типа
function typeKey({ denomValue, year, mint, themeCore, spec }) {
  return [denomValue, year, mint || "?", themeCore, spec ? "S" : ""].join("|");
}

module.exports = { stripNominal, core, specFlag, denomination, isExcluded, typeKey };
