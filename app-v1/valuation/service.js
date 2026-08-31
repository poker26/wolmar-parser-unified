'use strict';

const { safeRecorder } = require('../analytics/service');
const { valuationPresentation } = require('../../valuation-service');

class ValuationError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'ValuationError';
        this.status = status;
        this.code = code;
    }
}

function valuationFromRow(row) {
    const comparableCount = Number(row.comparable_count);
    const presentation = valuationPresentation({
        status: row.status,
        comparableCount,
        method: row.method,
        low: row.low_minor,
        high: row.high_minor,
        estimateKind: row.basis?.estimateKind,
        rangeAvailable: row.basis?.rangeAvailable,
    });
    return {
        id: row.id,
        itemId: row.item_id,
        currency: row.currency,
        lowMinor: presentation.rangeAvailable && row.low_minor != null ? Number(row.low_minor) : null,
        medianMinor: row.median_minor == null ? null : Number(row.median_minor),
        highMinor: presentation.rangeAvailable && row.high_minor != null ? Number(row.high_minor) : null,
        gradeCode: row.grade_code,
        comparableCount,
        confidence: row.confidence == null ? null : Number(row.confidence),
        status: row.status,
        method: row.method,
        modelVersion: row.model_version,
        abstainReason: row.abstain_reason,
        ...presentation,
        calculatedAt: row.calculated_at,
    };
}

class CollectionValuationService {
    constructor({ pool, calculateRecalculation = null, analytics = null }) {
        if (!pool || typeof pool.query !== 'function') throw new TypeError('A pg-compatible pool is required');
        this.pool = pool;
        this.calculateRecalculation = calculateRecalculation
            || ((input) => require('./calculator').calculateCollectionValuation(input, { pool, analytics }));
        this.recordEvent = safeRecorder(analytics);
    }

    async assertItem(userId, itemId) {
        const result = await this.pool.query(
            `SELECT id FROM collection_item
             WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
            [userId, itemId],
        );
        if (!result.rows[0]) throw new ValuationError(404, 'item_not_found', 'Collection item not found');
    }

    async latest(userId, itemId) {
        await this.assertItem(userId, itemId);
        const result = await this.pool.query(
            `SELECT cv.*
             FROM collection_valuation cv
             JOIN collection_item ci ON ci.id = cv.item_id
             WHERE cv.item_id = $1
               AND (ci.valuation_invalidated_at IS NULL
                    OR cv.calculated_at >= ci.valuation_invalidated_at)
             ORDER BY cv.calculated_at DESC, cv.id DESC
             LIMIT 1`,
            [itemId],
        );
        const valuation = result.rows[0] ? valuationFromRow(result.rows[0]) : null;
        if (valuation) {
            await this.recordEvent({
                userId,
                eventName: 'collection_valuation_viewed',
                properties: { status: valuation.status },
                sourceId: valuation.id,
            });
        }
        return valuation;
    }

    async history(userId, itemId, limit = 20) {
        await this.assertItem(userId, itemId);
        const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
        const result = await this.pool.query(
            `SELECT cv.*
             FROM collection_valuation cv
             WHERE cv.item_id = $1
             ORDER BY cv.calculated_at DESC, cv.id DESC
             LIMIT $2`,
            [itemId, safeLimit],
        );
        return result.rows.map(valuationFromRow);
    }

    async comparables(userId, itemId, valuationId = null) {
        await this.assertItem(userId, itemId);
        const params = [itemId];
        const valuationFilter = valuationId ? `AND cv.id = $${params.push(valuationId)}` : '';
        const snapshot = await this.pool.query(
            `SELECT cv.id, cv.basis
             FROM collection_valuation cv
             JOIN collection_item ci ON ci.id = cv.item_id
             WHERE cv.item_id = $1 ${valuationFilter}
               AND (ci.valuation_invalidated_at IS NULL
                    OR cv.calculated_at >= ci.valuation_invalidated_at)
             ORDER BY cv.calculated_at DESC, cv.id DESC
             LIMIT 1`,
            params,
        );
        if (!snapshot.rows[0]) return { valuationId: null, comparables: [] };
        const ids = Array.isArray(snapshot.rows[0].basis?.lotIds)
            ? snapshot.rows[0].basis.lotIds.filter(Number.isSafeInteger)
            : [];
        if (!ids.length) return { valuationId: snapshot.rows[0].id, comparables: [] };
        const result = await this.pool.query(
            `SELECT id, source_site source, auction_number, lot_number,
                    round(winning_bid * 100)::bigint price_minor,
                    COALESCE(NULLIF(currency, ''), 'RUB') currency,
                    condition grade, auction_end_date::date sold_at, source_url
             FROM auction_lots
             WHERE id = ANY($1::int[])
             ORDER BY auction_end_date DESC NULLS LAST, id DESC`,
            [ids],
        );
        return {
            valuationId: snapshot.rows[0].id,
            comparables: result.rows.map((row) => ({
                id: row.id,
                source: row.source,
                auctionNumber: row.auction_number,
                lotNumber: row.lot_number,
                priceMinor: Number(row.price_minor),
                currency: row.currency,
                grade: row.grade,
                soldAt: row.sold_at,
                sourceUrl: row.source_url,
            })),
        };
    }

    async recalculate(userId, itemId) {
        await this.assertItem(userId, itemId);
        const result = await this.calculateRecalculation({ itemId });
        if (!result?.snapshot) throw new ValuationError(404, 'item_not_found', 'Collection item not found');
        return valuationFromRow(result.snapshot);
    }
}

module.exports = {
    CollectionValuationService,
    ValuationError,
    valuationFromRow,
};
