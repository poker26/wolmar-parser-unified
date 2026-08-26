'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const config = require('../config');
const { normalizeEmail, validatePassword } = require('../app-v1/auth/session-service');

async function main() {
    const email = normalizeEmail(process.env.APP_USER_EMAIL);
    const password = validatePassword(process.env.APP_USER_PASSWORD);
    const displayName = String(process.env.APP_USER_DISPLAY_NAME || '').trim() || null;
    const passwordHash = await bcrypt.hash(password, 12);
    const pool = new Pool({ ...config.dbConfig, max: 1 });

    try {
        const result = await pool.query(
            `INSERT INTO app_user
                (id, email_normalized, password_hash, display_name, status, email_verified_at)
             VALUES ($1, $2, $3, $4, 'active', now())
             RETURNING id, email_normalized, display_name, status`,
            [crypto.randomUUID(), email, passwordHash, displayName],
        );
        const user = result.rows[0];
        console.log(`created app user ${user.id} (${user.email_normalized})`);
    } catch (error) {
        if (error.code === '23505') throw new Error('An app user with this email already exists');
        throw error;
    } finally {
        await pool.end();
    }
}

main().catch((error) => {
    console.error(`create app user failed: ${error.message}`);
    process.exitCode = 1;
});
