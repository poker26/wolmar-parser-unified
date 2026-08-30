'use strict';

const DEFAULT_PURITY = Object.freeze({ Au: 0.9, Ag: 0.9, Pt: 0.95, Pd: 0.95 });

function normalizeMetal(metal, composition = null) {
    const value = `${metal || ''} ${composition || ''}`.normalize('NFKC');
    if (/(?:\bAu\b|gold|золот)/iu.test(value)) return 'Au';
    if (/(?:\bAg\b|silver|серебр)/iu.test(value)) return 'Ag';
    if (/(?:\bPt\b|platinum|платин)/iu.test(value)) return 'Pt';
    if (/(?:\bPd\b|palladium|паллади)/iu.test(value)) return 'Pd';
    return null;
}

function compositionFineness(composition) {
    if (typeof composition !== 'string') return null;
    const decimal = composition.match(/(?:^|[^\d])(?:0)?[.,](\d{3})(?:[^\d]|$)/);
    if (decimal) return Number(decimal[1]);
    const perMille = composition.match(/(?:^|[^\d])(\d{3})(?:\s*\/\s*1000|\s*‰)(?:[^\d]|$)/u);
    if (perMille) return Number(perMille[1]);
    return null;
}

function pureWeight(profile, metalOverride = null) {
    const metal = metalOverride || normalizeMetal(profile?.metal, profile?.composition);
    if (!metal) return null;
    const direct = Number(profile?.pureMetalWeight ?? profile?.pure_metal_weight);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const mass = Number(profile?.mass ?? profile?.weight);
    if (!(mass > 0)) return null;
    const fineness = Number(profile?.fineness) || compositionFineness(profile?.composition);
    if (Number.isFinite(fineness) && fineness > 0) return mass * fineness / 1000;
    return mass * DEFAULT_PURITY[metal];
}

function dateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function priceForMetal(row, metal) {
    const column = { Au: 'gold_price', Ag: 'silver_price', Pt: 'platinum_price', Pd: 'palladium_price' }[metal];
    const value = Number(row?.[column]);
    return Number.isFinite(value) && value > 0 ? value : null;
}

class MetalAdjustment {
    constructor({ pool }) {
        if (!pool || typeof pool.query !== 'function') throw new TypeError('A pg-compatible pool is required');
        this.pool = pool;
    }

    async targetProfile(typeId, identityFallback) {
        const lotId = Number(identityFallback?.lotId);
        if (Number.isSafeInteger(lotId) && lotId > 0) {
            const result = await this.pool.query(
                `SELECT metal, weight, fineness, pure_metal_weight
                 FROM auction_lots WHERE id = $1`,
                [lotId],
            );
            if (result.rows[0]) return result.rows[0];
        }
        const result = await this.pool.query(
            `SELECT metal, mass, composition FROM coin_type WHERE id = $1`,
            [typeId],
        );
        return result.rows[0] || null;
    }

    async pricesByDate(dates) {
        const uniqueDates = [...new Set(dates.map(dateKey).filter(Boolean))];
        if (!uniqueDates.length) return new Map();
        const result = await this.pool.query(
            `WITH requested(date) AS (
                SELECT DISTINCT unnest($1::date[])
             )
             SELECT requested.date,
                    COALESCE(previous.gold_price, earliest.gold_price) AS gold_price,
                    COALESCE(previous.silver_price, earliest.silver_price) AS silver_price,
                    COALESCE(previous.platinum_price, earliest.platinum_price) AS platinum_price,
                    COALESCE(previous.palladium_price, earliest.palladium_price) AS palladium_price
             FROM requested
             LEFT JOIN LATERAL (
                 SELECT gold_price, silver_price, platinum_price, palladium_price
                 FROM metals_prices WHERE date <= requested.date ORDER BY date DESC LIMIT 1
             ) previous ON true
             LEFT JOIN LATERAL (
                 SELECT gold_price, silver_price, platinum_price, palladium_price
                 FROM metals_prices ORDER BY date ASC LIMIT 1
             ) earliest ON previous.gold_price IS NULL`,
            [uniqueDates],
        );
        return new Map(result.rows.map((row) => [dateKey(row.date), row]));
    }

    async adjust(rows, { typeId, identityFallback, valuationDate }) {
        const target = await this.targetProfile(typeId, identityFallback);
        const metal = normalizeMetal(target?.metal, target?.composition);
        const targetPureWeight = pureWeight(target, metal);
        if (!metal || !(targetPureWeight > 0)) return { rows, method: 'none_missing_target_metal' };
        const priceMap = await this.pricesByDate([valuationDate, ...rows.map((row) => row.soldAt)]);
        const targetMetalPrice = priceForMetal(priceMap.get(dateKey(valuationDate)), metal);
        if (!(targetMetalPrice > 0)) return { rows, method: 'none_missing_metal_price' };
        const targetMelt = targetPureWeight * targetMetalPrice;
        const adjusted = rows.map((row) => {
            const historicalPrice = priceForMetal(priceMap.get(dateKey(row.soldAt)), metal);
            const comparablePureWeight = pureWeight(row, metal);
            if (!(historicalPrice > 0) || !(comparablePureWeight > 0)) return row;
            const adjustedPrice = Number(row.price) + targetMelt - (comparablePureWeight * historicalPrice);
            return Number.isFinite(adjustedPrice) && adjustedPrice > 0
                ? { ...row, adjustedPrice }
                : row;
        });
        const adjustedCount = adjusted.filter((row) => row.adjustedPrice != null).length;
        return {
            rows: adjusted,
            method: adjustedCount ? 'historical_melt_delta' : 'none_missing_comparable_metal',
        };
    }
}

module.exports = {
    DEFAULT_PURITY,
    MetalAdjustment,
    compositionFineness,
    normalizeMetal,
    pureWeight,
};
