'use strict';

const { normalizeGrade } = require('./grade');
const {
    GRADING_COMPANY_CODES,
    GRADE_SOURCES,
    SLAB_STATUSES,
} = require('./slab-info');

const COMPANY_CODES = new Set(GRADING_COMPANY_CODES);
const GRADE_SOURCE_CODES = new Set(GRADE_SOURCES);
const SLAB_STATUS_CODES = new Set(SLAB_STATUSES);

const METHOD_VERSION = 'slab-aware-v1-shadow';
const MIN_COMPARABLES = 3;
const MAX_COMPARABLES = 250;
const DEFAULT_HALFLIFE_MONTHS = 6;
const MS_PER_MONTH = 2629746000;

function enumValue(value, allowed, fallback) {
    return typeof value === 'string' && allowed.has(value) ? value : fallback;
}

function valuationDate(value) {
    const parsed = value == null ? new Date() : new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new TypeError('valuationDate must be a valid date');
    return parsed;
}

function normalizeValuationInput(input = {}) {
    const typeId = Number(input.typeId);
    const company = input.gradingCompanyCode == null
        ? null
        : enumValue(input.gradingCompanyCode, COMPANY_CODES, null);
    return {
        typeId: Number.isSafeInteger(typeId) && typeId > 0 ? typeId : null,
        identityFallback: input.identityFallback && typeof input.identityFallback === 'object'
            ? { ...input.identityFallback }
            : null,
        gradeCode: normalizeGrade(input.gradeCode),
        gradeSource: enumValue(input.gradeSource, GRADE_SOURCE_CODES, 'unknown'),
        slabStatus: enumValue(input.slabStatus, SLAB_STATUS_CODES, 'unknown'),
        gradingCompanyCode: company,
        valuationDate: valuationDate(input.valuationDate),
        currency: typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : 'RUB',
    };
}

function level(levelName, input, overrides = {}) {
    return {
        level: levelName,
        gradeCode: input.gradeCode,
        slabStatus: input.slabStatus === 'unknown' ? null : input.slabStatus,
        gradingCompanyCode: input.gradingCompanyCode,
        expanded: false,
        ...overrides,
    };
}

function comparablePlan(input) {
    const plan = [];
    if (input.gradeCode) {
        if (input.slabStatus === 'slabbed' && input.gradingCompanyCode) {
            plan.push(level('same_company_and_grade', input));
            plan.push(level('same_slab_group', input, {
                gradingCompanyCode: null,
                expanded: true,
            }));
            plan.push(level('same_grade_market', input, {
                slabStatus: null,
                gradingCompanyCode: null,
                expanded: true,
            }));
        } else if (input.slabStatus !== 'unknown') {
            plan.push(level('same_grade_and_slab_status', input, {
                gradingCompanyCode: null,
            }));
            plan.push(level('same_grade_market', input, {
                slabStatus: null,
                gradingCompanyCode: null,
                expanded: true,
            }));
        } else {
            plan.push(level('same_grade_unknown_slab_status', input, {
                slabStatus: null,
                gradingCompanyCode: null,
                expanded: true,
            }));
        }
    } else if (input.slabStatus === 'slabbed' && input.gradingCompanyCode) {
        plan.push(level('same_company_unknown_grade', input, { gradeCode: null }));
        plan.push(level('same_slab_group_unknown_grade', input, {
            gradeCode: null,
            gradingCompanyCode: null,
            expanded: true,
        }));
        plan.push(level('type_market_unknown_grade', input, {
            gradeCode: null,
            slabStatus: null,
            gradingCompanyCode: null,
            expanded: true,
        }));
    } else if (input.slabStatus !== 'unknown') {
        plan.push(level('same_slab_status_unknown_grade', input, {
            gradeCode: null,
            gradingCompanyCode: null,
        }));
        plan.push(level('type_market_unknown_grade', input, {
            gradeCode: null,
            slabStatus: null,
            gradingCompanyCode: null,
            expanded: true,
        }));
    } else {
        plan.push(level('type_market_unknown_grade_and_slab', input, {
            gradeCode: null,
            slabStatus: null,
            gradingCompanyCode: null,
            expanded: true,
        }));
    }
    return plan;
}

function comparablePrice(row) {
    const value = Number(row.adjustedPrice ?? row.price ?? row.winning_bid);
    return Number.isFinite(value) && value > 0 ? value : null;
}

function recencyWeight(row, referenceDate, halflifeMonths) {
    const soldAt = new Date(row.soldAt ?? row.auction_end_date ?? referenceDate);
    const timestamp = Number.isFinite(soldAt.getTime()) ? soldAt.getTime() : referenceDate.getTime();
    const ageMonths = Math.max(0, (referenceDate.getTime() - timestamp) / MS_PER_MONTH);
    return Math.pow(0.5, ageMonths / halflifeMonths);
}

function weightedQuantile(rows, fraction, referenceDate, halflifeMonths = DEFAULT_HALFLIFE_MONTHS) {
    if (!(fraction >= 0 && fraction <= 1)) throw new RangeError('fraction must be between 0 and 1');
    const items = rows
        .map((row) => ({
            value: comparablePrice(row),
            weight: recencyWeight(row, referenceDate, halflifeMonths),
        }))
        .filter(({ value, weight }) => value != null && Number.isFinite(weight) && weight > 0)
        .sort((a, b) => a.value - b.value);
    if (!items.length) return null;
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    const threshold = totalWeight * fraction;
    let cumulative = 0;
    for (const item of items) {
        cumulative += item.weight;
        if (cumulative >= threshold) return Math.round(item.value);
    }
    return Math.round(items.at(-1).value);
}

function coefficientOfVariation(rows) {
    const values = rows.map(comparablePrice).filter((value) => value != null);
    if (!values.length) return null;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (!(mean > 0)) return null;
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
    return Math.sqrt(variance) / mean;
}

function confidenceFor({ basisLevel, count, expanded, input, rows }) {
    const variation = coefficientOfVariation(rows);
    if (expanded || !input.gradeCode || input.slabStatus === 'unknown') return 'low';
    if (basisLevel === 'same_company_and_grade' && count >= 10 && variation != null && variation <= 0.5) {
        return 'high';
    }
    if (count >= 5 && variation != null && variation <= 0.75) return 'medium';
    return 'low';
}

async function valuateCoin(rawInput, dependencies = {}) {
    if (typeof dependencies.findComparables !== 'function') {
        throw new TypeError('findComparables dependency is required');
    }
    const input = normalizeValuationInput(rawInput);
    if (input.currency !== 'RUB') {
        return {
            status: 'insufficient_data', low: null, median: null, high: null,
            confidence: 'low', basisLevel: null, exactComparableCount: 0,
            expandedComparableCount: 0, comparableLotIds: [],
            methodVersion: METHOD_VERSION, abstainReason: 'unsupported_currency',
        };
    }
    const resolvedTypeId = input.typeId || await dependencies.resolveTypeId?.(input.identityFallback);
    if (!resolvedTypeId) {
        return {
            status: 'insufficient_data', low: null, median: null, high: null,
            confidence: 'low', basisLevel: null, exactComparableCount: 0,
            expandedComparableCount: 0, comparableLotIds: [],
            methodVersion: METHOD_VERSION, abstainReason: 'identity_required',
        };
    }

    const plan = comparablePlan(input);
    let exactComparableCount = 0;
    let widest = { rows: [], totalCount: 0 };
    let selected = null;
    for (let index = 0; index < plan.length; index++) {
        const criteria = plan[index];
        const found = await dependencies.findComparables({
            ...criteria,
            typeId: resolvedTypeId,
            valuationDate: input.valuationDate,
            currency: input.currency,
            limit: dependencies.maxComparables || MAX_COMPARABLES,
            excludeLotId: input.identityFallback?.lotId || null,
        });
        let rows = Array.isArray(found?.rows) ? found.rows : [];
        let priceAdjustment = 'none';
        if (typeof dependencies.adjustComparables === 'function' && rows.length) {
            const adjusted = await dependencies.adjustComparables(rows, {
                typeId: resolvedTypeId,
                identityFallback: input.identityFallback,
                valuationDate: input.valuationDate,
            });
            rows = Array.isArray(adjusted?.rows) ? adjusted.rows : rows;
            priceAdjustment = adjusted?.method || priceAdjustment;
        }
        rows = rows.filter((row) => comparablePrice(row) != null);
        const totalCount = Number.isSafeInteger(found?.totalCount) ? found.totalCount : rows.length;
        if (index === 0) exactComparableCount = totalCount;
        widest = { rows, totalCount, criteria, priceAdjustment };
        if (rows.length >= (dependencies.minimumComparables || MIN_COMPARABLES)) {
            selected = widest;
            break;
        }
    }
    if (!selected) {
        return {
            status: 'insufficient_data', low: null, median: null, high: null,
            confidence: 'low', basisLevel: widest.criteria?.level || plan[0]?.level || null,
            exactComparableCount,
            expandedComparableCount: widest.totalCount,
            comparableLotIds: widest.rows.map((row) => Number(row.lotId ?? row.id)).filter(Number.isSafeInteger),
            methodVersion: METHOD_VERSION,
            priceAdjustment: widest.priceAdjustment || 'none',
            abstainReason: 'not_enough_comparable_sales',
        };
    }

    const halflife = Number(dependencies.recencyHalflifeMonths || DEFAULT_HALFLIFE_MONTHS);
    const lowerFraction = selected.criteria.expanded ? 0.10 : 0.25;
    const upperFraction = selected.criteria.expanded ? 0.90 : 0.75;
    return {
        status: 'ready',
        low: weightedQuantile(selected.rows, lowerFraction, input.valuationDate, halflife),
        median: weightedQuantile(selected.rows, 0.5, input.valuationDate, halflife),
        high: weightedQuantile(selected.rows, upperFraction, input.valuationDate, halflife),
        confidence: confidenceFor({
            basisLevel: selected.criteria.level,
            count: selected.rows.length,
            expanded: selected.criteria.expanded,
            input,
            rows: selected.rows,
        }),
        basisLevel: selected.criteria.level,
        exactComparableCount,
        expandedComparableCount: selected.totalCount,
        comparableLotIds: selected.rows.map((row) => Number(row.lotId ?? row.id)).filter(Number.isSafeInteger),
        methodVersion: METHOD_VERSION,
        priceAdjustment: selected.priceAdjustment,
        abstainReason: null,
    };
}

module.exports = {
    DEFAULT_HALFLIFE_MONTHS,
    MAX_COMPARABLES,
    METHOD_VERSION,
    MIN_COMPARABLES,
    comparablePlan,
    confidenceFor,
    normalizeValuationInput,
    valuateCoin,
    weightedQuantile,
};
