#!/usr/bin/env node
'use strict';

// Полный импорт одного ЗАКРЫТОГО Wolmar Standart-аукциона.
// Категории открываются динамически тем же Temporal workflow, что прошёл пилот;
// сохраняются только разрешённые монетные категории. Никаких lot_type_link,
// прогнозов или массовых аудитов этот launcher не запускает.

const https = require('https');
const { localAuctionNumber } = require('./wolmar-auction-series');

function fetchText(url, redirects = 3) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (wolmar-parser standart backfill)' } }, (response) => {
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

function parseOptions(argv = process.argv.slice(2)) {
    const read = (name, fallback = null) => {
        const prefix = `--${name}=`;
        const arg = argv.find((value) => value.startsWith(prefix));
        return arg ? arg.slice(prefix.length) : fallback;
    };
    const wolmarId = read('wolmar-id');
    const displayNumber = read('number');
    if (!/^\d+$/.test(wolmarId || '')) throw new Error('--wolmar-id must be a positive integer');
    if (!/^\d+$/.test(displayNumber || '')) throw new Error('--number must be a positive integer');
    const maxRaw = read('max-lots-per-category');
    const maxLotsPerCategory = maxRaw == null ? null : Number(maxRaw);
    if (maxRaw != null && (!Number.isSafeInteger(maxLotsPerCategory) || maxLotsPerCategory <= 0)) {
        throw new Error('--max-lots-per-category must be a positive integer');
    }
    return {
        wolmarId,
        displayNumber,
        maxLotsPerCategory,
        apply: argv.includes('--apply'),
    };
}

async function main() {
    const options = parseOptions();
    const { parseAuctionWorkflow } = require('./parser-workflows');
    const { getClient } = require('./client');
    const { PARSER_TASK_QUEUE, PARSER_CHUNK_SIZE, PARSER_CHUNKS_BEFORE_CONTINUE } = require('./shared');
    const auctionNumber = localAuctionNumber('standart', options.displayNumber);
    const auctionUrl = `https://www.wolmar.ru/auction/${options.wolmarId}`;
    const html = await fetchText(auctionUrl);
    const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    if (!plain.includes(`Аукцион Standart №${options.displayNumber}`)) {
        throw new Error(`Wolmar ID ${options.wolmarId} is not Standart №${options.displayNumber}`);
    }
    const closed = plain.match(/Закрыт\s+(\d{2}\.\d{2}\.\d{4})/i)?.[1] || null;
    if (!closed) throw new Error('Full import is allowed only for a closed auction');

    const workflowId = `standart-backfill-${auctionNumber}`;
    const input = {
        auctionNumber: options.wolmarId,
        options: {
            auctionSeries: 'standart',
            saveAs: auctionNumber,
            updateBids: false,
            updateCategories: false,
            delayBetweenLots: 800,
            ...(options.maxLotsPerCategory == null ? {} : { maxLotsPerCategory: options.maxLotsPerCategory }),
        },
        chunkSize: PARSER_CHUNK_SIZE,
        chunksBeforeContinue: PARSER_CHUNKS_BEFORE_CONTINUE,
    };
    const plan = { mode: options.apply ? 'apply' : 'dry-run', workflowId, taskQueue: PARSER_TASK_QUEUE, closed, input };
    if (!options.apply) {
        console.log(JSON.stringify(plan, null, 2));
        return;
    }

    const client = await getClient();
    const handle = await client.workflow.start(parseAuctionWorkflow, {
        taskQueue: PARSER_TASK_QUEUE,
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

module.exports = { parseOptions };
