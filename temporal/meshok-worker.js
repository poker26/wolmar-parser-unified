// Воркер харвеста meshok. Отдельная очередь (wolmar-meshok): только Scrapfly(HTTP)+pg, без браузера.
// concurrency 1 — Scrapfly-вызовы последовательно (бережём concurrency-лимит площадки/аккаунта).
'use strict';

const { Worker, NativeConnection } = require('@temporalio/worker');
const { MESHOK_TASK_QUEUE, ADDRESS, NAMESPACE } = require('./shared');
const activities = require('./meshok-activities');

async function run() {
    const connection = await NativeConnection.connect({ address: ADDRESS });
    const worker = await Worker.create({
        connection,
        namespace: NAMESPACE,
        taskQueue: MESHOK_TASK_QUEUE,
        workflowsPath: require.resolve('./meshok-workflows'),
        activities,
        maxConcurrentActivityTaskExecutions: 1,
    });
    console.log(`[temporal-meshok-worker] connected ${ADDRESS} ns=${NAMESPACE} queue=${MESHOK_TASK_QUEUE}`);
    await worker.run();
}

run().catch((err) => {
    console.error('[temporal-meshok-worker] fatal:', err);
    process.exit(1);
});
