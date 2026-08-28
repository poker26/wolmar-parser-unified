'use strict';

const { normalizeGrade } = require('./grade');

const SLAB_STATUSES = Object.freeze(['slabbed', 'raw', 'unknown']);
const GRADING_COMPANY_CODES = Object.freeze([
    'NGC',
    'PCGS',
    'NNR',
    'RNGA',
    'NRG',
    'NGS',
    'OTHER',
]);
const GRADE_SOURCES = Object.freeze(['slab_label', 'auction_house', 'user', 'unknown']);

const COMPANY_ALIASES = new Map([
    ['NGC', 'NGC'],
    ['PCGS', 'PCGS'],
    ['NNR', 'NNR'],
    ['HHP', 'NNR'],
    ['ННР', 'NNR'],
    ['HHР', 'NNR'],
    ['HНР', 'NNR'],
    ['RNGA', 'RNGA'],
    ['РНГА', 'RNGA'],
    ['NRG', 'NRG'],
    ['NGS', 'NGS'],
    ['NGС', 'NGC'],
    ['PСGS', 'PCGS'],
]);

const COMPANY_TOKEN = [
    'PCGS',
    'NGC',
    'NNR',
    'H[.\\s]*H[.\\s]*P',
    'Н[.\\s]*Н[.\\s]*Р',
    'RNGA',
    'РНГА',
    'NRG',
    'NGS',
].join('|');
const GRADE_TOKEN = '(?:MS|PF|PR|SP|AU|XF|VF|VG|F|G)\\s*[-/]?\\s*\\d{1,2}(?:\\s*(?:\\+|PL|DPL|DMPL|CAM|UCAM|ULTRA\\s*CAMEO))?';
const EXPLICIT_RAW_RE = /(?:без\s+(?:слаба|холдера)|не\s+в\s+(?:слабе|холдере)|unslabbed|not\s+(?:in\s+)?(?:a\s+)?(?:slab|holder))/iu;
const SLAB_AFTER_RE = /(?:^|[^\p{L}\p{N}])(?:(?:в|во)\s+(?:слабе|холдере)|(?:капсуле\s*)?\(\s*слаб(?:е)?\s*\)|(?:in\s+)?(?:a\s+)?(?:slab|holder)|slabbed)(?=$|[^\p{L}\p{N}])/iu;
const COMPANY_CERT_RE = new RegExp(
    `(?:${COMPANY_TOKEN})\\s*(?:${GRADE_TOKEN})?\\s*[,;:]?\\s*(?:cert(?:ificate)?|сертификат|cert\\.?\\s*(?:no|#|№)|#|№)`,
    'iu',
);
const CERT_COMPANY_RE = new RegExp(
    `(?:cert(?:ificate)?|сертификат|cert\\.?\\s*(?:no|#|№))\\s*[:#№-]?\\s*(?:${COMPANY_TOKEN})(?:\\s*(?:${GRADE_TOKEN}))?`,
    'iu',
);
const COMPANY_RE = new RegExp(COMPANY_TOKEN, 'iu');
const GRADE_RE = new RegExp(GRADE_TOKEN, 'iu');
const DIRECT_COMPANY_RE = new RegExp(`^(${COMPANY_TOKEN})(?=$|[\\s,.;:])`, 'iu');
const DIRECT_GRADE_RE = new RegExp(`^(${GRADE_TOKEN})(?=$|[\\s,.;:])`, 'iu');

function cleanRawValue(value) {
    if (typeof value !== 'string') return null;
    const cleaned = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
    return cleaned || null;
}

function aliasKey(value) {
    return value
        .toUpperCase()
        .replace(/[.·•_\-\s]/g, '');
}

function visualLatinKeys(value) {
    const substitutions = {
        Р: ['P', 'R'],
        С: ['C', 'S'],
        Н: ['H', 'N'],
    };
    let variants = [''];
    for (const character of value) {
        const replacements = substitutions[character] || [character];
        variants = variants.flatMap((prefix) => replacements.map((item) => prefix + item));
    }
    return variants;
}

/**
 * Normalizes an already isolated grading-company label. It intentionally does
 * not search arbitrary text: deciding whether the text proves that a slab
 * exists belongs to extractSlabInfo.
 */
function normalizeGradingCompany(value) {
    const raw = cleanRawValue(value);
    if (!raw) return { gradingCompanyCode: null, gradingCompanyRaw: null };
    const key = aliasKey(raw);
    const visualAlias = visualLatinKeys(key)
        .map((candidate) => COMPANY_ALIASES.get(candidate))
        .find(Boolean);
    return {
        gradingCompanyCode: COMPANY_ALIASES.get(key)
            || visualAlias
            || 'OTHER',
        gradingCompanyRaw: raw,
    };
}

function normalizeEnum(value, allowed, fallback, fieldName) {
    const normalized = cleanRawValue(value)?.toLowerCase() || fallback;
    if (!allowed.includes(normalized)) {
        throw new TypeError(`${fieldName} must be one of: ${allowed.join(', ')}`);
    }
    return normalized;
}

function normalizeSlabInfo(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('slab info must be an object');
    }

    const slabStatus = normalizeEnum(
        value.slabStatus,
        SLAB_STATUSES,
        'unknown',
        'slabStatus',
    );
    const gradeSource = normalizeEnum(
        value.gradeSource,
        GRADE_SOURCES,
        'unknown',
        'gradeSource',
    );

    if (gradeSource === 'slab_label' && slabStatus !== 'slabbed') {
        throw new TypeError('gradeSource slab_label requires slabStatus slabbed');
    }

    const company = slabStatus === 'slabbed'
        ? normalizeGradingCompany(value.gradingCompanyRaw || value.gradingCompanyCode)
        : { gradingCompanyCode: null, gradingCompanyRaw: null };

    if (
        value.gradingCompanyCode
        && company.gradingCompanyCode !== value.gradingCompanyCode.toUpperCase()
    ) {
        throw new TypeError('gradingCompanyCode conflicts with gradingCompanyRaw');
    }

    return Object.freeze({
        slabStatus,
        gradingCompanyCode: company.gradingCompanyCode,
        gradingCompanyRaw: company.gradingCompanyRaw,
        gradeCode: normalizeGrade(value.gradeCode),
        gradeSource,
    });
}

function cleanText(value) {
    return typeof value === 'string'
        ? value.normalize('NFKC').replace(/\s+/g, ' ').trim()
        : '';
}

function explicitStatus(sourceFields) {
    if (!sourceFields || typeof sourceFields !== 'object' || Array.isArray(sourceFields)) {
        return null;
    }
    const status = cleanRawValue(sourceFields.slabStatus)?.toLowerCase();
    if (SLAB_STATUSES.includes(status)) return status;
    // False is deliberately ignored: source schemas commonly use it as a
    // default, so it is not proof that a physical coin is raw.
    if (sourceFields.isSlabbed === true) return 'slabbed';
    return null;
}

function sourceCompany(sourceFields) {
    if (!sourceFields || typeof sourceFields !== 'object') return null;
    return sourceFields.gradingCompanyRaw
        || sourceFields.gradingCompany
        || sourceFields.slabCompany
        || sourceFields.holderCompany
        || null;
}

function sourceLabelGrade(sourceFields) {
    if (!sourceFields || typeof sourceFields !== 'object') return null;
    return sourceFields.labelGradeCode
        || sourceFields.slabGradeCode
        || sourceFields.labelGrade
        || sourceFields.slabGrade
        || null;
}

function evidenceWindow(text, match, length = 180) {
    const start = Math.max(0, match.index - 20);
    return text.slice(start, Math.min(text.length, match.index + length)).trim().slice(0, 500);
}

function findDescriptionEvidence(description) {
    const rawMatch = EXPLICIT_RAW_RE.exec(description);
    if (rawMatch) {
        return {
            slabStatus: 'raw',
            companyRaw: null,
            labelGrade: null,
            evidenceText: evidenceWindow(description, rawMatch, 100),
        };
    }

    const slabContextMatch = SLAB_AFTER_RE.exec(description);
    const contextMatch = slabContextMatch
        || COMPANY_CERT_RE.exec(description)
        || CERT_COMPANY_RE.exec(description);
    if (!contextMatch) return null;

    const evidenceText = evidenceWindow(description, contextMatch);
    let companyRaw = null;
    let labelGrade = null;

    if (slabContextMatch) {
        let direct = description.slice(
            slabContextMatch.index + slabContextMatch[0].length,
            slabContextMatch.index + slabContextMatch[0].length + 100,
        ).replace(/^[\s:;,\-]+/u, '');
        const packaging = direct.match(/^(?:коробк[а-яё]*|капсул[а-яё]*)(?=$|\s)/iu);
        if (packaging) direct = direct.slice(packaging[0].length).replace(/^[\s:;,\-]+/u, '');

        const namedCompany = direct.match(/^(Premium\s+Grading)(?=$|[\s,.;:])/iu);
        const knownCompany = DIRECT_COMPANY_RE.exec(direct);
        const possibleCompany = direct.match(
            /^([A-ZА-ЯЁ][A-ZА-ЯЁ0-9.\-]{1,15})(?=$|[\s,.;:])/u,
        );
        const possibleCompanyRaw = possibleCompany
            ? possibleCompany[1].replace(/[.,;:]+$/, '')
            : null;
        const possibleIsGrade = possibleCompanyRaw
            && /^(?:MS|PF|PR|SP|AU|XF|VF|VG|F|G|UNC)(?:\d.*)?$/i.test(possibleCompanyRaw);
        companyRaw = namedCompany?.[1]
            || knownCompany?.[1]
            || (possibleCompanyRaw && !possibleIsGrade ? possibleCompanyRaw : null);

        if (companyRaw) {
            direct = direct.slice(companyRaw.length).replace(/^[\s:;,\-]+/u, '');
        }
        labelGrade = DIRECT_GRADE_RE.exec(direct)?.[1] || null;
    } else {
        const certifiedText = contextMatch[0];
        companyRaw = COMPANY_RE.exec(certifiedText)?.[0] || null;
        labelGrade = GRADE_RE.exec(certifiedText)?.[0] || null;
    }

    return {
        slabStatus: 'slabbed',
        companyRaw,
        labelGrade,
        evidenceText,
    };
}

/**
 * Extracts conservative, auditable slab facts. Missing words about a slab are
 * never interpreted as proof that the coin is raw, and a generic auction-house
 * condition is never promoted to a label grade.
 */
function extractSlabInfo({ description, condition, sourceFields } = {}) {
    const cleanDescription = cleanText(description);
    const fromDescription = cleanDescription
        ? findDescriptionEvidence(cleanDescription)
        : null;
    const statusFromSource = explicitStatus(sourceFields);
    const slabStatus = statusFromSource || fromDescription?.slabStatus || 'unknown';
    const companyRaw = slabStatus === 'slabbed'
        ? sourceCompany(sourceFields) || fromDescription?.companyRaw || null
        : null;
    const labelGrade = slabStatus === 'slabbed'
        ? sourceLabelGrade(sourceFields) || fromDescription?.labelGrade || null
        : null;
    const auctionGrade = normalizeGrade(condition);
    const normalized = normalizeSlabInfo({
        slabStatus,
        gradingCompanyRaw: companyRaw,
        gradeCode: labelGrade || auctionGrade,
        gradeSource: labelGrade
            ? 'slab_label'
            : auctionGrade
                ? 'auction_house'
                : 'unknown',
    });

    return Object.freeze({
        ...normalized,
        extractorVersion: 'slab-info-v1',
        evidenceText: fromDescription?.evidenceText || null,
    });
}

module.exports = {
    GRADE_SOURCES,
    GRADING_COMPANY_CODES,
    SLAB_STATUSES,
    extractSlabInfo,
    normalizeGradingCompany,
    normalizeSlabInfo,
};
