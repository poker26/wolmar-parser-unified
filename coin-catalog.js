/**
 * Каталог монет: извлечение номинала и применение нормативных вес/проба.
 *
 * Идея: для ~84% стандартных монет вес/проба в тексте лота отсутствуют, но они
 * однозначно определяются ТИПОМ монеты (номинал + металл + период действия
 * монетной стопы). Каталог строится бутстрапом из тех лотов, где вес/проба уже
 * извлечены из текста (мода по группе), и затем применяется к остальным.
 *
 * Ключ каталога: (denomination_kopecks, metal, year_from..year_to).
 * Один номинал может иметь НЕСКОЛЬКО записей — реформы меняли стопу
 * (напр. 5 руб Au: 6.45 г до 1897 → 4.30 г с 1897).
 *
 * Здесь — только извлечение номинала (общее для build/apply и live-парсера).
 */

// Допустимые номиналы (рубли могут быть дробными: 7.5, 37.5, 2.5)
const RUB_WHITELIST = new Set([1, 2, 2.5, 3, 5, 7.5, 10, 15, 20, 25, 37.5, 50, 100, 150, 200, 500, 1000]);
const KOP_WHITELIST = new Set([3, 5, 10, 15, 20, 25, 50]);

// Иностранные валюты — такие лоты в русский каталог не берём.
// ВНИМАНИЕ: «марка/марок» здесь ловит ГЕРМАНСКИЕ марки. Финские марки/пенни
// (Великое княжество Финляндское, ≤1917) обрабатываются ОТДЕЛЬНО до этой проверки.
const FOREIGN_RE = /(франк|марок|марк[аи]|доллар|фунт|крон|лир[ауы]|песо|злот|иен|юан|цент|эскудо|гульден|дукат|талер|пиастр|драхм|лев[аов]|нгултрум|форинт|злотых|сентав|риал|динар|шиллинг)/i;

// Финские номиналы (марка = 100 пенни). До 1917 — имперская чеканка, в области.
const FIM_MARKKA_WL = new Set([1, 2, 5, 10, 20]);
const FIM_PENNI_WL = new Set([1, 5, 10, 25, 50]);

// Словесные номиналы → значение в копейках.
// (без \b — в JS граница слова \b не работает с кириллицей; стемы достаточно
//  характерны, чтобы не давать ложных срабатываний)
const WORD_DENOM = [
    [/полуимпериал/i, 5 * 100],   // 5 руб (до 1897)
    [/империал/i, 10 * 100],      // 10 руб (до 1897)
    [/червон[ецца]/i, 10 * 100],  // 10 руб (червонец)
    [/полтин/i, 50],              // 50 коп (полтина/полтинник)
    [/четвертак/i, 25],           // 25 коп
    [/двугривенн/i, 20],          // 20 коп
    [/пятиалтынн/i, 15],          // 15 коп
    [/гривенн/i, 10],             // 10 коп
    [/пятачок/i, 5],              // 5 коп
];

function canonLabel(kop) {
    if (kop % 100 === 0) return `${kop / 100} руб`;
    if (kop >= 100) return `${kop / 100} руб`; // дробные рубли (750 → 7.5 руб)
    return `${kop} коп`;
}

/**
 * Финские монеты российской эпохи. Условие вызова: в описании есть «Финлянд».
 * Возвращает { value (в пенни), currency:'fim', label } или null.
 * После 1917 — независимая Финляндия, вне области (возвращаем null).
 */
function extractFinnish(description) {
    const ym = description.slice(0, 60).match(/(1[789]\d{2}|20[0-3]\d)\s*г/);
    const year = ym ? parseInt(ym[1], 10) : null;
    if (year != null && year > 1917) return null;

    const head = description.slice(0, 45);
    // N марок/марка/марки → пенни = N*100
    let m = head.match(/(\d+)\s*мар(?:ок|к[аи])/i);
    if (m) {
        const v = parseInt(m[1], 10);
        if (FIM_MARKKA_WL.has(v)) return { value: v * 100, currency: 'fim', label: `${v} марк.` };
    }
    // N пенни
    m = head.match(/(\d+)\s*пенни/i);
    if (m) {
        const v = parseInt(m[1], 10);
        if (FIM_PENNI_WL.has(v)) return { value: v, currency: 'fim', label: `${v} пенни` };
    }
    return null;
}

/**
 * Извлекает номинал русской монеты из описания.
 * Возвращает { kopecks, label } или null (иностранное / не монета / не распознано).
 *
 * Якоримся к НАЧАЛУ описания — у Wolmar номинал почти всегда первым:
 *   "10 рублей 1899 года...", "50 копеек 1913г...", "3 рубля 2008г...",
 *   "7 рублей 50 копеек 1897..." → 7.5 руб.
 */
function extractDenomination(description) {
    if (!description) return null;

    // Финские монеты Великого княжества (≤1917) — отдельная валюта, ловим ДО
    // проверки на иностранную (иначе «марок» уйдёт в FOREIGN_RE).
    if (/финлянд/i.test(description)) return extractFinnish(description);

    const head = description.slice(0, 45);

    // Если в начале фигурирует иностранная валюта — это не русская монета.
    if (FOREIGN_RE.test(head)) return null;

    // 1) "N рублей M копеек" → дробный рубль ([а-яё]*, т.к. \w в JS не ловит кириллицу)
    let m = head.match(/(\d+)\s*рубл[а-яё]*\s+(\d+)\s*копе[а-яё]*/i);
    if (m) {
        const kop = parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
        const rub = kop / 100;
        if (RUB_WHITELIST.has(rub)) return { value: kop, currency: 'rub', label: canonLabel(kop) };
    }

    // 2) "N рублей" (с возможной дробью .5)
    m = head.match(/(\d+(?:[.,]5)?)\s*рубл[ьяей]/i);
    if (m) {
        const rub = parseFloat(m[1].replace(',', '.'));
        if (RUB_WHITELIST.has(rub)) {
            const kop = Math.round(rub * 100);
            return { value: kop, currency: 'rub', label: canonLabel(kop) };
        }
    }

    // 3) "N копеек"
    m = head.match(/(\d+)\s*копе[а-яё]*/i);
    if (m) {
        const kop = parseInt(m[1], 10);
        if (KOP_WHITELIST.has(kop)) return { value: kop, currency: 'rub', label: canonLabel(kop) };
    }

    // 4) словесные номиналы (по всему описанию — они однозначны)
    for (const [re, kop] of WORD_DENOM) {
        if (re.test(description)) return { value: kop, currency: 'rub', label: canonLabel(kop) };
    }

    return null;
}

module.exports = { extractDenomination, extractFinnish, RUB_WHITELIST, KOP_WHITELIST, FOREIGN_RE, canonLabel };
