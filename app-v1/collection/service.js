'use strict';

const crypto = require('node:crypto');
const { encodeCursor } = require('./validation');

class CollectionError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'CollectionError';
        this.status = status;
        this.code = code;
    }
}

const ITEM_SELECT = `
    SELECT ci.*,
           ct.name_full catalog_name,
           ct.year catalog_year,
           ct.country catalog_country,
           ct.era catalog_era,
           ct.metal catalog_metal,
           ct.mint catalog_mint,
           ct.image_url catalog_image_url,
           ct.cbr_cat_num catalog_cbr_number,
           ct.bitkin_number catalog_bitkin_number,
           latest_valuation.id valuation_id,
           latest_valuation.currency valuation_currency,
           latest_valuation.low_minor valuation_low_minor,
           latest_valuation.median_minor valuation_median_minor,
           latest_valuation.high_minor valuation_high_minor,
           latest_valuation.grade_code valuation_grade_code,
           latest_valuation.comparable_count valuation_comparable_count,
           latest_valuation.confidence valuation_confidence,
           latest_valuation.status valuation_status,
           latest_valuation.abstain_reason valuation_abstain_reason,
           latest_valuation.calculated_at valuation_calculated_at
    FROM collection_item ci
    LEFT JOIN coin_type ct ON ct.id = ci.type_id
    LEFT JOIN LATERAL (
        SELECT cv.*
        FROM collection_valuation cv
        WHERE cv.item_id = ci.id
        ORDER BY cv.calculated_at DESC, cv.id DESC
        LIMIT 1
    ) latest_valuation ON true`;

function itemFromRow(row) {
    return {
        id: row.id,
        typeId: row.type_id,
        typeName: row.catalog_name || row.type_name_snapshot || null,
        userLabel: row.user_label,
        identificationStatus: row.identification_status,
        gradeSystem: row.grade_system,
        gradeCode: row.grade_code,
        purchasePriceMinor: row.purchase_price_minor == null ? null : Number(row.purchase_price_minor),
        purchaseCurrency: row.purchase_currency,
        purchaseDate: row.purchase_date,
        purchaseSource: row.purchase_source,
        notes: row.notes,
        status: row.status,
        soldPriceMinor: row.sold_price_minor == null ? null : Number(row.sold_price_minor),
        soldCurrency: row.sold_currency,
        soldAt: row.sold_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        catalog: row.type_id == null ? null : {
            year: row.catalog_year,
            country: row.catalog_country,
            era: row.catalog_era,
            metal: row.catalog_metal,
            mint: row.catalog_mint,
            imageUrl: row.catalog_image_url,
            cbrNumber: row.catalog_cbr_number,
            bitkinNumber: row.catalog_bitkin_number,
        },
        valuation: row.valuation_id == null ? null : {
            id: row.valuation_id,
            currency: row.valuation_currency,
            lowMinor: row.valuation_low_minor == null ? null : Number(row.valuation_low_minor),
            medianMinor: row.valuation_median_minor == null ? null : Number(row.valuation_median_minor),
            highMinor: row.valuation_high_minor == null ? null : Number(row.valuation_high_minor),
            gradeCode: row.valuation_grade_code,
            comparableCount: Number(row.valuation_comparable_count),
            confidence: row.valuation_confidence == null ? null : Number(row.valuation_confidence),
            status: row.valuation_status,
            abstainReason: row.valuation_abstain_reason,
            calculatedAt: row.valuation_calculated_at,
        },
    };
}

function translateDatabaseError(error) {
    if (error instanceof CollectionError) return error;
    if (error.code === '23503') return new CollectionError(404, 'type_not_found', 'Catalog type not found');
    if (error.code === '23514' || error.code === '22P02') {
        return new CollectionError(400, 'invalid_item', 'Collection item violates data constraints');
    }
    return error;
}

class CollectionItemService {
    constructor({ pool, enqueueValuation = async () => {} }) {
        if (!pool || typeof pool.query !== 'function') throw new TypeError('A pg-compatible pool is required');
        this.pool = pool;
        this.enqueueValuation = enqueueValuation;
    }

    queueValuation(itemId) {
        Promise.resolve()
            .then(() => this.enqueueValuation({ itemId }))
            .catch((error) => console.error('[collection-valuation] enqueue failed:', error.message));
    }

    async get(userId, itemId, { includeDeleted = false } = {}) {
        const deletedClause = includeDeleted ? '' : 'AND ci.deleted_at IS NULL';
        const result = await this.pool.query(
            `${ITEM_SELECT} WHERE ci.user_id = $1 AND ci.id = $2 ${deletedClause}`,
            [userId, itemId],
        );
        if (!result.rows[0]) throw new CollectionError(404, 'item_not_found', 'Collection item not found');
        return itemFromRow(result.rows[0]);
    }

    async list(userId, filters) {
        const params = [userId];
        const where = ['ci.user_id = $1', 'ci.deleted_at IS NULL'];
        const add = (value) => { params.push(value); return `$${params.length}`; };

        if (filters.status) where.push(`ci.status = ${add(filters.status)}`);
        if (filters.identification) where.push(`ci.identification_status = ${add(filters.identification)}`);
        if (filters.typeId) where.push(`ci.type_id = ${add(filters.typeId)}`);
        if (filters.q) {
            const param = add(`%${filters.q}%`);
            where.push(`(ci.user_label ILIKE ${param} OR ci.type_name_snapshot ILIKE ${param} OR ct.name_full ILIKE ${param})`);
        }
        if (filters.cursor) {
            const created = add(filters.cursor.createdAt);
            const id = add(filters.cursor.id);
            where.push(`(ci.created_at, ci.id) < (${created}::timestamptz, ${id}::uuid)`);
        }
        params.push(filters.limit + 1);

        const result = await this.pool.query(
            `${ITEM_SELECT}
             WHERE ${where.join(' AND ')}
             ORDER BY ci.created_at DESC, ci.id DESC
             LIMIT $${params.length}`,
            params,
        );
        const hasMore = result.rows.length > filters.limit;
        const rows = hasMore ? result.rows.slice(0, filters.limit) : result.rows;
        return {
            items: rows.map(itemFromRow),
            nextCursor: hasMore ? encodeCursor(rows.at(-1)) : null,
        };
    }

    async create(userId, input, idempotencyKey) {
        try {
            const result = await this.pool.query(
                `INSERT INTO collection_item (
                    id, user_id, type_id, user_label, grade_system, grade_code,
                    purchase_price_minor, purchase_currency, purchase_date,
                    purchase_source, notes, created_idempotency_key
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                 ON CONFLICT (user_id, created_idempotency_key)
                    WHERE created_idempotency_key IS NOT NULL
                 DO UPDATE SET created_idempotency_key = EXCLUDED.created_idempotency_key
                 RETURNING id, (xmax = 0) inserted`,
                [
                    crypto.randomUUID(), userId, input.typeId, input.userLabel,
                    input.gradeSystem, input.gradeCode, input.purchasePriceMinor,
                    input.purchaseCurrency, input.purchaseDate, input.purchaseSource,
                    input.notes, idempotencyKey,
                ],
            );
            const created = result.rows[0].inserted === true || result.rows[0].inserted === 't';
            const item = await this.get(userId, result.rows[0].id);
            if (created) this.queueValuation(item.id);
            return { item, created };
        } catch (error) {
            throw translateDatabaseError(error);
        }
    }

    async patch(userId, itemId, changes) {
        const columns = {
            typeId: 'type_id',
            userLabel: 'user_label',
            gradeSystem: 'grade_system',
            gradeCode: 'grade_code',
            purchasePriceMinor: 'purchase_price_minor',
            purchaseCurrency: 'purchase_currency',
            purchaseDate: 'purchase_date',
            purchaseSource: 'purchase_source',
            notes: 'notes',
        };
        const params = [];
        const assignments = [];
        for (const [field, value] of Object.entries(changes)) {
            params.push(value);
            assignments.push(`${columns[field]} = $${params.length}`);
        }
        params.push(userId, itemId);
        try {
            const result = await this.pool.query(
                `UPDATE collection_item
                 SET ${assignments.join(', ')}, updated_at = now()
                 WHERE user_id = $${params.length - 1} AND id = $${params.length}
                   AND deleted_at IS NULL
                 RETURNING id`,
                params,
            );
            if (!result.rows[0]) throw new CollectionError(404, 'item_not_found', 'Collection item not found');
            const item = await this.get(userId, itemId);
            if (['typeId', 'gradeSystem', 'gradeCode'].some((field) => Object.hasOwn(changes, field))) {
                this.queueValuation(itemId);
            }
            return item;
        } catch (error) {
            throw translateDatabaseError(error);
        }
    }

    async remove(userId, itemId) {
        const result = await this.pool.query(
            `UPDATE collection_item SET deleted_at = now(), updated_at = now()
             WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL
             RETURNING id`,
            [userId, itemId],
        );
        if (!result.rows[0]) throw new CollectionError(404, 'item_not_found', 'Collection item not found');
    }

    async restore(userId, itemId) {
        const result = await this.pool.query(
            `UPDATE collection_item SET deleted_at = NULL, updated_at = now()
             WHERE user_id = $1 AND id = $2
               AND deleted_at >= now() - interval '30 days'
             RETURNING id`,
            [userId, itemId],
        );
        if (!result.rows[0]) throw new CollectionError(404, 'restorable_item_not_found', 'Restorable item not found');
        const item = await this.get(userId, itemId);
        this.queueValuation(itemId);
        return item;
    }

    async markSold(userId, itemId, sold) {
        const result = await this.pool.query(
            `UPDATE collection_item
             SET status = 'sold', sold_price_minor = $3, sold_currency = $4,
                 sold_at = $5, updated_at = now()
             WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL
             RETURNING id`,
            [userId, itemId, sold.soldPriceMinor, sold.soldCurrency, sold.soldAt],
        );
        if (!result.rows[0]) throw new CollectionError(404, 'item_not_found', 'Collection item not found');
        return this.get(userId, itemId);
    }

    async archive(userId, itemId) {
        const current = await this.get(userId, itemId);
        if (current.status === 'archived') return current;
        if (current.status !== 'active') {
            throw new CollectionError(409, 'invalid_status', 'Only an active item can be archived');
        }
        await this.pool.query(
            `UPDATE collection_item SET status = 'archived', updated_at = now()
             WHERE user_id = $1 AND id = $2 AND status = 'active' AND deleted_at IS NULL`,
            [userId, itemId],
        );
        return this.get(userId, itemId);
    }

    async activate(userId, itemId) {
        const current = await this.get(userId, itemId);
        if (current.status === 'active') return current;
        await this.pool.query(
            `UPDATE collection_item
             SET status = 'active', sold_price_minor = NULL, sold_currency = NULL,
                 sold_at = NULL, updated_at = now()
             WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
            [userId, itemId],
        );
        return this.get(userId, itemId);
    }

    async summary(userId) {
        const counts = await this.pool.query(
            `WITH owned AS (
                SELECT type_id, status, identification_status
                FROM collection_item
                WHERE user_id = $1 AND deleted_at IS NULL
             ), duplicates AS (
                SELECT COALESCE(sum(n - 1), 0)::int count
                FROM (SELECT count(*) n FROM owned WHERE type_id IS NOT NULL GROUP BY type_id) grouped
             )
             SELECT count(*)::int total,
                    count(*) FILTER (WHERE status = 'active')::int active,
                    count(*) FILTER (WHERE status = 'sold')::int sold,
                    count(*) FILTER (WHERE status = 'archived')::int archived,
                    count(*) FILTER (WHERE identification_status <> 'linked')::int unlinked,
                    count(DISTINCT type_id)::int distinct_types,
                    (SELECT count FROM duplicates) duplicates
             FROM owned`,
            [userId],
        );
        const totals = await this.pool.query(
            `SELECT purchase_currency currency, sum(purchase_price_minor)::bigint amount_minor
             FROM collection_item
             WHERE user_id = $1 AND deleted_at IS NULL
               AND purchase_price_minor IS NOT NULL AND purchase_currency IS NOT NULL
             GROUP BY purchase_currency ORDER BY purchase_currency`,
            [userId],
        );
        const valuationTotals = await this.pool.query(
            `WITH active_owned AS (
                SELECT id
                FROM collection_item
                WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL
             ), latest AS (
                SELECT owned.id item_id, cv.status, cv.low_minor, cv.median_minor, cv.high_minor
                FROM active_owned owned
                LEFT JOIN LATERAL (
                    SELECT status, low_minor, median_minor, high_minor
                    FROM collection_valuation
                    WHERE item_id = owned.id
                    ORDER BY calculated_at DESC, id DESC
                    LIMIT 1
                ) cv ON true
             )
             SELECT count(*) FILTER (WHERE status = 'ready')::int valued,
                    count(*) FILTER (WHERE status IS DISTINCT FROM 'ready')::int unvalued,
                    sum(low_minor) FILTER (WHERE status = 'ready')::bigint low_minor,
                    sum(median_minor) FILTER (WHERE status = 'ready')::bigint median_minor,
                    sum(high_minor) FILTER (WHERE status = 'ready')::bigint high_minor
             FROM latest`,
            [userId],
        );
        const count = counts.rows[0];
        const valued = valuationTotals.rows[0];
        return {
            total: count.total,
            active: count.active,
            sold: count.sold,
            archived: count.archived,
            unlinked: count.unlinked,
            distinctTypes: count.distinct_types,
            duplicates: count.duplicates,
            purchaseTotals: totals.rows.map((row) => ({
                currency: row.currency,
                amountMinor: Number(row.amount_minor),
            })),
            valuation: {
                currency: 'RUB',
                valuedCount: valued.valued,
                unvaluedCount: valued.unvalued,
                lowMinor: valued.low_minor == null ? null : Number(valued.low_minor),
                medianMinor: valued.median_minor == null ? null : Number(valued.median_minor),
                highMinor: valued.high_minor == null ? null : Number(valued.high_minor),
            },
        };
    }
}

module.exports = {
    CollectionError,
    CollectionItemService,
    itemFromRow,
    translateDatabaseError,
};
