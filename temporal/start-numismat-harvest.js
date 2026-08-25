// Запуск/прогресс/стоп харвеста numismat (Temporal, очередь wolmar-numismat).
//   node temporal/start-numismat-harvest.js          — старт (новые аукционы первыми)
//   node temporal/start-numismat-harvest.js progress
//   node temporal/start-numismat-harvest.js stop
'use strict';

const { Connection, Client } = require('@temporalio/client');
const { ADDRESS, NAMESPACE, NUMISMAT_TASK_QUEUE, NUMISMAT_PAGES_BEFORE_CONTINUE, numismatHarvestWorkflowId } = require('./shared');
const { numismatHarvestWorkflow } = require('./numismat-workflows');
const { listAuctions, curlGet } = require('../catalog/numismat-core');
const { pool } = require('../catalog/db');

async function main() {
    const cmd = process.argv[2] || 'start';
    const connection = await Connection.connect({ address: ADDRESS });
    const client = new Client({ connection, namespace: NAMESPACE });
    const workflowId = numismatHarvestWorkflowId('all');
    const handle = client.workflow.getHandle(workflowId);

    if (cmd === 'progress') {
        const desc = await handle.describe();
        let p = null;
        if (desc.status.name === 'RUNNING') { try { p = await handle.query('progress'); } catch (_) {} }
        console.log('status:', desc.status.name);
        console.log(JSON.stringify(p, null, 1));
    } else if (cmd === 'stop') {
        await handle.cancel();
        console.log('cancelled', workflowId);
    } else {
        // дискавери + диф: новые аукционы (нет в БД) ПЕРВЫМИ (по убыванию = свежие), затем существующие
        const all = listAuctions(await curlGet('https://numismat.ru/auction.shtml'));
        const have = new Set((await pool.query("SELECT DISTINCT auction_number FROM auction_lots WHERE source_site='numismat.ru'")).rows.map((r) => +String(r.auction_number).replace(/^n/, "")));
        const fresh = all.filter((a) => !have.has(a)).sort((a, b) => b - a);
        const existing = all.filter((a) => have.has(a)).sort((a, b) => b - a);
        const auctions = [...fresh, ...existing];
        console.log(`аукционов всего ${all.length}: новых ${fresh.length} (первыми), существующих ${existing.length}`);
        const h = await client.workflow.start(numismatHarvestWorkflow, {
            taskQueue: NUMISMAT_TASK_QUEUE,
            workflowId,
            args: [{ auctions, pagesBeforeContinue: NUMISMAT_PAGES_BEFORE_CONTINUE }],
        });
        console.log('started', h.workflowId, 'run', h.firstExecutionRunId);
    }
    await pool.end().catch(() => {});
    await connection.close();
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
