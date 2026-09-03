#!/usr/bin/env node
'use strict';

// Узкий линкер только для уже импортированного пилотного Standart-аукциона.
// Общий coin-matcher используется как есть; массовые сироты не сканируются.
// По умолчанию dry-run. Запись включается только явным --apply.

const { pool } = require('./db');
const { parseTitle, matchType } = require('./coin-matcher');
const { auditLotTypeLink, resolveLotYear } = require('../domain/identity-link-quality');

function option(name, fallback) {
    const prefix = `--${name}=`;
    const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : fallback;
}

async function main() {
    const auctionNumber = option('auction', 's800');
    if (!/^s\d+$/.test(auctionNumber)) throw new Error(`Expected Standart auction number like s800, got ${auctionNumber}`);
    const apply = process.argv.includes('--apply');
    const lots = (await pool.query(
        `SELECT a.id, a.coin_description, a.year, a.condition
           FROM auction_lots a
           LEFT JOIN lot_type_link l ON l.lot_id = a.id
          WHERE a.source_site = 'wolmar.ru'
            AND a.auction_number = $1
            AND a.lot_status = 'closed'
            AND a.coin_description IS NOT NULL
            AND l.lot_id IS NULL
          ORDER BY a.lot_number::int`,
        [auctionNumber],
    )).rows;

    const stat = { checked: lots.length, proposed: 0, linked: 0 };
    const proposals = [];
    const matches = [];
    const conflicts = [];
    for (const lot of lots) {
        const parsed = parseTitle(lot.coin_description);
        if (parsed.isNonCoin) { stat.noncoin = (stat.noncoin || 0) + 1; continue; }
        if (parsed.isSet) { stat.set = (stat.set || 0) + 1; continue; }
        if (!parsed.denom) { stat.noDenomination = (stat.noDenomination || 0) + 1; continue; }
        if (!parsed.year && lot.year) parsed.year = Number(lot.year);
        if (!parsed.year) { stat.noYear = (stat.noYear || 0) + 1; continue; }

        const match = await matchType(pool, parsed).catch(() => null);
        if (!match) { stat.noMatch = (stat.noMatch || 0) + 1; continue; }
        stat.proposed++;
        proposals.push({ lot, parsed, match });
    }

    const typeIds = [...new Set(proposals.map(({ match }) => Number(match.id)))];
    const typeRows = typeIds.length ? (await pool.query(
        `SELECT id, name_full, country, year, coin_year, year_start, year_end,
                denomination_text, denomination_value, mint
           FROM coin_type
          WHERE id = ANY($1::int[])`,
        [typeIds],
    )).rows : [];
    const types = new Map(typeRows.map((row) => [Number(row.id), row]));

    for (const { lot, parsed, match } of proposals) {
        const type = types.get(Number(match.id));
        if (!type) { stat.missingType = (stat.missingType || 0) + 1; continue; }
        const resolvedYear = resolveLotYear({
            parsedYear: parsed.year,
            storedYear: lot.year,
            description: lot.coin_description,
        });
        const quality = auditLotTypeLink({
            lot: { ...parsed, year: resolvedYear.year },
            type,
        });
        if (quality.status === 'conflict') {
            stat.hardConflict = (stat.hardConflict || 0) + 1;
            conflicts.push({
                lotId: lot.id,
                description: lot.coin_description,
                typeId: match.id,
                typeName: type.name_full,
                reasons: quality.reasons,
            });
            continue;
        }
        stat.linked++;
        stat[`era_${match.era || 'unknown'}`] = (stat[`era_${match.era || 'unknown'}`] || 0) + 1;
        matches.push({ lotId: lot.id, description: lot.coin_description, typeId: match.id, confidence: match.conf, era: match.era });
        if (apply) {
            await pool.query(
                `INSERT INTO lot_type_link (lot_id, type_id, grade, match_method, match_confidence)
                 VALUES ($1, $2, $3, 'wolmar-standart', $4)
                 ON CONFLICT (lot_id) DO NOTHING`,
                [lot.id, match.id, lot.condition || null, match.conf],
            );
        }
    }

    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', auctionNumber, stat, conflicts, matches }, null, 2));
}

main()
    .then(() => pool.end())
    .catch(async (error) => {
        console.error(error.stack || error.message);
        try { await pool.end(); } catch (_) {}
        process.exitCode = 1;
    });
