// Воркер харвеста numismat. Очередь wolmar-numismat (curl+pg, без браузера). concurrency 2.
'use strict';

const { Worker, NativeConnection } = require('@temporalio/worker');
const { NUMISMAT_TASK_QUEUE, ADDRESS, NAMESPACE } = require('./shared');
const activities = require('./numismat-activities');

async function run() {
    const connection = await NativeConnection.connect({ address: ADDRESS });
    const worker = await Worker.create({
        connection,
        namespace: NAMESPACE,
        taskQueue: NUMISMAT_TASK_QUEUE,
        workflowsPath: require.resolve('./numismat-workflows'),
        activities,
        maxConcurrentActivityTaskExecutions: 2,   // numismat без обходов → можно 2 параллельно
    });
    console.log(`[temporal-numismat-worker] connected ${ADDRESS} ns=${NAMESPACE} queue=${NUMISMAT_TASK_QUEUE}`);
    await worker.run();
}

run().catch((err) => {
    console.error('[temporal-numismat-worker] fatal:', err);
    process.exit(1);
});
