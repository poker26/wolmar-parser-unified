'use strict';

const crypto = require('node:crypto');

const DUMMY_PASSWORD_HASH = '$2b$12$.chBcIMeIQWT5Ti2rBmsTO2c3yEKej7Y0vgdggAArQbAZe1kyXlui';
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

class InvalidCredentialsError extends Error {
    constructor() {
        super('Invalid email or password');
        this.name = 'InvalidCredentialsError';
        this.code = 'invalid_credentials';
    }
}

class ReauthenticationError extends Error {
    constructor() {
        super('Password confirmation failed');
        this.name = 'ReauthenticationError';
        this.code = 'reauthentication_failed';
        this.status = 401;
    }
}

function normalizeEmail(value) {
    const email = String(value || '').trim().normalize('NFKC').toLowerCase();
    if (
        email.length < 3
        || email.length > 254
        || !email.includes('@')
        || /[\u0000-\u001f\u007f\s]/u.test(email)
    ) {
        throw new InvalidCredentialsError();
    }
    return email;
}

function validatePassword(value) {
    const password = typeof value === 'string' ? value : '';
    if (password.length < 10 || password.length > 128) {
        throw new InvalidCredentialsError();
    }
    return password;
}

function opaqueToken() {
    return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function safeHashEqual(actual, expected) {
    if (
        typeof actual !== 'string'
        || typeof expected !== 'string'
        || !/^[0-9a-f]{64}$/i.test(actual)
        || !/^[0-9a-f]{64}$/i.test(expected)
    ) return false;
    const left = Buffer.from(actual, 'hex');
    const right = Buffer.from(expected, 'hex');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function publicUser(row) {
    return {
        id: row.user_id || row.id,
        email: row.email_normalized,
        displayName: row.display_name || null,
    };
}

function defaultPasswordHasher() {
    const bcrypt = require('bcryptjs');
    return {
        hash: (password) => bcrypt.hash(password, 12),
        verify: (password, digest) => bcrypt.compare(password, digest),
    };
}

class SessionService {
    constructor({ pool, passwordHasher = defaultPasswordHasher(), sessionTtlMs = DEFAULT_SESSION_TTL_MS }) {
        if (!pool || typeof pool.query !== 'function') throw new TypeError('A pg-compatible pool is required');
        if (sessionTtlMs < MIN_SESSION_TTL_MS || sessionTtlMs > MAX_SESSION_TTL_MS) {
            throw new RangeError('Session TTL must be between one hour and 90 days');
        }
        this.pool = pool;
        this.passwordHasher = passwordHasher;
        this.sessionTtlMs = sessionTtlMs;
    }

    async login({ email, password }) {
        let normalizedEmail;
        let normalizedPassword;
        try {
            normalizedEmail = normalizeEmail(email);
            normalizedPassword = validatePassword(password);
        } catch (_) {
            throw new InvalidCredentialsError();
        }

        const result = await this.pool.query(
            `SELECT id, email_normalized, password_hash, display_name, status
             FROM app_user
             WHERE email_normalized = $1`,
            [normalizedEmail],
        );
        const account = result.rows[0] || null;
        const digest = account ? account.password_hash : DUMMY_PASSWORD_HASH;
        const passwordMatches = await this.passwordHasher.verify(normalizedPassword, digest);

        if (!account || account.status !== 'active' || !passwordMatches) {
            throw new InvalidCredentialsError();
        }

        const sessionToken = opaqueToken();
        const csrfToken = opaqueToken();
        const sessionId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + this.sessionTtlMs);

        await this.pool.query(
            `INSERT INTO user_session
                (id, user_id, token_hash, csrf_token_hash, expires_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [sessionId, account.id, hashToken(sessionToken), hashToken(csrfToken), expiresAt],
        );

        return {
            user: publicUser(account),
            session: { id: sessionId, token: sessionToken, csrfToken, expiresAt },
        };
    }

    async authenticate(sessionToken) {
        if (typeof sessionToken !== 'string' || sessionToken.length < 40 || sessionToken.length > 100) {
            return null;
        }

        const result = await this.pool.query(
            `SELECT s.id session_id, s.user_id, s.csrf_token_hash,
                    u.email_normalized, u.display_name
             FROM user_session s
             JOIN app_user u ON u.id = s.user_id
             WHERE s.token_hash = $1
               AND s.revoked_at IS NULL
               AND s.expires_at > now()
               AND u.status = 'active'`,
            [hashToken(sessionToken)],
        );
        const row = result.rows[0];
        if (!row) return null;

        await this.pool.query(
            `UPDATE user_session SET last_seen_at = now()
             WHERE id = $1 AND last_seen_at < now() - interval '15 minutes'`,
            [row.session_id],
        );

        return {
            sessionId: row.session_id,
            userId: row.user_id,
            csrfTokenHash: row.csrf_token_hash,
            user: publicUser(row),
        };
    }

    async reauthenticate(userId, password) {
        let normalizedPassword;
        try {
            normalizedPassword = validatePassword(password);
        } catch (_) {
            throw new ReauthenticationError();
        }
        const result = await this.pool.query(
            `SELECT password_hash, status FROM app_user WHERE id = $1`,
            [userId],
        );
        const account = result.rows[0] || null;
        const digest = account ? account.password_hash : DUMMY_PASSWORD_HASH;
        const passwordMatches = await this.passwordHasher.verify(normalizedPassword, digest);
        if (!account || account.status !== 'active' || !passwordMatches) {
            throw new ReauthenticationError();
        }
        return true;
    }

    verifyCsrf(auth, csrfToken) {
        if (!auth || typeof csrfToken !== 'string' || csrfToken.length < 40 || csrfToken.length > 100) {
            return false;
        }
        return safeHashEqual(hashToken(csrfToken), auth.csrfTokenHash);
    }

    async logout(sessionId, userId) {
        await this.pool.query(
            `UPDATE user_session SET revoked_at = now()
             WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
            [sessionId, userId],
        );
    }

    async logoutAll(userId) {
        const result = await this.pool.query(
            `UPDATE user_session SET revoked_at = now()
             WHERE user_id = $1 AND revoked_at IS NULL`,
            [userId],
        );
        return result.rowCount || 0;
    }
}

module.exports = {
    DEFAULT_SESSION_TTL_MS,
    InvalidCredentialsError,
    ReauthenticationError,
    SessionService,
    hashToken,
    normalizeEmail,
    safeHashEqual,
    validatePassword,
};
