#!/usr/bin/env node
'use strict';

// Запускает последовательный Temporal backfill закрытых Standart-аукционов.
// По умолчанию только показывает план; запись требует явного --apply.

const https = require('https');
const { localAuctionNumber } = require('./wolmar-auction-series');

function fetchText(url, redirects = 3) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (wolmar-parser standart year backfill)' } }, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects > 0) {
                response.resume();
                return fetchText(new URL(response.headers.location, url).toString(), redirects - 1).then(resolve, reject);
            }
            if (response.statusCode !== 200) {
                response.resume();
                return reject(new Error(`GET ${url} returned HTTP ${response.statusCode}`));
            }
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => resolve(body));
        }).on('error', reject);
    });
}

function parseStandartArchive(html) {
    const found = new Map();
    const pattern = /href=["']\/auction\/(\d+)["'][^>]*>\s*Аукцион\s+Standart\s+№\s*(\d+)\s*</gi;
    let match;
    while ((match = pattern.exec(String(html || ''))) !== null) {
        const displayNumber = Number(match[2]);
        found.set(displayNumber, {
            wolmarId: String(match[1]),
            displayNumber: String(displayNumber),
            auctionNumber: localAuctionNumber('standart', displayNumber),
        });
    }
    return [...found.values()].sort((a, b) => Number(b.displayNumber) - Number(a.displayNumber));
}

function parseOptions(argv = process.argv.slice(2)) {
    const read = (name, fallback) => {
        const prefix = `--${name}=`;
        const arg = argv.find((value) => value.startsWith(prefix));
        return arg ? arg.slice(prefix.length) : fallback;
    };
    const from = Number(read('from', '839'));
    const to = Number(read('to', '790'));
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= 0 || from < to) {
        throw new Error('Expected positive --from and --to with from >= to');
    }
    return { from, to, apply: argv.includes('--apply') };
}

async function main() {
    const options = parseOptions();
    const archive = parseStandartArchive(await fetchText('https://www.wolmar.ru/'));
    const auctions = archive.filter((auction) => {
        const number = Number(auction.displayNumber);
        return number <= options.from && number >= options.to;
    });
    const expected = options.from - options.to + 1;
    if (auctions.length !== expected) {
        throw new Error(`Archive range is incomplete: expected ${expected}, found ${auctions.length}`);
    }

    const workflowId = `standart-year-backfill-s${options.from}-s${options.to}`;
    const input = { auctions, chunkSize: 20, chunksBeforeContinue: 50 };
    const plan = {
        mode: options.apply ? 'apply' : 'dry-run',
        workflowId,
        taskQueue: 'wolmar-parser',
        count: auctions.length,
        first: auctions[0],
        last: auctions.at(-1),
    };
    if (!options.apply) {
        console.log(JSON.stringify(plan, null, 2));
        return;
    }

    const { getClient } = require('./client');
    const { standartBackfillBatchWorkflow } = require('./parser-workflows');
    const client = await getClient();
    const handle = await client.workflow.start(standartBackfillBatchWorkflow, {
        taskQueue: 'wolmar-parser',
        workflowId,
        workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
        args: [input],
    });
    console.log(JSON.stringify({ ...plan, runId: handle.firstExecutionRunId }, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    });
}

module.exports = { parseStandartArchive, parseOptions };
