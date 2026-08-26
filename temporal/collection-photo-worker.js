'use strict';

const { Worker, NativeConnection } = require('@temporalio/worker');
const { ADDRESS, COLLECTION_PHOTO_TASK_QUEUE, NAMESPACE } = require('./shared');
const activities = require('./collection-photo-activities');

async function run() {
    const connection = await NativeConnection.connect({ address: ADDRESS });
    const worker = await Worker.create({
        connection,
        namespace: NAMESPACE,
        taskQueue: COLLECTION_PHOTO_TASK_QUEUE,
        workflowsPath: require.resolve('./collection-photo-workflows'),
        activities,
        maxConcurrentActivityTaskExecutions: 1,
    });
    console.log(`[temporal-collection-photo-worker] connected ${ADDRESS} ns=${NAMESPACE} queue=${COLLECTION_PHOTO_TASK_QUEUE}`);
    await worker.run();
}

run().catch((error) => {
    console.error('[temporal-collection-photo-worker] fatal:', error);
    process.exit(1);
});
