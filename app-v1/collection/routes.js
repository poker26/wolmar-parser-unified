'use strict';

const { CollectionError, CollectionItemService } = require('./service');
const { CollectionSyncError, CollectionSyncService } = require('./sync-service');
const {
    InputError,
    normalizeCreatePayload,
    normalizePatchPayload,
    normalizeSoldPayload,
    parseIdempotencyKey,
    parseIfMatch,
    parseListQuery,
    parseSyncQuery,
    uuid,
} = require('./validation');

function errorBody(code, message, details = null) {
    return { error: { code, message, ...(details || {}) } };
}

function setVersion(res, item) {
    if (item?.version != null && typeof res.set === 'function') {
        res.set('ETag', `"${item.version}"`);
    }
}

function registerCollectionRoutes(app, {
    pool,
    authenticate,
    requireCsrf,
    service = null,
    syncService = null,
    storage = null,
    analytics = null,
} = {}) {
    if (typeof authenticate !== 'function' || typeof requireCsrf !== 'function') {
        throw new TypeError('Auth middleware is required');
    }
    const items = service || new CollectionItemService({ pool, analytics });
    const sync = syncService || (pool ? new CollectionSyncService({ pool, storage }) : null);

    function handle(handler) {
        return async (req, res, next) => {
            try {
                return await handler(req, res);
            } catch (error) {
                if (
                    error instanceof InputError
                    || error instanceof CollectionError
                    || error instanceof CollectionSyncError
                    || error.status
                ) {
                    return res.status(error.status || 400).json(errorBody(
                        error.code || 'invalid_input',
                        error.message,
                        error.details,
                    ));
                }
                return next(error);
            }
        };
    }

    app.get('/api/v1/collection/items', authenticate, handle(async (req, res) => {
        const result = await items.list(req.appAuth.userId, parseListQuery(req.query));
        return res.json(result);
    }));

    if (sync) {
        app.get('/api/v1/collection/sync', authenticate, handle(async (req, res) => {
            return res.json(await sync.sync(req.appAuth.userId, parseSyncQuery(req.query)));
        }));
    }

    app.post('/api/v1/collection/items', authenticate, requireCsrf, handle(async (req, res) => {
        const key = parseIdempotencyKey(req.get('idempotency-key'));
        const result = await items.create(
            req.appAuth.userId,
            normalizeCreatePayload(req.body),
            key,
        );
        setVersion(res, result.item);
        return res.status(result.created ? 201 : 200).json({ item: result.item });
    }));

    app.get('/api/v1/collection/items/:id', authenticate, handle(async (req, res) => {
        const item = await items.get(req.appAuth.userId, uuid(req.params.id));
        setVersion(res, item);
        return res.json({ item });
    }));

    app.patch('/api/v1/collection/items/:id', authenticate, requireCsrf, handle(async (req, res) => {
        const item = await items.patch(
            req.appAuth.userId,
            uuid(req.params.id),
            normalizePatchPayload(req.body),
            parseIfMatch(req.get('if-match')),
        );
        setVersion(res, item);
        return res.json({ item });
    }));

    app.delete('/api/v1/collection/items/:id', authenticate, requireCsrf, handle(async (req, res) => {
        const removed = await items.remove(
            req.appAuth.userId,
            uuid(req.params.id),
            parseIfMatch(req.get('if-match')),
        );
        setVersion(res, removed);
        return res.status(204).end();
    }));

    app.post('/api/v1/collection/items/:id/restore', authenticate, requireCsrf, handle(async (req, res) => {
        const item = await items.restore(req.appAuth.userId, uuid(req.params.id));
        setVersion(res, item);
        return res.json({ item });
    }));

    app.post('/api/v1/collection/items/:id/sold', authenticate, requireCsrf, handle(async (req, res) => {
        const item = await items.markSold(
            req.appAuth.userId,
            uuid(req.params.id),
            normalizeSoldPayload(req.body),
            parseIfMatch(req.get('if-match')),
        );
        setVersion(res, item);
        return res.json({ item });
    }));

    app.post('/api/v1/collection/items/:id/archive', authenticate, requireCsrf, handle(async (req, res) => {
        const item = await items.archive(req.appAuth.userId, uuid(req.params.id));
        setVersion(res, item);
        return res.json({ item });
    }));

    app.post('/api/v1/collection/items/:id/activate', authenticate, requireCsrf, handle(async (req, res) => {
        const item = await items.activate(
            req.appAuth.userId,
            uuid(req.params.id),
            parseIfMatch(req.get('if-match')),
        );
        setVersion(res, item);
        return res.json({ item });
    }));

    app.get('/api/v1/collection/summary', authenticate, handle(async (req, res) => {
        return res.json(await items.summary(req.appAuth.userId));
    }));

    return { service: items };
}

module.exports = { registerCollectionRoutes };
