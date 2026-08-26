'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadMigrations, runMigrations, sha256 } = require('../migrations/lib/runner');

async function withMigrationDirectory(files, callback) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wolmar-migrations-'));
    try {
        for (const [name, sql] of Object.entries(files)) {
            fs.writeFileSync(path.join(directory, name), sql, 'utf8');
        }
        return await callback(directory);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

class FakeClient {
    constructor(appliedRows = []) {
        this.appliedRows = appliedRows;
        this.queries = [];
        this.released = false;
    }

    async query(sql, params) {
        this.queries.push({ sql, params });
        if (sql.startsWith('SELECT version, name, checksum')) {
            return { rows: this.appliedRows };
        }
        return { rows: [] };
    }

    release() {
        this.released = true;
    }
}

function fakePool(client) {
    return { connect: async () => client };
}

test('migration files are validated, ordered and checksummed', async () => {
    await withMigrationDirectory({
        '202608260002_second.sql': 'SELECT 2;',
        '202608260001_first.sql': 'SELECT 1;',
    }, (directory) => {
        const migrations = loadMigrations(directory);
        assert.deepEqual(migrations.map((migration) => migration.version), [
            '202608260001',
            '202608260002',
        ]);
        assert.equal(migrations[0].checksum, sha256('SELECT 1;'));
    });
});

test('invalid and duplicate migration versions are rejected', async () => {
    await withMigrationDirectory({ 'bad-name.sql': 'SELECT 1;' }, (directory) => {
        assert.throws(() => loadMigrations(directory), /Invalid migration filename/);
    });

    await withMigrationDirectory({
        '202608260001_first.sql': 'SELECT 1;',
        '202608260001_second.sql': 'SELECT 2;',
    }, (directory) => {
        assert.throws(() => loadMigrations(directory), /Duplicate migration version/);
    });
});

test('runner applies pending migrations under one transaction and lock', async () => {
    await withMigrationDirectory({
        '202608260001_first.sql': 'CREATE TABLE example(id INT);',
    }, async (directory) => {
        const client = new FakeClient();
        const log = [];
        const result = await runMigrations({
            pool: fakePool(client),
            directory,
            logger: { log: (message) => log.push(message) },
        });

        assert.deepEqual(result.applied, ['202608260001_first.sql']);
        assert.equal(client.queries[0].sql, 'BEGIN');
        assert.match(client.queries[1].sql, /lock_timeout/);
        assert.match(client.queries[2].sql, /pg_advisory_xact_lock/);
        assert.equal(client.queries[2].params[0], 'wolmar-parser-schema-migrations');
        assert.ok(client.queries.some(({ sql }) => sql === 'CREATE TABLE example(id INT);'));
        assert.match(client.queries.at(-2).sql, /INSERT INTO schema_migrations/);
        assert.equal(client.queries.at(-1).sql, 'COMMIT');
        assert.equal(client.released, true);
        assert.match(log[0], /^applied 202608260001_first\.sql/);
    });
});

test('runner skips an unchanged migration and rejects checksum drift', async () => {
    await withMigrationDirectory({
        '202608260001_first.sql': 'SELECT 1;',
    }, async (directory) => {
        const checksum = sha256('SELECT 1;');
        const unchanged = new FakeClient([{
            version: '202608260001',
            name: '202608260001_first.sql',
            checksum,
        }]);
        const result = await runMigrations({
            pool: fakePool(unchanged),
            directory,
            logger: { log() {} },
        });
        assert.deepEqual(result.applied, []);
        assert.equal(unchanged.queries.at(-1).sql, 'COMMIT');

        const changed = new FakeClient([{
            version: '202608260001',
            name: '202608260001_first.sql',
            checksum: '0'.repeat(64),
        }]);
        await assert.rejects(
            runMigrations({
                pool: fakePool(changed),
                directory,
                logger: { log() {} },
            }),
            /differs/,
        );
        assert.equal(changed.queries.at(-1).sql, 'ROLLBACK');
        assert.equal(changed.released, true);
    });
});

test('dry run reports pending migrations without executing their SQL', async () => {
    await withMigrationDirectory({
        '202608260001_first.sql': 'CREATE TABLE must_not_run(id INT);',
    }, async (directory) => {
        const client = new FakeClient();
        const result = await runMigrations({
            pool: fakePool(client),
            directory,
            dryRun: true,
            logger: { log() {} },
        });

        assert.deepEqual(result.pending, ['202608260001_first.sql']);
        assert.ok(!client.queries.some(({ sql }) => sql.includes('must_not_run')));
        assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
    });
});

test('foundation migration is additive and enforces MVP ownership invariants', () => {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', 'sql', '202608260001_collection_mvp_foundation.sql'),
        'utf8',
    );

    assert.match(sql, /CREATE TABLE app_user/);
    assert.match(sql, /CREATE TABLE user_session/);
    assert.match(sql, /CREATE TABLE collection_item/);
    assert.match(sql, /user_id UUID NOT NULL REFERENCES app_user\(id\) ON DELETE CASCADE/);
    assert.match(sql, /type_id INTEGER REFERENCES coin_type\(id\) ON DELETE SET NULL/);
    assert.match(sql, /CREATE UNIQUE INDEX collection_item_user_idempotency_idx/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/g);
    assert.match(sql, /collection_item_sync_type_link_trigger/);
    assert.match(sql, /purchase_price_minor IS NULL\) = \(purchase_currency IS NULL/);
    assert.match(sql, /status <> 'sold' OR sold_at IS NOT NULL/);
    assert.doesNotMatch(sql, /(?:ALTER|DROP|DELETE FROM|TRUNCATE)\s+(?:TABLE\s+)?user_collections/i);
    assert.doesNotMatch(sql, /UNIQUE\s*\(\s*user_id\s*,\s*type_id\s*\)/i);
});

test('photo migration keeps originals private and enforces four ordered slots', () => {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', 'sql', '202608260002_collection_item_photos.sql'),
        'utf8',
    );

    assert.match(sql, /CREATE TABLE collection_item_photo/);
    assert.match(sql, /item_id UUID NOT NULL REFERENCES collection_item\(id\) ON DELETE CASCADE/);
    assert.match(sql, /declared_byte_size > 0 AND declared_byte_size <= 20971520/);
    assert.match(sql, /status IN \('pending', 'processing', 'ready', 'rejected'\)/);
    assert.match(sql, /collection_item_photo_primary_side_idx/);
    assert.match(sql, /collection_item_photo_sort_idx/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /current_setting\('app\.user_id', true\)/);
    assert.doesNotMatch(sql, /PUBLIC|user_collections/i);
});

test('valuation migration stores immutable reproducible snapshots with owner isolation', () => {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', 'sql', '202608260003_collection_valuations.sql'),
        'utf8',
    );

    assert.match(sql, /CREATE FUNCTION collection_normalize_grade/);
    assert.match(sql, /CREATE TABLE collection_valuation/);
    assert.match(sql, /item_id UUID NOT NULL REFERENCES collection_item\(id\) ON DELETE CASCADE/);
    assert.match(sql, /status IN \('ready', 'insufficient_data', 'failed'\)/);
    assert.match(sql, /comparable_count >= 3/);
    assert.match(sql, /basis JSONB NOT NULL/);
    assert.match(sql, /collection_valuation_item_history_idx/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /current_setting\('app\.user_id', true\)/);
    assert.doesNotMatch(sql, /UPDATE collection_valuation|DELETE FROM collection_valuation|user_collections/i);
});
