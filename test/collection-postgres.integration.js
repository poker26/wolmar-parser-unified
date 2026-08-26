'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const { CollectionItemService } = require('../app-v1/collection/service');
const {
    normalizeCreatePayload,
    normalizePatchPayload,
    normalizeSoldPayload,
    parseListQuery,
} = require('../app-v1/collection/validation');

const USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';

async function main() {
    if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required');
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
    try {
        await pool.query(`CREATE TABLE coin_type (
            id SERIAL PRIMARY KEY,
            name_full TEXT NOT NULL,
            year INTEGER,
            country TEXT,
            era TEXT,
            metal TEXT,
            mint TEXT,
            image_url TEXT,
            cbr_cat_num TEXT,
            bitkin_number TEXT
        )`);
        const migration = fs.readFileSync(
            path.join(__dirname, '..', 'migrations', 'sql', '202608260001_collection_mvp_foundation.sql'),
            'utf8',
        );
        await pool.query(migration);
        await pool.query(
            `INSERT INTO app_user (id, email_normalized, password_hash, status, email_verified_at)
             VALUES ($1, 'owner@example.test', $3, 'active', now()),
                    ($2, 'other@example.test', $3, 'active', now())`,
            [USER_ID, OTHER_USER_ID, 'x'.repeat(60)],
        );
        const type = await pool.query(
            `INSERT INTO coin_type
                (name_full, year, country, era, metal, mint, bitkin_number)
             VALUES ('1 рубль 1900 СПБ', 1900, 'RU', 'imperial', 'серебро', 'СПБ', '951.299')
             RETURNING id`,
        );
        const typeId = type.rows[0].id;
        const service = new CollectionItemService({ pool });

        const first = await service.create(
            USER_ID,
            normalizeCreatePayload({ typeId, gradeCode: 'XF', purchasePriceMinor: 120000 }),
            'integration-create-0001',
        );
        assert.equal(first.created, true);
        assert.equal(first.item.identificationStatus, 'linked');

        const replay = await service.create(
            USER_ID,
            normalizeCreatePayload({ typeId, gradeCode: 'XF', purchasePriceMinor: 120000 }),
            'integration-create-0001',
        );
        assert.equal(replay.created, false);
        assert.equal(replay.item.id, first.item.id);

        const second = await service.create(
            USER_ID,
            normalizeCreatePayload({ typeId, gradeCode: 'VF' }),
            'integration-create-0002',
        );
        assert.notEqual(second.item.id, first.item.id);

        const draft = await service.create(
            USER_ID,
            normalizeCreatePayload({ userLabel: 'Неопознанная монета' }),
            'integration-create-0003',
        );
        assert.equal(draft.item.identificationStatus, 'unlinked');

        const listed = await service.list(USER_ID, parseListQuery({ limit: '10' }));
        assert.equal(listed.items.length, 3);

        const patched = await service.patch(
            USER_ID,
            draft.item.id,
            normalizePatchPayload({ gradeSystem: 'adjectival', gradeCode: 'F' }),
        );
        assert.equal(patched.gradeCode, 'F');

        const archived = await service.archive(USER_ID, draft.item.id);
        assert.equal(archived.status, 'archived');
        const activated = await service.activate(USER_ID, draft.item.id);
        assert.equal(activated.status, 'active');

        const sold = await service.markSold(
            USER_ID,
            second.item.id,
            normalizeSoldPayload({ soldPriceMinor: 150000, soldAt: '2026-08-26' }),
        );
        assert.equal(sold.status, 'sold');

        const summary = await service.summary(USER_ID);
        assert.equal(summary.total, 3);
        assert.equal(summary.sold, 1);
        assert.equal(summary.distinctTypes, 1);
        assert.equal(summary.duplicates, 1);
        assert.equal(summary.unlinked, 1);

        await assert.rejects(
            service.get(OTHER_USER_ID, first.item.id),
            (error) => error.code === 'item_not_found',
        );

        await service.remove(USER_ID, draft.item.id);
        await assert.rejects(service.get(USER_ID, draft.item.id), (error) => error.code === 'item_not_found');
        const restored = await service.restore(USER_ID, draft.item.id);
        assert.equal(restored.id, draft.item.id);

        await pool.query('DELETE FROM coin_type WHERE id = $1', [typeId]);
        const detached = await service.get(USER_ID, first.item.id);
        assert.equal(detached.typeId, null);
        assert.equal(detached.typeName, '1 рубль 1900 СПБ');
        assert.equal(detached.identificationStatus, 'unlinked');

        console.log('collection PostgreSQL integration passed');
    } finally {
        await pool.end();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
