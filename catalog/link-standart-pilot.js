#!/usr/bin/env node
'use strict';

// Узкий линкер только для уже импортированного пилотного Standart-аукциона.
// Общий coin-matcher используется как есть; массовые сироты не сканируются.
// По умолчанию dry-run. Запись включается только явным --apply.

const { pool } = require('./db');
const { parseTitle, matchType } = require('./coin-matcher');

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

    const stat = { checked: lots.length, linked: 0 };
    const matches = [];
    for (const lot of lots) {
        const parsed = parseTitle(lot.coin_description);
        if (parsed.isNonCoin) { stat.noncoin = (stat.noncoin || 0) + 1; continue; }
        if (parsed.isSet) { stat.set = (stat.set || 0) + 1; continue; }
        if (!parsed.denom) { stat.noDenomination = (stat.noDenomination || 0) + 1; continue; }
        if (!parsed.year && lot.year) parsed.year = Number(lot.year);
        if (!parsed.year) { stat.noYear = (stat.noYear || 0) + 1; continue; }

        const match = await matchType(pool, parsed).catch(() => null);
        if (!match) { stat.noMatch = (stat.noMatch || 0) + 1; continue; }
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

    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', auctionNumber, stat, matches }, null, 2));
}

main()
    .then(() => pool.end())
    .catch(async (error) => {
        console.error(error.stack || error.message);
        try { await pool.end(); } catch (_) {}
        process.exitCode = 1;
    });
