'use strict';

const { InputError, uuid } = require('../collection/validation');
const { CollectionValuationService, ValuationError } = require('./service');

function errorBody(code, message) {
    return { error: { code, message } };
}

function registerValuationRoutes(app, {
    pool,
    authenticate,
    requireCsrf,
    service = null,
    enqueueRecalculation = async () => {},
    analytics = null,
} = {}) {
    if (typeof authenticate !== 'function' || typeof requireCsrf !== 'function') {
        throw new TypeError('Auth middleware is required');
    }
    const valuations = service || new CollectionValuationService({ pool, enqueueRecalculation, analytics });

    function handle(handler) {
        return async (req, res, next) => {
            try {
                return await handler(req, res);
            } catch (error) {
                if (error instanceof InputError || error instanceof ValuationError || error.status) {
                    return res.status(error.status || 400).json(errorBody(error.code || 'invalid_input', error.message));
                }
                return next(error);
            }
        };
    }

    app.get('/api/v1/collection/items/:id/valuation', authenticate, handle(async (req, res) => {
        const valuation = await valuations.latest(req.appAuth.userId, uuid(req.params.id));
        return res.json({ status: valuation ? valuation.status : 'not_calculated', valuation });
    }));

    app.get('/api/v1/collection/items/:id/valuations', authenticate, handle(async (req, res) => {
        const parsed = Number(req.query.limit || 20);
        const limit = Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20;
        const history = await valuations.history(req.appAuth.userId, uuid(req.params.id), limit);
        return res.json({ valuations: history });
    }));

    app.get('/api/v1/collection/items/:id/valuation/comparables', authenticate, handle(async (req, res) => {
        const valuationId = req.query.valuationId ? uuid(req.query.valuationId, 'valuationId') : null;
        return res.json(await valuations.comparables(
            req.appAuth.userId,
            uuid(req.params.id),
            valuationId,
        ));
    }));

    app.post('/api/v1/collection/items/:id/valuation/recalculate', authenticate, requireCsrf, handle(async (req, res) => {
        const result = await valuations.recalculate(req.appAuth.userId, uuid(req.params.id));
        return res.status(202).json(result);
    }));

    return { service: valuations };
}

module.exports = { registerValuationRoutes };
