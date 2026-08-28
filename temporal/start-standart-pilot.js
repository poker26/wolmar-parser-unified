#!/usr/bin/env node
'use strict';

const https = require('https');
const { parseAuctionWorkflow } = require('./parser-workflows');
const { getClient } = require('./client');
const { PARSER_TASK_QUEUE, PARSER_CHUNK_SIZE, PARSER_CHUNKS_BEFORE_CONTINUE } = require('./shared');
const { localAuctionNumber } = require('./wolmar-auction-series');

function option(name, fallback) {
    const prefix = `--${name}=`;
    const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : fallback;
}

function fetchText(url, redirects = 3) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (wolmar-parser standart pilot)' } }, (response) => {
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

async function main() {
    const apply = process.argv.includes('--apply');
    const wolmarId = option('wolmar-id', '2147');
    const displayNumber = option('number', '800');
    const slug = option('category', 'monety-rsfsr-sssr-rossii');
    const categoryName = option('category-name', 'Монеты РСФСР, СССР, России');
    const limit = Math.max(1, Number(option('limit', '20')) || 20);
    const auctionNumber = localAuctionNumber('standart', displayNumber);
    const auctionUrl = `https://www.wolmar.ru/auction/${wolmarId}`;
    const html = await fetchText(auctionUrl);
    const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    if (!plain.includes(`Аукцион Standart №${displayNumber}`)) {
        throw new Error(`Wolmar ID ${wolmarId} is not Standart №${displayNumber}`);
    }
    if (!/Закрыт\s+\d{2}\.\d{2}\.\d{4}/i.test(plain)) {
        throw new Error('Pilot import is allowed only for a closed auction');
    }

    const input = {
        auctionNumber: wolmarId,
        categories: [{
            name: categoryName,
            url: `${auctionUrl}/${slug}`,
        }],
        options: {
            auctionSeries: 'standart',
            saveAs: auctionNumber,
            updateBids: false,
            updateCategories: false,
            delayBetweenLots: 800,
            maxLotsPerCategory: limit,
        },
        chunkSize: Math.min(PARSER_CHUNK_SIZE, limit),
        chunksBeforeContinue: PARSER_CHUNKS_BEFORE_CONTINUE,
    };
    const workflowId = `standart-pilot-${auctionNumber}-${slug}-${limit}`;
    if (!apply) {
        process.stdout.write(`${JSON.stringify({ mode: 'dry-run', workflowId, taskQueue: PARSER_TASK_QUEUE, input }, null, 2)}\n`);
        return;
    }

    const client = await getClient();
    const handle = await client.workflow.start(parseAuctionWorkflow, {
        taskQueue: PARSER_TASK_QUEUE,
        workflowId,
        args: [input],
    });
    console.log(JSON.stringify({ workflowId: handle.workflowId, runId: handle.firstExecutionRunId }));
    const result = await handle.result();
    console.log(JSON.stringify({ workflowId: handle.workflowId, result }, null, 2));
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
