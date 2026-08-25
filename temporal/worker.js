// Воркер форкаст-пилота. Запускается на server1 (PM2), дозванивается до Temporal на server3.
// activity-concurrency = 1 из-за единственного pg Client внутри ImprovedPredictionsGenerator.
'use strict';

const { Worker, NativeConnection } = require('@temporalio/worker');
const { TASK_QUEUE, ADDRESS, NAMESPACE } = require('./shared');
const activities = require('./activities');

async function run() {
    const connection = await NativeConnection.connect({ address: ADDRESS });
    const worker = await Worker.create({
        connection,
        namespace: NAMESPACE,
        taskQueue: TASK_QUEUE,
        workflowsPath: require.resolve('./workflows'),
        activities,
        maxConcurrentActivityTaskExecutions: 1,
    });
    console.log(`[temporal-worker] connected ${ADDRESS} ns=${NAMESPACE} queue=${TASK_QUEUE}`);
    await worker.run();
}

run().catch((err) => {
    console.error('[temporal-worker] fatal:', err);
    process.exit(1);
});
