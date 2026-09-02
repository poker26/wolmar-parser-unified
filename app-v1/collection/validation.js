'use strict';

const GRADE_SYSTEMS = new Set(['adjectival', 'sheldon', 'proof']);
const ITEM_STATUSES = new Set(['active', 'sold', 'archived']);
const IDENTIFICATION_STATUSES = new Set(['linked', 'unlinked', 'needs_review']);
const SLAB_STATUSES = new Set(['slabbed', 'raw', 'unknown']);
const GRADING_COMPANIES = new Set(['NGC', 'PCGS', 'NNR', 'RNGA', 'NRG', 'NGS', 'OTHER']);
const GRADE_SOURCES = new Set(['slab_label', 'auction_house', 'user', 'unknown']);

class InputError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'InputError';
        this.code = code;
        this.status = 400;
    }
}

function text(value, field, maxLength, { nullable = true } = {}) {
    if (value === undefined) return undefined;
    if (value === null) {
        if (nullable) return null;
        throw new InputError('invalid_input', `${field} cannot be null`);
    }
    if (typeof value !== 'string') throw new InputError('invalid_input', `${field} must be a string`);
    const normalized = value.trim().normalize('NFKC');
    if (!normalized) return nullable ? null : (() => { throw new InputError('invalid_input', `${field} is required`); })();
    if (normalized.length > maxLength) {
        throw new InputError('invalid_input', `${field} is longer than ${maxLength} characters`);
    }
    return normalized;
}

function positiveInteger(value, field) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new InputError('invalid_input', `${field} must be a positive integer`);
    }
    return parsed;
}

function catalogYear(value, field = 'identifiedYear') {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1000 || parsed > 2200) {
        throw new InputError('invalid_input', `${field} must be between 1000 and 2200`);
    }
    return parsed;
}

function uuid(value, field = 'id') {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw new InputError('invalid_id', `${field} must be a UUID`);
    }
    return value.toLowerCase();
}

function money(value, field) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new InputError('invalid_input', `${field} must be a non-negative safe integer`);
    }
    return value;
}

function currency(value, field) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const normalized = text(value, field, 3, { nullable: false }).toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) {
        throw new InputError('invalid_input', `${field} must be an ISO 4217 code`);
    }
    return normalized;
}

function isoDate(value, field) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new InputError('invalid_input', `${field} must use YYYY-MM-DD`);
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new InputError('invalid_input', `${field} is not a valid date`);
    }
    return value;
}

function gradeCode(value) {
    const normalized = text(value, 'gradeCode', 20);
    if (normalized == null || normalized === undefined) return normalized;
    const upper = normalized.toUpperCase();
    if (!/^[A-ZА-ЯЁ0-9+./ -]+$/u.test(upper)) {
        throw new InputError('invalid_input', 'gradeCode contains unsupported characters');
    }
    return upper;
}

function gradeSystem(value) {
    if (value === undefined || value === null) return value;
    const normalized = text(value, 'gradeSystem', 20, { nullable: false }).toLowerCase();
    if (!GRADE_SYSTEMS.has(normalized)) {
        throw new InputError('invalid_input', 'gradeSystem is not supported');
    }
    return normalized;
}

function enumValue(value, field, allowed, fallback = undefined) {
    if (value === undefined) return fallback;
    if (value === null) return null;
    const normalized = text(value, field, 40, { nullable: false }).toLowerCase();
    if (!allowed.has(normalized)) throw new InputError('invalid_input', `${field} is not supported`);
    return normalized;
}

function slabCreateFields(body, normalizedGradeCode) {
    const slabStatus = enumValue(body.slabStatus, 'slabStatus', SLAB_STATUSES, 'unknown');
    const companyInput = text(body.gradingCompanyCode, 'gradingCompanyCode', 20);
    const gradingCompanyCode = companyInput == null ? null : companyInput.toUpperCase();
    if (gradingCompanyCode && !GRADING_COMPANIES.has(gradingCompanyCode)) {
        throw new InputError('invalid_input', 'gradingCompanyCode is not supported');
    }
    const gradeSource = enumValue(
        body.gradeSource,
        'gradeSource',
        GRADE_SOURCES,
        normalizedGradeCode ? 'user' : 'unknown',
    );
    if (gradeSource === 'slab_label' && slabStatus !== 'slabbed') {
        throw new InputError('invalid_input', 'gradeSource slab_label requires slabStatus slabbed');
    }
    if (slabStatus !== 'slabbed' && gradingCompanyCode) {
        throw new InputError('invalid_input', 'gradingCompanyCode requires slabStatus slabbed');
    }
    return {
        slabStatus,
        gradingCompanyCode,
        gradingCompanyRaw: gradingCompanyCode,
        gradeSource,
        slabCertificateNumber: slabStatus === 'slabbed'
            ? text(body.slabCertificateNumber, 'slabCertificateNumber', 100) ?? null
            : null,
    };
}

function normalizeIdentificationEvidence(value, selectedTypeId) {
    if (value === undefined || value === null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new InputError('invalid_input', 'identificationEvidence must be an object');
    }
    if (!selectedTypeId) {
        throw new InputError('invalid_input', 'identificationEvidence requires typeId');
    }
    const catalogMatch = value.catalogMatch;
    if (!['exact', 'ambiguous', 'not_found'].includes(catalogMatch)) {
        throw new InputError('invalid_input', 'identificationEvidence.catalogMatch is invalid');
    }
    if (!Array.isArray(value.proposedTypeIds) || value.proposedTypeIds.length > 18) {
        throw new InputError('invalid_input', 'identificationEvidence.proposedTypeIds is invalid');
    }
    const parsedTypeIds = value.proposedTypeIds.map(
        (candidate) => positiveInteger(candidate, 'identificationEvidence.proposedTypeIds'),
    );
    if (parsedTypeIds.some((candidate) => !Number.isSafeInteger(candidate))) {
        throw new InputError('invalid_input', 'identificationEvidence.proposedTypeIds is invalid');
    }
    const proposedTypeIds = [...new Set(parsedTypeIds)];
    const decision = value.decision;
    if (!['accepted_top', 'selected_alternative'].includes(decision)) {
        throw new InputError('invalid_input', 'identificationEvidence.decision is invalid');
    }
    const selectedIndex = proposedTypeIds.indexOf(selectedTypeId);
    if (selectedIndex < 0) {
        throw new InputError('invalid_input', 'Selected type is absent from proposedTypeIds');
    }
    if (decision === 'accepted_top' && selectedIndex !== 0) {
        throw new InputError('invalid_input', 'accepted_top requires the first proposed type');
    }
    if (decision === 'selected_alternative' && selectedIndex === 0) {
        throw new InputError('invalid_input', 'selected_alternative requires a non-first type');
    }
    const extracted = value.extracted;
    if (!extracted || typeof extracted !== 'object' || Array.isArray(extracted)) {
        throw new InputError('invalid_input', 'identificationEvidence.extracted must be an object');
    }
    if (Buffer.byteLength(JSON.stringify(extracted), 'utf8') > 16384) {
        throw new InputError('invalid_input', 'identificationEvidence.extracted is too large');
    }
    return {
        strategy: text(value.strategy, 'identificationEvidence.strategy', 80) || 'qwen_single_pass_v1',
        catalogMatch,
        proposedTypeIds,
        decision,
        recognizedName: text(value.recognizedName, 'identificationEvidence.recognizedName', 200) ?? null,
        extracted,
    };
}

function normalizeCreatePayload(body = {}) {
    const typeId = positiveInteger(body.typeId, 'typeId') ?? null;
    const userLabel = text(body.userLabel, 'userLabel', 200) ?? null;
    if (!typeId && !userLabel) {
        throw new InputError('identity_required', 'typeId or userLabel is required');
    }

    const purchasePriceMinor = money(body.purchasePriceMinor, 'purchasePriceMinor') ?? null;
    let purchaseCurrency = currency(body.purchaseCurrency, 'purchaseCurrency') ?? null;
    if (purchasePriceMinor != null && purchaseCurrency == null) purchaseCurrency = 'RUB';
    if (purchasePriceMinor == null && purchaseCurrency != null) {
        throw new InputError('invalid_input', 'purchaseCurrency requires purchasePriceMinor');
    }

    const normalizedGradeCode = gradeCode(body.gradeCode) ?? null;
    return {
        typeId,
        issueId: positiveInteger(body.issueId, 'issueId') ?? null,
        identifiedYear: catalogYear(body.identifiedYear) ?? null,
        userLabel,
        gradeSystem: gradeSystem(body.gradeSystem) ?? null,
        gradeCode: normalizedGradeCode,
        ...slabCreateFields(body, normalizedGradeCode),
        purchasePriceMinor,
        purchaseCurrency,
        purchaseDate: isoDate(body.purchaseDate, 'purchaseDate') ?? null,
        purchaseSource: text(body.purchaseSource, 'purchaseSource', 300) ?? null,
        notes: text(body.notes, 'notes', 5000) ?? null,
        identificationEvidence: normalizeIdentificationEvidence(body.identificationEvidence, typeId),
    };
}

function normalizePatchPayload(body = {}) {
    const fields = {};
    const assign = (name, value) => { if (value !== undefined) fields[name] = value; };
    assign('typeId', positiveInteger(body.typeId, 'typeId'));
    assign('issueId', positiveInteger(body.issueId, 'issueId'));
    assign('identifiedYear', catalogYear(body.identifiedYear));
    assign('userLabel', text(body.userLabel, 'userLabel', 200));
    assign('gradeSystem', gradeSystem(body.gradeSystem));
    assign('gradeCode', gradeCode(body.gradeCode));
    if (body.slabStatus !== undefined) {
        Object.assign(fields, slabCreateFields(body, fields.gradeCode ?? null));
    } else if (
        body.gradingCompanyCode !== undefined
        || body.gradeSource !== undefined
        || body.slabCertificateNumber !== undefined
    ) {
        throw new InputError('invalid_input', 'slabStatus is required when slab fields are changed');
    } else if (fields.gradeCode !== undefined) {
        fields.gradeSource = fields.gradeCode == null ? 'unknown' : 'user';
    }
    assign('purchasePriceMinor', money(body.purchasePriceMinor, 'purchasePriceMinor'));
    assign('purchaseCurrency', currency(body.purchaseCurrency, 'purchaseCurrency'));
    assign('purchaseDate', isoDate(body.purchaseDate, 'purchaseDate'));
    assign('purchaseSource', text(body.purchaseSource, 'purchaseSource', 300));
    assign('notes', text(body.notes, 'notes', 5000));

    if (fields.purchasePriceMinor != null && fields.purchaseCurrency === undefined) {
        fields.purchaseCurrency = 'RUB';
    }
    if (fields.purchasePriceMinor === null) fields.purchaseCurrency = null;
    if (fields.gradeCode === null) fields.gradeSystem = null;
    if (Object.keys(fields).length === 0) throw new InputError('empty_patch', 'No supported fields supplied');
    return fields;
}

function normalizeSoldPayload(body = {}, today = () => new Date().toISOString().slice(0, 10)) {
    const soldPriceMinor = money(body.soldPriceMinor, 'soldPriceMinor') ?? null;
    let soldCurrency = currency(body.soldCurrency, 'soldCurrency') ?? null;
    if (soldPriceMinor != null && soldCurrency == null) soldCurrency = 'RUB';
    if (soldPriceMinor == null && soldCurrency != null) {
        throw new InputError('invalid_input', 'soldCurrency requires soldPriceMinor');
    }
    return {
        soldPriceMinor,
        soldCurrency,
        soldAt: isoDate(body.soldAt === undefined ? today() : body.soldAt, 'soldAt'),
    };
}

function parseIdempotencyKey(value) {
    if (value === undefined || value === null || value === '') return null;
    return text(String(value), 'Idempotency-Key', 200, { nullable: false }).length >= 8
        ? text(String(value), 'Idempotency-Key', 200, { nullable: false })
        : (() => { throw new InputError('invalid_idempotency_key', 'Idempotency-Key is too short'); })();
}

function encodeCursor(row) {
    return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id }), 'utf8').toString('base64url');
}

function decodeCursor(value) {
    if (!value) return null;
    try {
        const decoded = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
        if (!decoded.createdAt || !/^\d{4}-\d{2}-\d{2}T/.test(String(decoded.createdAt))) throw new Error();
        return { createdAt: decoded.createdAt, id: uuid(String(decoded.id), 'cursor.id') };
    } catch (_) {
        throw new InputError('invalid_cursor', 'Cursor is invalid');
    }
}

function parseListQuery(query = {}) {
    const limitValue = query.limit === undefined ? 30 : Number(query.limit);
    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) {
        throw new InputError('invalid_limit', 'limit must be between 1 and 100');
    }
    const status = query.status ? String(query.status) : null;
    if (status && !ITEM_STATUSES.has(status)) throw new InputError('invalid_filter', 'status is invalid');
    const identification = query.identification ? String(query.identification) : null;
    if (identification && !IDENTIFICATION_STATUSES.has(identification)) {
        throw new InputError('invalid_filter', 'identification is invalid');
    }
    return {
        limit: limitValue,
        cursor: decodeCursor(query.cursor),
        status,
        identification,
        typeId: query.typeId === undefined ? null : positiveInteger(query.typeId, 'typeId'),
        q: query.q ? text(String(query.q), 'q', 200, { nullable: false }) : null,
    };
}

module.exports = {
    InputError,
    decodeCursor,
    encodeCursor,
    normalizeCreatePayload,
    normalizePatchPayload,
    normalizeSoldPayload,
    parseIdempotencyKey,
    parseListQuery,
    uuid,
};
