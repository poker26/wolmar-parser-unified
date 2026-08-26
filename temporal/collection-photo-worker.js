'use strict';

const { Worker, NativeConnection } = require('@temporalio/worker');
const { Pool } = require('pg');
const config = require('../config');
const { MinioPhotoStorage } = require('../app-v1/photos/storage');
const { ADDRESS, COLLECTION_PHOTO_TASK_QUEUE, NAMESPACE } = require('./shared');
const photoActivities = require('./collection-photo-activities');

async function run() {
    const pool = new Pool({ ...config.dbConfig, max: 1 });
    pool.on('error', (error) => {
        console.error('[temporal-collection-photo-worker] idle database connection error:', error);
    });
    const storage = new MinioPhotoStorage();
    const connection = await NativeConnection.connect({ address: ADDRESS });
    const worker = await Worker.create({
        connection,
        namespace: NAMESPACE,
        taskQueue: COLLECTION_PHOTO_TASK_QUEUE,
        workflowsPath: require.resolve('./collection-photo-workflows'),
        activities: {
            processCollectionPhoto: (input) => photoActivities.processCollectionPhoto(
                input,
                { pool, storage },
            ),
        },
        maxConcurrentActivityTaskExecutions: 1,
    });
    console.log(`[temporal-collection-photo-worker] connected ${ADDRESS} ns=${NAMESPACE} queue=${COLLECTION_PHOTO_TASK_QUEUE}`);
    try {
        await worker.run();
    } finally {
        await pool.end().catch(() => {});
        await connection.close();
    }
}

run().catch((error) => {
    console.error('[temporal-collection-photo-worker] fatal:', error);
    process.exit(1);
});
