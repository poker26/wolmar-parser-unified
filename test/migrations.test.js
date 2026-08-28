'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadMigrations, normalizeSql, runMigrations, sha256 } = require('../migrations/lib/runner');

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

test('migration checksums normalize line endings but accept legacy CRLF hashes', async () => {
    const canonical = 'SELECT 1;\nSELECT 2;';
    const legacy = canonical.replace(/\n/g, '\r\n');
    assert.equal(normalizeSql(legacy), canonical);
    await withMigrationDirectory({
        '202608260001_first.sql': legacy,
    }, async (directory) => {
        const migration = loadMigrations(directory)[0];
        assert.equal(migration.checksum, sha256(canonical));
        assert.equal(migration.acceptedChecksums.has(sha256(legacy)), true);
        const client = new FakeClient([{
            version: migration.version,
            name: migration.name,
            checksum: sha256(legacy),
        }]);
        const result = await runMigrations({
            pool: fakePool(client), directory, logger: { log() {} },
        });
        assert.deepEqual(result.applied, []);
        assert.equal(client.queries.at(-1).sql, 'COMMIT');
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

test('data ownership migration queues private exports and delayed erasure', () => {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', 'sql', '202608260004_collection_data_ownership.sql'),
        'utf8',
    );
    assert.match(sql, /CREATE TABLE collection_export/);
    assert.match(sql, /user_id UUID NOT NULL REFERENCES app_user\(id\) ON DELETE CASCADE/);
    assert.match(sql, /collection_export_user_active_idx/);
    assert.match(sql, /CREATE TABLE account_deletion_request/);
    assert.match(sql, /user_id UUID REFERENCES app_user\(id\) ON DELETE SET NULL/);
    assert.match(sql, /status IN \('scheduled', 'processing', 'completed', 'failed', 'cancelled'\)/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/g);
    assert.doesNotMatch(sql, /ALTER TABLE collection_item|DROP TABLE|TRUNCATE/i);
});

test('product analytics migration stores only allowlisted pseudonymous events', () => {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', 'sql', '202608260005_product_analytics.sql'),
        'utf8',
    );
    assert.match(sql, /CREATE TABLE product_event/);
    assert.match(sql, /user_pseudonym CHAR\(64\) NOT NULL/);
    assert.match(sql, /event_name IN \(/);
    assert.match(sql, /collection_export_completed/);
    assert.match(sql, /octet_length\(properties::text\) <= 1024/);
    assert.match(sql, /product_event_deduplication_idx/);
    assert.match(sql, /expires_at TIMESTAMPTZ NOT NULL DEFAULT now\(\) \+ interval '400 days'/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
    assert.doesNotMatch(sql, /^\s*(email|type_id|item_id|photo_id|price|notes)\s+/im);
});

test('security controls migration stores hashed counters and privacy-minimized audit', () => {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', 'sql', '202608260006_security_controls.sql'),
        'utf8',
    );
    assert.match(sql, /CREATE TABLE security_rate_limit/);
    assert.match(sql, /key_hash CHAR\(64\) NOT NULL/);
    assert.match(sql, /PRIMARY KEY \(action, key_hash, window_started_at\)/);
    assert.match(sql, /CREATE TABLE security_audit_event/);
    assert.match(sql, /actor_pseudonym CHAR\(64\) NOT NULL/);
    assert.match(sql, /outcome IN \('succeeded', 'denied', 'failed', 'rate_limited'\)/);
    assert.match(sql, /expires_at TIMESTAMPTZ NOT NULL DEFAULT now\(\) \+ interval '400 days'/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/g);
    assert.doesNotMatch(sql, /^\s*(email|ip_address|request_path|request_body|cookie|token)\s+/im);
});

test('valuation shadow migration isolates non-user-facing comparison results', () => {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', 'sql', '202608280002_valuation_shadow.sql'),
        'utf8',
    );
    assert.match(sql, /CREATE TABLE valuation_shadow_result/);
    assert.match(sql, /target_kind IN \('auction_lot', 'collection_item'\)/);
    assert.match(sql, /exact_comparable_count INTEGER/);
    assert.match(sql, /expanded_comparable_count INTEGER/);
    assert.match(sql, /legacy_median_minor BIGINT/);
    assert.match(sql, /UNIQUE \(run_id, target_kind, target_id\)/);
    assert.match(sql, /never read by user-facing price APIs/);
    assert.doesNotMatch(sql, /ALTER TABLE lot_price_predictions|ALTER TABLE collection_valuation/i);
});

test('valuation backtest migration records observed prices without changing active predictions', () => {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', 'sql', '202608280003_valuation_backtest.sql'),
        'utf8',
    );
    assert.match(sql, /evaluation_kind IN \('online_shadow', 'backtest'\)/);
    assert.match(sql, /actual_minor BIGINT/);
    assert.match(sql, /evaluation_kind <> 'backtest' OR actual_minor IS NOT NULL/);
    assert.doesNotMatch(sql, /lot_price_predictions|collection_valuation/i);
});

test('lot link quality migration adds a non-destructive conflict quarantine', () => {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', 'sql', '202608280004_lot_type_link_quality.sql'),
        'utf8',
    );
    assert.match(sql, /CREATE TABLE lot_type_link_quality/);
    assert.match(sql, /status IN \('consistent', 'conflict', 'unverified'\)/);
    assert.match(sql, /Snapshot of the linked type at audit time/);
    assert.match(sql, /conflicts are quarantined, never auto-relinked/);
    assert.doesNotMatch(sql, /UPDATE lot_type_link|DELETE FROM lot_type_link|ALTER TABLE lot_type_link/i);
});

test('lot link repair log preserves reversible evidence without changing links in migration', () => {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', 'sql', '202608280005_lot_type_link_repair_log.sql'),
        'utf8',
    );
    assert.match(sql, /CREATE TABLE lot_type_link_repair_log/);
    assert.match(sql, /old_type_id INTEGER NOT NULL/);
    assert.match(sql, /new_type_id INTEGER NOT NULL/);
    assert.match(sql, /Append-only evidence/);
    assert.doesNotMatch(sql, /UPDATE lot_type_link|DELETE FROM lot_type_link/i);
});

test('Bitkin repair reason is added without mutating any lot link', () => {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', 'sql', '202608280006_bitkin_exact_repair_reason.sql'),
        'utf8',
    );
    assert.match(sql, /bitkin_exact_reference/);
    assert.match(sql, /lot_type_link_repair_log_repair_reason_check/);
    assert.doesNotMatch(sql, /UPDATE lot_type_link|DELETE FROM lot_type_link|INSERT INTO lot_type_link/i);
});

test('slab storage migration is additive and keeps missing evidence unknown', () => {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', 'sql', '202608280001_slab_aware_storage.sql'),
        'utf8',
    );

    assert.match(sql, /ALTER TABLE auction_lots/);
    assert.match(sql, /ALTER TABLE collection_item/);
    assert.match(sql, /ALTER TABLE collection_valuation/);
    assert.match(sql, /slab_status TEXT NOT NULL DEFAULT 'unknown'/g);
    assert.match(sql, /grading_company_code IN \(/);
    assert.match(sql, /slab_grade_code TEXT/);
    assert.match(sql, /slab_extractor_version TEXT/);
    assert.match(sql, /slab_evidence_text TEXT/);
    assert.match(sql, /exact_comparable_count INTEGER/);
    assert.match(sql, /expanded_comparable_count INTEGER/);
    assert.match(sql, /grade_source <> 'slab_label' OR slab_status = 'slabbed'/);
    assert.match(sql, /auction_lots_slab_status_check[\s\S]*NOT VALID/);
    assert.doesNotMatch(sql, /ALTER TABLE coin_type|UPDATE auction_lots|UPDATE collection_item/i);
    assert.doesNotMatch(sql, /CREATE INDEX/i);
});
