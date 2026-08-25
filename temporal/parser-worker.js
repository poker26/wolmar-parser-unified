// Воркер парсера аукциона. Отдельный процесс/очередь (wolmar-parser): владеет одним
// headless-Chrome (singleton WolmarCategoryParser в parser-activities) → concurrency 1.
'use strict';

const { Worker, NativeConnection } = require('@temporalio/worker');
const { PARSER_TASK_QUEUE, ADDRESS, NAMESPACE } = require('./shared');
const activities = require('./parser-activities');

async function run() {
    const connection = await NativeConnection.connect({ address: ADDRESS });
    const worker = await Worker.create({
        connection,
        namespace: NAMESPACE,
        taskQueue: PARSER_TASK_QUEUE,
        workflowsPath: require.resolve('./parser-workflows'),
        activities,
        maxConcurrentActivityTaskExecutions: 1,
    });
    console.log(`[temporal-parser-worker] connected ${ADDRESS} ns=${NAMESPACE} queue=${PARSER_TASK_QUEUE}`);
    await worker.run();
}

run().catch((err) => {
    console.error('[temporal-parser-worker] fatal:', err);
    process.exit(1);
});
