'use strict';

const DEFAULT_TIMEOUT_MS = 2000;

async function checkDatabase(pool, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!pool || typeof pool.query !== 'function') throw new TypeError('A pg-compatible pool is required');
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const error = new Error('Database readiness check timed out');
            error.code = 'readiness_timeout';
            reject(error);
        }, timeoutMs);
    });
    try {
        await Promise.race([
            pool.query({ text: 'SELECT 1 AS ready', query_timeout: timeoutMs }),
            timeout,
        ]);
    } finally {
        clearTimeout(timer);
    }
}

function registerHealthRoutes(app, {
    pool,
    databaseCheck = () => checkDatabase(pool),
    now = () => new Date(),
    logger = console,
} = {}) {
    const response = (check, status, checks = undefined) => ({
        status,
        check,
        ...(checks ? { checks } : {}),
        timestamp: now().toISOString(),
    });
    const noStore = (res) => res.set('Cache-Control', 'no-store');

    const live = (_req, res) => noStore(res).json(response('liveness', 'ok'));
    const ready = async (_req, res) => {
        try {
            await databaseCheck();
            return noStore(res).json(response('readiness', 'ok', { database: 'up' }));
        } catch (_) {
            logger.warn('[readiness] database unavailable');
            return noStore(res).status(503).json(
                response('readiness', 'unavailable', { database: 'down' }),
            );
        }
    };

    app.get('/api/health', live);
    app.get('/api/health/live', live);
    app.get('/api/health/ready', ready);
    return { live, ready };
}

module.exports = { DEFAULT_TIMEOUT_MS, checkDatabase, registerHealthRoutes };
