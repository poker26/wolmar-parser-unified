'use strict';

const {
    condition,
    defineSignal,
    proxyActivities,
    setHandler,
} = require('@temporalio/workflow');

const requestValuationRecalculation = defineSignal('requestValuationRecalculation');
const { calculateCollectionValuation } = proxyActivities({
    startToCloseTimeout: '2 minutes',
    retry: {
        maximumAttempts: 3,
        initialInterval: '3s',
        backoffCoefficient: 2,
    },
});

async function collectionValuationWorkflow(input) {
    let rerunRequested = false;
    setHandler(requestValuationRecalculation, () => { rerunRequested = true; });
    let result;
    do {
        rerunRequested = false;
        result = await calculateCollectionValuation(input);
        await condition(() => rerunRequested, '1 second');
    } while (rerunRequested);
    return result;
}

module.exports = {
    collectionValuationWorkflow,
    requestValuationRecalculation,
};
