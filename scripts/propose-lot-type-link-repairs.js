'use strict';

const { pool } = require('../catalog/db');
const { matchType, parseTitle } = require('../catalog/coin-matcher');
const { auditLotTypeLink } = require('../domain/identity-link-quality');

function parseOptions(argv) {
    const read = (name, fallback) => {
        const prefix = `--${name}=`;
        const found = argv.find((value) => value.startsWith(prefix));
        return found ? found.slice(prefix.length) : fallback;
    };
    const limit = Number(read('limit', '100'));
    const reason = read('reason', 'denomination');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error('--limit must be 1..1000');
    }
    if (!['denomination', 'year', 'mint', 'any'].includes(reason)) {
        throw new Error('--reason must be denomination, year, mint or any');
    }
    return {
        limit,
        reason,
        details: argv.includes('--details'),
        summaryOnly: argv.includes('--summary-only'),
        highConfidenceOnly: argv.includes('--high-confidence-only'),
        pure: argv.includes('--pure'),
    };
}

function reasonSql(reason) {
    if (reason === 'denomination') {
        return `(lq.reasons ? 'denomination_unit_mismatch'
            OR lq.reasons ? 'denomination_value_mismatch')`;
    }
    if (reason === 'year') return `lq.reasons ? 'year_mismatch'`;
    if (reason === 'mint') return `lq.reasons ? 'mint_mismatch'`;
    return 'TRUE';
}

async function loadConflicts(options) {
    const result = await pool.query(
        `SELECT lq.lot_id,
                lq.type_id,
                lq.reasons,
                al.coin_description,
                al.winning_bid,
                al.currency,
                al.source_site,
                al.auction_end_date,
                ltl.match_method,
                ltl.match_confidence,
                ct.name_full AS current_type_name,
                ct.country AS current_type_country,
                ct.era AS current_type_era
         FROM lot_type_link_quality lq
         JOIN lot_type_link ltl
           ON ltl.lot_id = lq.lot_id
          AND ltl.type_id = lq.type_id
         JOIN auction_lots al ON al.id = lq.lot_id
         JOIN coin_type ct ON ct.id = lq.type_id
         WHERE lq.audit_version = 'hard-consistency-v1'
           AND lq.status = 'conflict'
           AND ${reasonSql(options.reason)}
           AND (NOT $2::boolean OR lq.reasons = '["year_mismatch"]'::jsonb)
         ORDER BY al.winning_bid DESC NULLS LAST, lq.lot_id
         LIMIT $1`,
        [options.limit, options.pure],
    );
    return result.rows;
}

async function loadType(typeId) {
    const result = await pool.query(
        `SELECT id,
                name_full,
                country,
                year,
                coin_year,
                year_start,
                year_end,
                denomination_text,
                denomination_value,
                mint
         FROM coin_type
         WHERE id = $1`,
        [typeId],
    );
    return result.rows[0] || null;
}

function auditCandidate(parsed, type) {
    return auditLotTypeLink({
        lot: parsed,
        type: {
            name: type.name_full,
            country: type.country,
            year: type.year,
            coinYear: type.coin_year,
            yearStart: type.year_start,
            yearEnd: type.year_end,
            denominationText: type.denomination_text,
            denominationValue: type.denomination_value,
            mint: type.mint,
        },
    });
}

async function propose(row) {
    const parsed = parseTitle(row.coin_description);
    const base = {
        lotId: Number(row.lot_id),
        description: row.coin_description,
        price: row.winning_bid == null ? null : Number(row.winning_bid),
        currency: row.currency,
        source: row.source_site,
        soldAt: row.auction_end_date,
        currentTypeId: Number(row.type_id),
        currentTypeName: row.current_type_name,
        currentTypeCountry: row.current_type_country,
        currentTypeEra: row.current_type_era,
        currentReasons: row.reasons,
        currentMatchMethod: row.match_method,
        currentMatchConfidence: row.match_confidence == null ? null : Number(row.match_confidence),
    };
    if (parsed.isNonCoin) return { ...base, action: 'unlink_noncoin_candidate' };

    const matched = await matchType(pool, parsed);
    if (!matched) return { ...base, action: 'unresolved' };
    if (Number(matched.id) === Number(row.type_id)) {
        return {
            ...base,
            action: 'matcher_reconfirms_current',
            proposedConfidence: Number(matched.conf),
        };
    }

    const proposedType = await loadType(Number(matched.id));
    if (!proposedType) return { ...base, action: 'unresolved' };
    const quality = auditCandidate(parsed, proposedType);
    const confidence = Number(matched.conf);
    let action = 'proposed_type_conflicts';
    if (quality.status !== 'conflict') {
        action = confidence >= 0.8
            ? 'high_confidence_review_candidate'
            : 'manual_review_candidate';
    }
    return {
        ...base,
        action,
        proposedTypeId: Number(proposedType.id),
        proposedTypeName: proposedType.name_full,
        proposedTypeCountry: proposedType.country,
        proposedTypeYear: proposedType.year,
        proposedTypeYearStart: proposedType.year_start,
        proposedTypeYearEnd: proposedType.year_end,
        proposedTypeDenomination: proposedType.denomination_text,
        proposedTypeMint: proposedType.mint,
        proposedConfidence: confidence,
        proposedAuditStatus: quality.status,
        proposedAuditReasons: quality.reasons,
        proposedAuditEvidence: quality.evidence,
    };
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    const rows = await loadConflicts(options);
    const proposals = [];
    const byAction = {};
    for (let index = 0; index < rows.length; index++) {
        const proposal = await propose(rows[index]);
        proposals.push(proposal);
        byAction[proposal.action] = (byAction[proposal.action] || 0) + 1;
        if ((index + 1) % 25 === 0) console.error(`processed=${index + 1}`);
    }
    const visible = options.highConfidenceOnly
        ? proposals.filter((proposal) => proposal.action === 'high_confidence_review_candidate')
        : proposals.filter((proposal) => proposal.action !== 'matcher_reconfirms_current');
    const review = options.summaryOnly ? [] : (options.details ? visible : visible.slice(0, 30));
    console.log(JSON.stringify({
        summary: {
            mode: 'dry-run',
            reason: options.reason,
            selected: rows.length,
            byAction,
        },
        review,
    }, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    }).finally(() => pool.end());
}

module.exports = { auditCandidate, parseOptions, reasonSql };
