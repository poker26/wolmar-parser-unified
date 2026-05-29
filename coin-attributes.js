/**
 * Извлечение нумизматических атрибутов из текстового описания лота:
 *   - fineness         проба (целое, 0..1000), напр. 900, 585, 925
 *   - grossWeight      нормативный / физический вес монеты или изделия, грамм
 *   - pureMetalWeight  вес чистого металла, грамм (для расчёта стоимости металла)
 *
 * Логика общая для офлайн-бэкфилла (backfill-coin-attributes.js) и для
 * live-парсера (wolmar-parser5.js) — чтобы данные больше не «дрейфовали».
 *
 * В описаниях Wolmar встречаются форматы:
 *   "Нормативная проба - Au`900, нормативный вес - 8,60 гр, чистого золота - 7,74 гр"
 *   "10 рублей 1903г. АР. Au 8,59."            (Au 8,59 = нормативный/брутто вес)
 *   "Золото 585 пробы. Вес - 3,1 гр."          (ювелирка)
 *   "Серебро 925 пробы. Вес - 20,8 гр."
 *   "925 проба."
 */

const METAL_GENITIVE = {
    Au: 'золот',   // золота / золото
    Ag: 'серебр',  // серебра / серебро
    Pt: 'платин',  // платины / платина
    Pd: 'паллад'   // палладия / палладий
};

function toNum(s) {
    return parseFloat(String(s).replace(',', '.'));
}

function valid(n, lo, hi) {
    return Number.isFinite(n) && n >= lo && n <= hi;
}

/** Проба (целое 300..1000). */
function extractFineness(description, metal) {
    if (!description) return null;
    const patterns = [
        // "Au`900", "Ag`925" — нормативная проба монет
        new RegExp(`(?:Au|Ag|Pt|Pd)\\s*[\`'’]\\s*(\\d{3})`, 'i'),
        // "585 пробы", "925 проба"
        /(\d{3})\s*проб/i,
        // "проба - 900", "проба Au 900", "пробы 585"
        /проб[аы]?\s*[-:]?\s*(?:Au|Ag|Pt|Pd)?\s*[\`'’]?\s*(\d{3})/i
    ];
    for (const p of patterns) {
        const m = description.match(p);
        if (m) {
            const n = parseInt(m[1], 10);
            if (valid(n, 300, 1000)) return n;
        }
    }
    return null;
}

/** Брутто-вес (нормативный / физический), грамм. */
function extractGrossWeight(description, metal) {
    if (!description) return null;
    const patterns = [
        // "нормативный вес - 8,60 гр"
        /нормативн\w*\s+вес\s*[-:]?\s*(\d+[.,]\d+)/i,
        // "Общий вес - 1,04 гр", "Вес - 3,1 гр", "масса - 12,5 гр"
        /(?:общий\s+)?(?:вес|масса)\s*[-:]?\s*(\d+[.,]\d+)\s*(?:г|гр|грамм)/i
    ];
    // "Au 8,59" — символ металла + число (брутто), только для металла лота
    if (metal && METAL_GENITIVE[metal]) {
        patterns.push(new RegExp(`\\b${metal}\\s+(\\d+[.,]\\d+)`, 'i'));
    }
    for (const p of patterns) {
        const m = description.match(p);
        if (m) {
            const n = toNum(m[1]);
            if (valid(n, 0.05, 100000)) return n;
        }
    }
    return null;
}

/** Вес чистого металла, грамм (из явного "чистого золота - X"). */
function extractPureWeight(description, metal) {
    if (!description || !metal || !METAL_GENITIVE[metal]) return null;
    const gen = METAL_GENITIVE[metal];
    const patterns = [
        // "чистого золота - 7,74 гр", "чистого серебра 12,5гр"
        new RegExp(`чистого\\s+${gen}\\w*\\s*[-:]?\\s*(\\d+[.,]\\d+)`, 'i'),
        // "7,74 гр чистого золота"
        new RegExp(`(\\d+[.,]\\d+)\\s*(?:г|гр|грамм)\\s+чистого\\s+${gen}`, 'i')
    ];
    for (const p of patterns) {
        const m = description.match(p);
        if (m) {
            const n = toNum(m[1]);
            if (valid(n, 0.05, 100000)) return n;
        }
    }
    return null;
}

/**
 * Полный набор атрибутов с кросс-выводом:
 *   gross  = брутто (или pure / (проба/1000), если брутто нет)
 *   pure   = чистый (или gross * проба/1000, если чистого нет)
 * Возвращает { fineness, grossWeight, pureMetalWeight } (любое поле может быть null).
 */
function extractCoinAttributes(description, metal) {
    const fineness = extractFineness(description, metal);
    let gross = extractGrossWeight(description, metal);
    let pure = extractPureWeight(description, metal);

    const k = fineness ? fineness / 1000 : null;
    if (gross == null && pure != null && k) gross = pure / k;
    if (pure == null && gross != null && k) pure = gross * k;

    const round3 = x => (x == null ? null : Math.round(x * 1000) / 1000);
    return {
        fineness,
        grossWeight: round3(gross),
        pureMetalWeight: round3(pure)
    };
}

module.exports = { extractFineness, extractGrossWeight, extractPureWeight, extractCoinAttributes };
