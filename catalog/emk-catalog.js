/** Pure sitemap and GraphQL product helpers for the public EMK catalog. */
'use strict';

const cheerio = require('cheerio');

const ORIGIN = 'https://www.emk.com';
const SOURCE_KEY = 'emk.com';
const GRAPH_URL = `${ORIGIN}/api/graph/`;

const PRODUCT_QUERY = `query Products($options:ProductsLoadOptions!){
  catalog{products(options:$options){products{
    categoriesPaths{categories{name}}
    id title description url image{small}
    media{type:__typename ... on ProductImage{small medium mediumLarge large title variantId}}
    specifications{key name value}
  }}}
}`;

const COUNTRY_RU = new Map(Object.entries({
    Andorra: 'Андорра', Argentina: 'Аргентина', Armenia: 'Армения', Australia: 'Австралия',
    Austria: 'Австрия', Bahamas: 'Багамы', Barbados: 'Барбадос', Belgium: 'Бельгия', Benin: 'Бенин',
    Bhutan: 'Бутан', Botswana: 'Ботсвана', 'British Virgin Islands': 'Британские Виргинские острова',
    'Burkina Faso': 'Буркина-Фасо', Burundi: 'Бурунди', Cameroon: 'Камерун', Canada: 'Канада',
    'Central African Republic': 'Центральноафриканская Республика', Chad: 'Чад', Chile: 'Чили',
    China: 'Китай', Congo: 'Конго', 'Congo Democratic Republic': 'Демократическая Республика Конго',
    'Republic of Congo': 'Республика Конго', 'Cook Islands': 'Острова Кука', 'Costa Rica': 'Коста-Рика',
    Croatia: 'Хорватия', Cuba: 'Куба', Cyprus: 'Кипр', 'Czech Republic': 'Чехия', Djibouti: 'Джибути',
    Dominica: 'Доминика', 'East Timor': 'Восточный Тимор', Ecuador: 'Эквадор', Egypt: 'Египет',
    'Equatorial Guinea': 'Экваториальная Гвинея', Estonia: 'Эстония', Fiji: 'Фиджи', 'Fiji Islands': 'Фиджи', Finland: 'Финляндия',
    France: 'Франция', Gabon: 'Габон', Gambia: 'Гамбия', Georgia: 'Грузия', Germany: 'Германия',
    Ghana: 'Гана', Gibraltar: 'Гибралтар', Greece: 'Греция', Grenada: 'Гренада', Guinea: 'Гвинея',
    Guyana: 'Гайана', Hungary: 'Венгрия', Iceland: 'Исландия', India: 'Индия', Indonesia: 'Индонезия',
    Ireland: 'Ирландия', 'Isle of Man': 'Остров Мэн', 'Ascension Island': 'Остров Вознесения',
    'Mariana Islands': 'Марианские острова', 'Pitcairn Islands': 'Острова Питкэрн', Israel: 'Израиль', Italy: 'Италия',
    'Ivory Coast': 'Кот-д’Ивуар', Jamaica: 'Ямайка', Japan: 'Япония', Jordan: 'Иордания',
    Kazakhstan: 'Казахстан', Kenya: 'Кения', Kiribati: 'Кирибати', Kyrgyzstan: 'Киргизия', Laos: 'Лаос',
    Latvia: 'Латвия', Lebanon: 'Ливан', Lesotho: 'Лесото', Liberia: 'Либерия', Liechtenstein: 'Лихтенштейн',
    Lithuania: 'Литва', Luxembourg: 'Люксембург', Madagascar: 'Мадагаскар', Malawi: 'Малави',
    Malaysia: 'Малайзия', Maldives: 'Мальдивы', Mali: 'Мали', Malta: 'Мальта', Mauritania: 'Мавритания',
    Mauritius: 'Маврикий', Mexico: 'Мексика', Moldova: 'Молдавия', Monaco: 'Монако', Mongolia: 'Монголия',
    Montenegro: 'Черногория', Mozambique: 'Мозамбик', Myanmar: 'Мьянма', Namibia: 'Намибия', Nauru: 'Науру',
    Nepal: 'Непал', Netherlands: 'Нидерланды', 'New Zealand': 'Новая Зеландия', Nicaragua: 'Никарагуа',
    Niger: 'Нигер', Nigeria: 'Нигерия', Niue: 'Ниуэ', 'North Macedonia': 'Северная Македония', Norway: 'Норвегия',
    Oman: 'Оман', Pakistan: 'Пакистан', Palau: 'Палау', Panama: 'Панама',
    'Papua New Guinea': 'Папуа Новая Гвинея', Paraguay: 'Парагвай', Peru: 'Перу', Philippines: 'Филиппины',
    Poland: 'Польша', Portugal: 'Португалия', Romania: 'Румыния', Rwanda: 'Руанда',
    'Saint Helena': 'Остров Святой Елены', Samoa: 'Самоа', 'San Marino': 'Сан-Марино',
    'Saudi Arabia': 'Саудовская Аравия', Senegal: 'Сенегал', Serbia: 'Сербия', Seychelles: 'Сейшелы',
    'Sierra Leone': 'Сьерра-Леоне', Singapore: 'Сингапур', Slovakia: 'Словакия', Slovenia: 'Словения',
    'Solomon Islands': 'Соломоновы Острова', Somalia: 'Сомали', 'South Africa': 'ЮАР',
    'South Korea': 'Южная Корея', Spain: 'Испания', 'Sri Lanka': 'Шри-Ланка', Suriname: 'Суринам',
    Swaziland: 'Эсватини', Sweden: 'Швеция', Switzerland: 'Швейцария', Tanzania: 'Танзания',
    Thailand: 'Таиланд', Tokelau: 'Токелау', Tonga: 'Тонга', 'Trinidad and Tobago': 'Тринидад и Тобаго',
    Turkey: 'Турция', Tuvalu: 'Тувалу', Uganda: 'Уганда', Ukraine: 'Украина',
    'Great Britain': 'Великобритания', 'United Kingdom': 'Великобритания', 'United States': 'США',
    'United States of America': 'США', USA: 'США', Uruguay: 'Уругвай', Uzbekistan: 'Узбекистан',
    Vanuatu: 'Вануату', Vatican: 'Ватикан', Venezuela: 'Венесуэла', Vietnam: 'Вьетнам', Zambia: 'Замбия', Zimbabwe: 'Зимбабве',
}));

const CURRENCY_RU = new Map([
    ['dollar', 'долларов'], ['dollars', 'долларов'], ['cent', 'центов'], ['cents', 'центов'],
    ['euro', 'евро'], ['euros', 'евро'], ['pound', 'фунтов'], ['pounds', 'фунтов'],
    ['pence', 'пенсов'], ['penny', 'пенни'], ['shilling', 'шиллингов'], ['shillings', 'шиллингов'],
    ['franc', 'франков'], ['francs', 'франков'], ['peso', 'песо'], ['pesos', 'песо'], ['yuan', 'юаней'],
    ['rouble', 'рублей'], ['roubles', 'рублей'], ['ruble', 'рублей'], ['rubles', 'рублей'],
    ['rupee', 'рупий'], ['rupees', 'рупий'], ['rand', 'рандов'], ['dinar', 'динаров'], ['dinars', 'динаров'],
    ['dirham', 'дирхамов'], ['dirhams', 'дирхамов'], ['crown', 'крон'], ['crowns', 'крон'],
    ['koruna', 'крон'], ['kroner', 'крон'], ['krona', 'крон'], ['zloty', 'злотых'], ['won', 'вон'],
    ['yen', 'иен'], ['forint', 'форинтов'], ['forints', 'форинтов'], ['lira', 'лир'], ['lire', 'лир'],
    ['tala', 'тала'], ['vatu', 'вату'], ['kwacha', 'квач'],
]);

function cleanText(value) {
    return cheerio.load(String(value || '')).text().replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(value, base = ORIGIN) {
    if (!value) return null;
    try {
        const url = new URL(value, base);
        if (!/(?:^|\.)emk\.com$/i.test(url.hostname)) return null;
        url.protocol = 'https:';
        url.hostname = 'www.emk.com';
        url.hash = '';
        return url.href;
    } catch (_) {
        return null;
    }
}

function sitemapLocations(xml) {
    return [...String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/gi)]
        .map((match) => match[1].replaceAll('&amp;', '&').trim());
}

function productIdFromUrl(value) {
    const sourceUrl = absoluteUrl(value);
    if (!sourceUrl) return null;
    const slug = new URL(sourceUrl).pathname.split('/').filter(Boolean).at(-1) || '';
    return slug.match(/-([a-z][a-z0-9]{5,})$/i)?.[1]?.toUpperCase() || null;
}

function parseProductSitemap(xml) {
    const seen = new Set();
    const items = [];
    for (const value of sitemapLocations(xml)) {
        const sourceUrl = absoluteUrl(value);
        const id = productIdFromUrl(sourceUrl);
        const slug = sourceUrl && new URL(sourceUrl).pathname.split('/').filter(Boolean).at(-1);
        if (!id || !/\d/.test(id) || !slug || !/coin/i.test(slug)
            || /(?:coin[-_]?set|coins[-_]?set|coin[-_]?note|banknote|bar|medal|combi|capsule|box|album|accessor|display|folder|case|frame|pendant|jewell)/i.test(slug)
            || seen.has(id)) continue;
        seen.add(id);
        items.push({ sourceItemKey: id.toLowerCase(), queryId: id, sourceUrl });
    }
    return items;
}

function specificationMap(specifications) {
    return Object.fromEntries((specifications || []).filter((item) => item?.name && item?.value)
        .map((item) => [cleanText(item.name), cleanText(item.value)]));
}

function integerValue(value) {
    const text = cleanText(value);
    if (!text || /unlimit|unbekannt|unknown|n\/a/i.test(text)) return null;
    const digits = text.replace(/[^0-9]/g, '');
    return digits ? Number(digits) : null;
}

function exactYear(title, url) {
    const tail = cleanText(title).match(/(?:^|[-–])\s*((?:19|20)\d{2})\s*$/)?.[1];
    const slug = String(url || '').match(/[-/]((?:19|20)\d{2})-[a-z][a-z0-9]{5,}(?:[/?#]|$)/i)?.[1];
    if (tail && slug && tail !== slug) return null;
    return Number(tail || slug) || null;
}

function numberText(raw) {
    const value = String(raw).trim().replace(/[\s\u00a0]/g, '');
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(value)) return value.replace(/[.,]/g, '');
    return value.replace(',', '.');
}

function denominationFromDescription(html) {
    const text = cleanText(html);
    if (!text || /no fixed denomination/i.test(text)) return null;
    const word = '(?:DOLLARS?|CENTS?|EUROS?|POUNDS?|PENCE|PENNY|SHILLINGS?|FRANCS?|PESOS?|YUAN|ROUBLES?|RUBLES?|RUPEES?|RAND|DINARS?|DIRHAMS?|CROWNS?|KORUNA|KRONER|KRONA|ZLOTY|WON|YEN|FORINTS?|LIRA|LIRE|TALA|VATU|KWACHA)';
    const amount = '(?<![0-9])([0-9]{1,3}(?:[.,\\u00a0 ][0-9]{3})+|[0-9]+(?:[.,][0-9]+)?)';
    const candidates = [];
    const add = (amount, unit) => {
        const normalized = numberText(amount);
        const matcherUnit = CURRENCY_RU.get(String(unit).toLowerCase());
        if (normalized && matcherUnit) candidates.push({ source: `${normalized} ${String(unit).toUpperCase()}`, matcher: `${normalized} ${matcherUnit}` });
    };
    for (const match of text.matchAll(new RegExp(`(?:denomination|face value|nominal value)[^.;]{0,45}?[“"']?${amount}\\s*(${word})`, 'gi'))) add(match[1], match[2]);
    for (const match of text.matchAll(new RegExp(`[“"']${amount}\\s*(${word})[”"']`, 'gi'))) add(match[1], match[2]);
    for (const match of text.matchAll(new RegExp(`(?:inscriptions?|outer edge)[^.;]{0,120}?${amount}\\s*(${word})`, 'gi'))) add(match[1], match[2]);
    for (const match of text.matchAll(/(?:denomination|face value|nominal value)[^.;]{0,30}?([$£€])\s*([0-9]{1,3}(?:[.,\u00a0 ][0-9]{3})+|[0-9]+(?:[.,][0-9]+)?)/gi)) {
        add(match[2], match[1] === '$' ? 'DOLLARS' : match[1] === '£' ? 'POUNDS' : 'EUROS');
    }
    const unique = [...new Map(candidates.map((item) => [`${item.source}|${item.matcher}`, item])).values()];
    if (unique.length === 1) return unique[0];
    if (unique.length > 1) {
        const exact = unique.filter((item) => text.includes(`“${item.source}”`) || text.includes(`"${item.source}"`));
        return exact.length === 1 ? exact[0] : null;
    }
    return null;
}

function denominationFromTitle(title) {
    const text = cleanText(title);
    const match = text.match(/(?:^|[-–]\s*)([0-9]+(?:[.,][0-9]+)?)\s+(dollars?|cents?|euros?|pounds?|pence|shillings?|francs?|pesos?|yuan|roubles?|rubles?|rupees?|rand|dinars?|dirhams?|crowns?|koruna|kroner|krona|zloty|won|yen|forints?|lira|lire|tala|vatu|kwacha)\s+(?:gold|silver|platinum|palladium|copper|bronze)?\s*coin\b/i);
    if (!match) return null;
    const unit = CURRENCY_RU.get(match[2].toLowerCase());
    return unit ? { source: `${numberText(match[1])} ${match[2].toUpperCase()}`, matcher: `${numberText(match[1])} ${unit}` } : null;
}

function weightGrams(title) {
    const match = cleanText(title).match(/(?:^|\s)(\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?)\s*(kg|kilo|oz|ounce|g|gr\.?)(?:\s|$)/i);
    if (!match) return null;
    let amount;
    if (match[1].includes('/')) {
        const [top, bottom] = match[1].split('/').map(Number);
        amount = bottom ? top / bottom : null;
    } else amount = Number(match[1].replace(',', '.'));
    if (!amount) return null;
    const unit = match[2].toLowerCase();
    if (unit === 'kg' || unit === 'kilo') return amount * 1000;
    if (unit === 'oz' || unit === 'ounce') return amount * 31.1034768;
    return amount;
}

function countryFromPaths(paths) {
    const names = (paths || []).flatMap((path) => path?.categories || []).map((item) => cleanText(item?.name)).filter(Boolean);
    return names.find((name) => COUNTRY_RU.has(name)) || null;
}

function coinImages(media) {
    const values = (media || []).filter((item) => item?.type === 'ProductImage' && item.large)
        .map((item) => absoluteUrl(item.large)).filter(Boolean);
    if (values.length < 2) return { avers: values[0] || null, revers: null, all: values };
    if (values.length === 2) return { avers: values[0], revers: values[1], all: values };
    // EMK commonly orders media as hero, close-ups of one side, the other side, then packaging.
    // The first close-up and the middle image avoid both the hero duplicate and trailing boxes.
    const reverseIndex = Math.min(Math.ceil(values.length / 2), values.length - 1);
    return { avers: values[1], revers: values[reverseIndex], all: values };
}

function parseEmkProduct(raw) {
    const title = cleanText(raw?.title);
    const sourceUrl = absoluteUrl(raw?.url);
    const id = cleanText(raw?.id).toUpperCase();
    const country = countryFromPaths(raw?.categoriesPaths);
    const countryRu = COUNTRY_RU.get(country);
    const denomination = denominationFromDescription(raw?.description) || denominationFromTitle(title);
    const year = exactYear(title, sourceUrl);
    const specifications = specificationMap(raw?.specifications);
    const images = coinImages(raw?.media);
    const metal = title.match(/\b(gold|silver|platinum|palladium|copper|bronze)\b/i)?.[1] || null;
    const categoryPaths = (raw?.categoriesPaths || []).map((path) => (path.categories || []).map((item) => cleanText(item.name)).filter(Boolean));
    return {
        sourceKey: SOURCE_KEY,
        sourceItemKey: id.toLowerCase(),
        sourceUrl,
        itemStatus: 'unknown',
        title,
        matchTitle: denomination && countryRu && year ? `${denomination.matcher} ${year} ${title} ${countryRu}` : title,
        country,
        denomination: denomination?.source || null,
        year,
        metal,
        weightG: weightGrams(title),
        diameterMm: null,
        mintage: integerValue(specifications.Mintage),
        condition: specifications.Quality || null,
        themes: [],
        aversImageUrl: images.avers,
        reversImageUrl: images.revers,
        attributes: {
            'Product code': id,
            ...specifications,
            category_paths: categoryPaths,
            media_urls: images.all,
            description_text: cleanText(raw?.description),
            denomination_evidence: denomination?.source || null,
        },
    };
}

function isUsableCoinProduct(product, parsedTitle) {
    const title = product?.title || '';
    const explicitSet = /\b(?:set|\d+[- ]coin|collection\s+of\s+\d+)\b/i.test(title);
    return Boolean(product?.sourceItemKey && product?.sourceUrl && product?.title && product?.year && product?.country
        && product?.aversImageUrl && product?.reversImageUrl && product?.attributes?.['Product code']
        && /\bcoin\b/i.test(title) && !explicitSet && !parsedTitle?.isSet && !parsedTitle?.isNonCoin
        && !/(?:banknote|coin note|medal|medallion|bullion bar|coin bar|capsule|album|empty box|presentation box)/i.test(title));
}

module.exports = {
    COUNTRY_RU,
    GRAPH_URL,
    ORIGIN,
    PRODUCT_QUERY,
    SOURCE_KEY,
    absoluteUrl,
    coinImages,
    denominationFromDescription,
    denominationFromTitle,
    exactYear,
    isUsableCoinProduct,
    parseEmkProduct,
    parseProductSitemap,
    productIdFromUrl,
    weightGrams,
};
