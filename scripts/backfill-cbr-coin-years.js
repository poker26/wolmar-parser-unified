'use strict';

const { execFileSync } = require('node:child_process');
const { pool } = require('../catalog/db');
const { parseCbrCardMetadata } = require('../catalog/cbr-card');

const BASE = 'https://www.cbr.ru/cash_circulation/memorable_coins/coins_base/ShowCoins/';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';

function parseOptions(argv) {
    const read = (name, fallback) => {
        const prefix = `--${name}=`;
        const found = argv.find((value) => value.startsWith(prefix));
        return found ? found.slice(prefix.length) : fallback;
    };
    const limit = Number(read('limit', '2000'));
    const delayMs = Number(read('delay-ms', '150'));
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error('--limit must be 1..10000');
    if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 10000) throw new Error('--delay-ms must be 0..10000');
    return {
        all: argv.includes('--all'),
        delayMs,
        limit,
        write: argv.includes('--write') && argv.includes('--confirmed'),
    };
}

function sleep(ms) {
    return ms ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function isoDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

function fetchCard(catalogNumber) {
    if (!/^\d{4}-\d{4}$/u.test(catalogNumber)) throw new Error(`invalid CBR catalog number: ${catalogNumber}`);
    return execFileSync('curl', [
        '--fail', '--silent', '--show-error', '--location',
        '--user-agent', UA,
        `${BASE}?cat_num=${catalogNumber}`,
    ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

async function loadTypes(options) {
    return (await pool.query(
        `SELECT DISTINCT ct.id, ct.cbr_cat_num, ct.year, ct.issue_date, ct.coin_year
         FROM coin_type ct
         WHERE ct.source = 'cbr'
           AND ct.cbr_cat_num IS NOT NULL
           AND ($1::boolean OR EXISTS (
               SELECT 1
               FROM lot_type_link ltl
               JOIN lot_type_link_quality lq
                 ON lq.lot_id = ltl.lot_id
                AND lq.type_id = ltl.type_id
               WHERE ltl.type_id = ct.id
                 AND lq.audit_version = 'hard-consistency-v1'
                 AND lq.status = 'conflict'
                 AND lq.reasons = '["year_mismatch"]'::jsonb
           ))
         ORDER BY ct.id
         LIMIT $2`,
        [options.all, options.limit],
    )).rows;
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    const types = await loadTypes(options);
    const result = { mode: options.write ? 'write' : 'dry-run', selected: types.length, fetched: 0, changed: 0, errors: 0 };
    const changes = [];
    for (const type of types) {
        try {
            const metadata = parseCbrCardMetadata(fetchCard(type.cbr_cat_num));
            result.fetched += 1;
            const issueDate = metadata.issueDate || type.issue_date;
            const coinYear = metadata.coinYear;
            const existingCoinYear = type.coin_year == null ? null : Number(type.coin_year);
            const changed = isoDate(type.issue_date) !== isoDate(issueDate)
                || existingCoinYear !== coinYear;
            if (changed) {
                result.changed += 1;
                changes.push({
                    typeId: Number(type.id),
                    catalogNumber: type.cbr_cat_num,
                    catalogYear: Number(type.year),
                    issueDate,
                    coinYear,
                });
                if (options.write) {
                    await pool.query(
                        'UPDATE coin_type SET issue_date=$1, coin_year=$2, updated_at=now() WHERE id=$3',
                        [issueDate, coinYear, type.id],
                    );
                }
            }
        } catch (error) {
            result.errors += 1;
            changes.push({ typeId: Number(type.id), catalogNumber: type.cbr_cat_num, error: error.message });
        }
        await sleep(options.delayMs);
    }
    console.log(JSON.stringify({ summary: result, changes }, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    }).finally(() => pool.end());
}

module.exports = { fetchCard, isoDate, parseOptions };
