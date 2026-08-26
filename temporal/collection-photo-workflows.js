'use strict';

const { proxyActivities } = require('@temporalio/workflow');

const { processCollectionPhoto } = proxyActivities({
    startToCloseTimeout: '5 minutes',
    retry: {
        maximumAttempts: 3,
        initialInterval: '5s',
        backoffCoefficient: 2,
    },
});

async function collectionPhotoWorkflow(input) {
    return processCollectionPhoto(input);
}

module.exports = { collectionPhotoWorkflow };
