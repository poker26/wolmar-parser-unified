'use strict';

class ComparableRepository {
    constructor({ pool, sources = ['wolmar.ru', 'numismat.ru', 'meshok.net', 'auction.ru'] }) {
        if (!pool || typeof pool.query !== 'function') throw new TypeError('A pg-compatible pool is required');
        this.pool = pool;
        this.sources = sources;
    }

    async resolveTypeId(identityFallback) {
        const lotId = Number(identityFallback?.lotId);
        if (!Number.isSafeInteger(lotId) || lotId <= 0) return null;
        const result = await this.pool.query(
            `SELECT type_id FROM lot_type_link WHERE lot_id = $1 LIMIT 1`,
            [lotId],
        );
        return result.rows[0]?.type_id ? Number(result.rows[0].type_id) : null;
    }

    async findComparables(criteria) {
        const params = [criteria.typeId, this.sources, criteria.currency, criteria.valuationDate];
        const filters = [
            'ltl.type_id = $1',
            'al.source_site = ANY($2::text[])',
            "COALESCE(NULLIF(al.currency, ''), 'RUB') = $3",
            "al.lot_status = 'closed'",
            'al.auction_end_date IS NOT NULL',
            'al.auction_end_date <= $4',
            'al.winning_bid > 0',
        ];
        if (criteria.gradeCode) {
            params.push(criteria.gradeCode);
            filters.push(`collection_normalize_grade(COALESCE(
                NULLIF(al.slab_grade_code, ''), NULLIF(ltl.grade, ''), NULLIF(al.condition, '')
            )) = $${params.length}`);
        }
        if (criteria.slabStatus) {
            params.push(criteria.slabStatus);
            filters.push(`al.slab_status = $${params.length}`);
        }
        if (criteria.gradingCompanyCode) {
            params.push(criteria.gradingCompanyCode);
            filters.push(`al.grading_company_code = $${params.length}`);
        }
        const excludeLotId = Number(criteria.excludeLotId);
        if (Number.isSafeInteger(excludeLotId) && excludeLotId > 0) {
            params.push(excludeLotId);
            filters.push(`al.id <> $${params.length}`);
        }
        if (criteria.excludeAuctionNumber != null && String(criteria.excludeAuctionNumber).trim()) {
            params.push(String(criteria.excludeAuctionNumber));
            filters.push(`al.auction_number IS DISTINCT FROM $${params.length}`);
        }
        const limit = Number.isSafeInteger(criteria.limit) && criteria.limit > 0 ? criteria.limit : 250;
        params.push(limit);
        const result = await this.pool.query(
            `SELECT al.id AS lot_id,
                    al.winning_bid AS price,
                    al.auction_end_date AS sold_at,
                    al.metal,
                    al.weight,
                    al.fineness,
                    al.pure_metal_weight,
                    count(*) OVER()::int AS total_count
             FROM lot_type_link ltl
             JOIN auction_lots al ON al.id = ltl.lot_id
             WHERE ${filters.join('\n               AND ')}
             ORDER BY al.auction_end_date DESC, al.id DESC
             LIMIT $${params.length}`,
            params,
        );
        return {
            rows: result.rows.map((row) => ({
                lotId: Number(row.lot_id),
                price: Number(row.price),
                soldAt: row.sold_at,
                metal: row.metal,
                weight: row.weight == null ? null : Number(row.weight),
                fineness: row.fineness == null ? null : Number(row.fineness),
                pureMetalWeight: row.pure_metal_weight == null ? null : Number(row.pure_metal_weight),
            })),
            totalCount: Number(result.rows[0]?.total_count || 0),
        };
    }
}

module.exports = { ComparableRepository };
