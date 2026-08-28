'use strict';

const TYPE_NUMBER_WORDS = Object.freeze({
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    ten: 10,
    twenty: 20,
    fifty: 50,
    hundred: 100,
});

const TYPE_NUMBER_PHRASES = Object.freeze({
    'twenty five': 25,
    'twenty-five': 25,
    'one hundred': 100,
});

const UNIT_RULES = Object.freeze([
    ['RUBLE', /^(?:рубл|rouble|ruble|rubel)/iu],
    ['KOPEK', /^(?:копе|kope|cope)/iu],
    ['EURO', /^(?:евро|euro)/iu],
    ['DOLLAR', /^(?:доллар|dollar)/iu],
    ['CENT', /^(?:цент|cent$|cents$)/iu],
    ['FRANC', /^(?:франк|franc)/iu],
    ['CENTIME', /^(?:сантим|centime)/iu],
    ['PESO', /^(?:песо|peso)/iu],
    ['ZLOTY', /^(?:злот|zlot)/iu],
    ['GROSZ', /^(?:грош|grosz)/iu],
    ['PENNY', /^(?:пенни|penny)/iu],
    ['PENCE', /^(?:пенс|pence)/iu],
    ['POUND', /^(?:фунт|pound)/iu],
    ['SHILLING', /^(?:шиллинг|shilling)/iu],
    ['MARK', /^(?:марк|mark)/iu],
    ['PFENNIG', /^(?:пфенниг|pfennig)/iu],
    ['THALER', /^(?:талер|thaler)/iu],
    ['CROWN', /^(?:крон|crown)/iu],
]);

const MINT_RE = /(?:^|[^А-ЯЁA-Z0-9])(СПБ|СПМ|СПМД|ММД|ЛМД|ЕМ|ВМ|КМ|ТМ|АМ|ИМ|БМ|СМ|ММ|МД)(?=$|[^А-ЯЁA-Z0-9])/giu;

function unitFamily(value) {
    const normalized = String(value || '').trim();
    for (const [family, pattern] of UNIT_RULES) {
        if (pattern.test(normalized)) return family;
    }
    return null;
}

function typeNumber(value) {
    const normalized = String(value || '').trim().toLowerCase();
    const fraction = normalized.match(/^(\d+)\s*\/\s*(\d+)/u);
    if (fraction && Number(fraction[2]) !== 0) return Number(fraction[1]) / Number(fraction[2]);
    const numeric = normalized.match(/^(\d+(?:[.,]\d+)?)/u);
    if (numeric) return Number(numeric[1].replace(',', '.'));
    for (const [phrase, number] of Object.entries(TYPE_NUMBER_PHRASES)) {
        if (normalized === phrase || normalized.startsWith(`${phrase} `)) return number;
    }
    const word = normalized.match(/^([a-z]+)/u)?.[1];
    return word && TYPE_NUMBER_WORDS[word] ? TYPE_NUMBER_WORDS[word] : 1;
}

function typeUnit(value) {
    const normalized = String(value || '').trim();
    const withoutNumber = normalized
        .replace(/^\d+\s*\/\s*\d+\s*/u, '')
        .replace(/^\d+(?:[.,]\d+)?\s*/u, '')
        .replace(/^(?:twenty[- ]five|one hundred|one|two|three|four|five|ten|twenty|fifty|hundred)\s+/iu, '');
    return withoutNumber.split(/[\s.(-]/u)[0] || null;
}

function extractMints(value) {
    MINT_RE.lastIndex = 0;
    return new Set([...String(value || '').matchAll(MINT_RE)].map((match) => match[1].toUpperCase()));
}

function finiteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function rangesOverlap(left, right) {
    for (const value of left) if (right.has(value)) return true;
    return false;
}

function auditLotTypeLink({ lot = {}, type = {} } = {}) {
    const reasons = [];
    const evidence = [];
    const lotYear = finiteNumber(lot.year);
    const typeYear = finiteNumber(type.year);
    const typeYearStart = finiteNumber(type.yearStart ?? type.year_start ?? typeYear);
    const typeYearEnd = finiteNumber(type.yearEnd ?? type.year_end ?? typeYear);
    if (Number.isSafeInteger(lotYear) && Number.isSafeInteger(typeYearStart) && Number.isSafeInteger(typeYearEnd)) {
        evidence.push('year');
        if (lotYear < Math.min(typeYearStart, typeYearEnd) || lotYear > Math.max(typeYearStart, typeYearEnd)) {
            reasons.push('year_mismatch');
        }
    }

    const lotDenomination = lot.denomination || lot.denom || null;
    const lotFamily = unitFamily(lotDenomination?.unit);
    let catalogFamily = unitFamily(typeUnit(type.denominationText ?? type.denomination_text));
    let catalogNumber = typeNumber(type.denominationText ?? type.denomination_text);
    if (lotDenomination?.isRf && ['RU', 'SU'].includes(String(type.country || '').toUpperCase())) {
        catalogFamily = 'RUBLE';
        catalogNumber = finiteNumber(type.denominationValue ?? type.denomination_value);
    }
    if (lotFamily && catalogFamily) {
        evidence.push('denomination_unit');
        const compatibleRubles = lotDenomination.isRf
            && catalogFamily === 'RUBLE'
            && Number.isFinite(Number(lotDenomination.value))
            && Number.isFinite(catalogNumber)
            && Math.abs(Number(lotDenomination.value) - catalogNumber) < 1e-9;
        if (!compatibleRubles && lotFamily !== catalogFamily) reasons.push('denomination_unit_mismatch');
        const lotNumber = Number(lotDenomination.num);
        if (!lotDenomination.isRf && Number.isFinite(lotNumber) && Number.isFinite(catalogNumber)
            && Math.abs(lotNumber - catalogNumber) >= 1e-9) {
            reasons.push('denomination_value_mismatch');
        }
    }

    const lotMints = new Set(Array.isArray(lot.mints) ? lot.mints.map((value) => String(value).toUpperCase()) : []);
    for (const value of extractMints(lot.title)) lotMints.add(value);
    const typeMints = extractMints(`${type.mint || ''} ${type.name || type.nameFull || type.name_full || ''}`);
    if (lotMints.size && typeMints.size) {
        evidence.push('mint');
        if (!rangesOverlap(lotMints, typeMints)) reasons.push('mint_mismatch');
    }

    return {
        status: reasons.length ? 'conflict' : (evidence.length ? 'consistent' : 'unverified'),
        reasons,
        evidence,
    };
}

module.exports = { auditLotTypeLink, extractMints, typeNumber, typeUnit, unitFamily };
