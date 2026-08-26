'use strict';

const { safeRecorder } = require('../analytics/service');

class ValuationError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'ValuationError';
        this.status = status;
        this.code = code;
    }
}

function valuationFromRow(row) {
    return {
        id: row.id,
        itemId: row.item_id,
        currency: row.currency,
        lowMinor: row.low_minor == null ? null : Number(row.low_minor),
        medianMinor: row.median_minor == null ? null : Number(row.median_minor),
        highMinor: row.high_minor == null ? null : Number(row.high_minor),
        gradeCode: row.grade_code,
        comparableCount: Number(row.comparable_count),
        confidence: row.confidence == null ? null : Number(row.confidence),
        status: row.status,
        method: row.method,
        modelVersion: row.model_version,
        abstainReason: row.abstain_reason,
        calculatedAt: row.calculated_at,
    };
}

class CollectionValuationService {
    constructor({ pool, enqueueRecalculation = async () => {}, analytics = null }) {
        if (!pool || typeof pool.query !== 'function') throw new TypeError('A pg-compatible pool is required');
        this.pool = pool;
        this.enqueueRecalculation = enqueueRecalculation;
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
             WHERE cv.item_id = $1
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
             WHERE cv.item_id = $1 ${valuationFilter}
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
        return this.enqueueRecalculation({ itemId });
    }
}

module.exports = {
    CollectionValuationService,
    ValuationError,
    valuationFromRow,
};
