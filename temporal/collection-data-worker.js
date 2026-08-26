'use strict';

const { NativeConnection, Worker } = require('@temporalio/worker');
const { Pool } = require('pg');
const config = require('../config');
const { MinioPhotoStorage } = require('../app-v1/photos/storage');
const activities = require('./collection-data-activities');
const { ADDRESS, COLLECTION_DATA_TASK_QUEUE, NAMESPACE } = require('./shared');

async function main() {
    const connection = await NativeConnection.connect({ address: ADDRESS });
    const pool = new Pool({ ...config.dbConfig, max: 3 });
    const storage = new MinioPhotoStorage();
    pool.on('error', (error) => console.error('[temporal-collection-data-worker] idle database connection error:', error));
    const worker = await Worker.create({
        connection,
        namespace: NAMESPACE,
        taskQueue: COLLECTION_DATA_TASK_QUEUE,
        workflowsPath: require.resolve('./collection-data-workflows'),
        activities: {
            buildCollectionExport: (input) => activities.buildCollectionExport(input, { pool, storage }),
            deleteAccountData: (input) => activities.deleteAccountData(input, { pool, storage }),
        },
    });
    console.log(`[temporal-collection-data-worker] connected ${ADDRESS} ns=${NAMESPACE} queue=${COLLECTION_DATA_TASK_QUEUE}`);
    const shutdown = async () => {
        worker.shutdown();
        await pool.end().catch(() => {});
        await connection.close().catch(() => {});
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    await worker.run();
}

main().catch((error) => {
    console.error('[temporal-collection-data-worker] fatal:', error);
    process.exitCode = 1;
});
