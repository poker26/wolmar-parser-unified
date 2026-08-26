'use strict';

const { proxyActivities, sleep } = require('@temporalio/workflow');

const { buildCollectionExport, deleteAccountData } = proxyActivities({
    startToCloseTimeout: '2 hours',
    heartbeatTimeout: '2 minutes',
    retry: { maximumAttempts: 3, initialInterval: '10 seconds', backoffCoefficient: 2 },
});

async function collectionExportWorkflow(input) {
    return buildCollectionExport(input);
}

async function accountDeletionWorkflow(input) {
    const delay = Math.max(0, new Date(input.executeAt).getTime() - Date.now());
    if (delay > 0) await sleep(delay);
    return deleteAccountData(input);
}

module.exports = { accountDeletionWorkflow, collectionExportWorkflow };
