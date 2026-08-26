'use strict';

const { CollectionError, CollectionItemService } = require('./service');
const {
    InputError,
    normalizeCreatePayload,
    normalizePatchPayload,
    normalizeSoldPayload,
    parseIdempotencyKey,
    parseListQuery,
    uuid,
} = require('./validation');

function errorBody(code, message) {
    return { error: { code, message } };
}

function registerCollectionRoutes(app, {
    pool,
    authenticate,
    requireCsrf,
    service = null,
    enqueueValuation = async () => {},
    analytics = null,
} = {}) {
    if (typeof authenticate !== 'function' || typeof requireCsrf !== 'function') {
        throw new TypeError('Auth middleware is required');
    }
    const items = service || new CollectionItemService({ pool, enqueueValuation, analytics });

    function handle(handler) {
        return async (req, res, next) => {
            try {
                return await handler(req, res);
            } catch (error) {
                if (error instanceof InputError || error instanceof CollectionError || error.status) {
                    return res.status(error.status || 400).json(errorBody(error.code || 'invalid_input', error.message));
                }
                return next(error);
            }
        };
    }

    app.get('/api/v1/collection/items', authenticate, handle(async (req, res) => {
        const result = await items.list(req.appAuth.userId, parseListQuery(req.query));
        return res.json(result);
    }));

    app.post('/api/v1/collection/items', authenticate, requireCsrf, handle(async (req, res) => {
        const key = parseIdempotencyKey(req.get('idempotency-key'));
        const result = await items.create(
            req.appAuth.userId,
            normalizeCreatePayload(req.body),
            key,
        );
        return res.status(result.created ? 201 : 200).json({ item: result.item });
    }));

    app.get('/api/v1/collection/items/:id', authenticate, handle(async (req, res) => {
        const item = await items.get(req.appAuth.userId, uuid(req.params.id));
        return res.json({ item });
    }));

    app.patch('/api/v1/collection/items/:id', authenticate, requireCsrf, handle(async (req, res) => {
        const item = await items.patch(
            req.appAuth.userId,
            uuid(req.params.id),
            normalizePatchPayload(req.body),
        );
        return res.json({ item });
    }));

    app.delete('/api/v1/collection/items/:id', authenticate, requireCsrf, handle(async (req, res) => {
        await items.remove(req.appAuth.userId, uuid(req.params.id));
        return res.status(204).end();
    }));

    app.post('/api/v1/collection/items/:id/restore', authenticate, requireCsrf, handle(async (req, res) => {
        const item = await items.restore(req.appAuth.userId, uuid(req.params.id));
        return res.json({ item });
    }));

    app.post('/api/v1/collection/items/:id/sold', authenticate, requireCsrf, handle(async (req, res) => {
        const item = await items.markSold(
            req.appAuth.userId,
            uuid(req.params.id),
            normalizeSoldPayload(req.body),
        );
        return res.json({ item });
    }));

    app.post('/api/v1/collection/items/:id/archive', authenticate, requireCsrf, handle(async (req, res) => {
        const item = await items.archive(req.appAuth.userId, uuid(req.params.id));
        return res.json({ item });
    }));

    app.post('/api/v1/collection/items/:id/activate', authenticate, requireCsrf, handle(async (req, res) => {
        const item = await items.activate(req.appAuth.userId, uuid(req.params.id));
        return res.json({ item });
    }));

    app.get('/api/v1/collection/summary', authenticate, handle(async (req, res) => {
        return res.json(await items.summary(req.appAuth.userId));
    }));

    return { service: items };
}

module.exports = { registerCollectionRoutes };
