'use strict';

const {
    InvalidCredentialsError,
    SessionService,
    hashToken,
    normalizeEmail,
    safeHashEqual,
} = require('./session-service');

function parseCookies(header) {
    const cookies = {};
    for (const pair of String(header || '').split(';')) {
        const index = pair.indexOf('=');
        if (index < 1) continue;
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        try {
            cookies[name] = decodeURIComponent(value);
        } catch (_) {
            // Ignore malformed cookie values.
        }
    }
    return cookies;
}

function cookieConfig(env = process.env) {
    const production = env.NODE_ENV === 'production';
    const sessionName = env.APP_SESSION_COOKIE
        || (production ? '__Host-wolmar_session' : 'wolmar_session');
    const csrfName = env.APP_CSRF_COOKIE
        || (production ? '__Host-wolmar_csrf' : 'wolmar_csrf');
    return {
        sessionName,
        csrfName,
        session: {
            httpOnly: true,
            secure: production,
            sameSite: 'lax',
            path: '/',
        },
        csrf: {
            httpOnly: false,
            secure: production,
            sameSite: 'strict',
            path: '/',
        },
    };
}

function errorBody(code, message) {
    return { error: { code, message } };
}

function createIdentifierLimiter({ max = 10, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
    const attempts = new Map();
    return (req, res, next) => {
        let key = 'invalid';
        try {
            key = normalizeEmail(req.body && req.body.email);
        } catch (_) {}
        const timestamp = now();
        const current = attempts.get(key);
        if (!current || current.resetAt <= timestamp) {
            attempts.set(key, { count: 1, resetAt: timestamp + windowMs });
            req.clearLoginRateLimit = () => attempts.delete(key);
            return next();
        }
        current.count += 1;
        if (current.count > max) {
            res.set('Retry-After', String(Math.ceil((current.resetAt - timestamp) / 1000)));
            return res.status(429).json(errorBody('rate_limited', 'Too many login attempts'));
        }
        req.clearLoginRateLimit = () => attempts.delete(key);
        return next();
    };
}

function registerAuthRoutes(app, {
    pool,
    service = null,
    env = process.env,
    loginLimiter = createIdentifierLimiter(),
} = {}) {
    const authService = service || new SessionService({
        pool,
        sessionTtlMs: Number(env.APP_SESSION_TTL_MS) || undefined,
    });
    const cookies = cookieConfig(env);
    const maxAge = authService.sessionTtlMs;

    function clearAuthCookies(res) {
        res.clearCookie(cookies.sessionName, cookies.session);
        res.clearCookie(cookies.csrfName, cookies.csrf);
    }

    async function authenticate(req, res, next) {
        try {
            const values = parseCookies(req.headers && req.headers.cookie);
            const auth = await authService.authenticate(values[cookies.sessionName]);
            if (!auth) {
                clearAuthCookies(res);
                return res.status(401).json(errorBody('authentication_required', 'Authentication required'));
            }
            req.appAuth = auth;
            req.appCookies = values;
            return next();
        } catch (error) {
            return next(error);
        }
    }

    function requireCsrf(req, res, next) {
        const headerToken = req.get('x-csrf-token');
        const cookieToken = req.appCookies && req.appCookies[cookies.csrfName];
        const sameToken = typeof headerToken === 'string'
            && typeof cookieToken === 'string'
            && safeHashEqual(
                hashToken(headerToken),
                hashToken(cookieToken),
            );
        if (!sameToken || !authService.verifyCsrf(req.appAuth, headerToken)) {
            return res.status(403).json(errorBody('csrf_failed', 'CSRF validation failed'));
        }
        return next();
    }

    app.post('/api/v1/auth/login', loginLimiter, async (req, res, next) => {
        try {
            const result = await authService.login(req.body || {});
            if (req.clearLoginRateLimit) req.clearLoginRateLimit();
            res.cookie(cookies.sessionName, result.session.token, { ...cookies.session, maxAge });
            res.cookie(cookies.csrfName, result.session.csrfToken, { ...cookies.csrf, maxAge });
            return res.json({ user: result.user });
        } catch (error) {
            if (error instanceof InvalidCredentialsError || error.code === 'invalid_credentials') {
                return res.status(401).json(errorBody('invalid_credentials', 'Invalid email or password'));
            }
            return next(error);
        }
    });

    app.get('/api/v1/me', authenticate, (req, res) => res.json({ user: req.appAuth.user }));

    app.post('/api/v1/auth/logout', authenticate, requireCsrf, async (req, res, next) => {
        try {
            await authService.logout(req.appAuth.sessionId, req.appAuth.userId);
            clearAuthCookies(res);
            return res.status(204).end();
        } catch (error) {
            return next(error);
        }
    });

    app.post('/api/v1/auth/logout-all', authenticate, requireCsrf, async (req, res, next) => {
        try {
            await authService.logoutAll(req.appAuth.userId);
            clearAuthCookies(res);
            return res.status(204).end();
        } catch (error) {
            return next(error);
        }
    });

    return { authenticate, requireCsrf, service: authService, cookies, clearAuthCookies };
}

module.exports = {
    cookieConfig,
    createIdentifierLimiter,
    parseCookies,
    registerAuthRoutes,
};
