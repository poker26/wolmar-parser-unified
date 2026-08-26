'use strict';

const { Worker, NativeConnection } = require('@temporalio/worker');
const { Pool } = require('pg');
const config = require('../config');
const { ADDRESS, COLLECTION_VALUATION_TASK_QUEUE, NAMESPACE } = require('./shared');
const valuationActivities = require('./collection-valuation-activities');

async function run() {
    const pool = new Pool({ ...config.dbConfig, max: 2 });
    pool.on('error', (error) => {
        console.error('[temporal-collection-valuation-worker] idle database connection error:', error);
    });
    const connection = await NativeConnection.connect({ address: ADDRESS });
    const worker = await Worker.create({
        connection,
        namespace: NAMESPACE,
        taskQueue: COLLECTION_VALUATION_TASK_QUEUE,
        workflowsPath: require.resolve('./collection-valuation-workflows'),
        activities: {
            calculateCollectionValuation: (input) => valuationActivities.calculateCollectionValuation(
                input,
                { pool },
            ),
        },
        maxConcurrentActivityTaskExecutions: 2,
    });
    console.log(`[temporal-collection-valuation-worker] connected ${ADDRESS} ns=${NAMESPACE} queue=${COLLECTION_VALUATION_TASK_QUEUE}`);
    try {
        await worker.run();
    } finally {
        await pool.end().catch(() => {});
        await connection.close();
    }
}

run().catch((error) => {
    console.error('[temporal-collection-valuation-worker] fatal:', error);
    process.exit(1);
});
