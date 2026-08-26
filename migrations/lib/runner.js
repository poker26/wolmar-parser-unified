'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_FILE = /^(\d{12})_([a-z0-9_]+)\.sql$/;
const LOCK_NAME = 'wolmar-parser-schema-migrations';

function sha256(value) {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeSql(value) {
    return String(value).replace(/\r\n?/g, '\n').trim();
}

function loadMigrations(directory) {
    const migrations = fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
        .map((entry) => {
            const match = MIGRATION_FILE.exec(entry.name);
            if (!match) {
                throw new Error(
                    `Invalid migration filename ${entry.name}; expected YYYYMMDDNNNN_description.sql`,
                );
            }

            const filePath = path.join(directory, entry.name);
            const sql = normalizeSql(fs.readFileSync(filePath, 'utf8'));
            if (!sql) throw new Error(`Migration ${entry.name} is empty`);

            const acceptedChecksums = new Set([
                sha256(sql),
                sha256(sql.replace(/\n/g, '\r\n')),
            ]);

            return {
                version: match[1],
                name: entry.name,
                filePath,
                sql,
                checksum: sha256(sql),
                acceptedChecksums,
            };
        })
        .sort((left, right) => left.name.localeCompare(right.name));

    const versions = new Set();
    for (const migration of migrations) {
        if (versions.has(migration.version)) {
            throw new Error(`Duplicate migration version ${migration.version}`);
        }
        versions.add(migration.version);
    }

    return migrations;
}

async function runMigrations({ pool, directory, dryRun = false, logger = console }) {
    if (!pool || typeof pool.connect !== 'function') {
        throw new TypeError('A pg-compatible pool is required');
    }

    const migrations = loadMigrations(directory);
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LOCK_NAME]);
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                checksum CHAR(64) NOT NULL,
                execution_ms INTEGER NOT NULL CHECK (execution_ms >= 0),
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

        const appliedResult = await client.query(
            'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
        );
        const applied = new Map(appliedResult.rows.map((row) => [row.version, row]));
        const pending = [];

        for (const migration of migrations) {
            const existing = applied.get(migration.version);
            if (existing) {
                if (
                    existing.name !== migration.name
                    || !migration.acceptedChecksums.has(existing.checksum.trim())
                ) {
                    throw new Error(`Applied migration ${migration.version} differs from ${migration.name}`);
                }
                continue;
            }
            pending.push(migration);
        }

        if (dryRun) {
            await client.query('ROLLBACK');
            for (const migration of pending) logger.log(`pending ${migration.name}`);
            return { applied: [], pending: pending.map((migration) => migration.name) };
        }

        const completed = [];
        for (const migration of pending) {
            const startedAt = process.hrtime.bigint();
            await client.query(migration.sql);
            const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
            await client.query(
                `INSERT INTO schema_migrations (version, name, checksum, execution_ms)
                 VALUES ($1, $2, $3, $4)`,
                [migration.version, migration.name, migration.checksum, elapsedMs],
            );
            completed.push(migration.name);
            logger.log(`applied ${migration.name} (${elapsedMs} ms)`);
        }

        await client.query('COMMIT');
        return { applied: completed, pending: [] };
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (_) {
            // Preserve the migration error; connection cleanup happens below.
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    MIGRATION_FILE,
    loadMigrations,
    normalizeSql,
    runMigrations,
    sha256,
};
