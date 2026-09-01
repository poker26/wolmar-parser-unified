'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseArgs, syncBatch } = require('../catalog/sync-krause-issues');

test('parseArgs accepts a bounded PDF source filter', () => {
    assert.deepEqual(parseArgs(['--pdf-source=scwc20a_geom_v1', '--batch-size=250', '--apply']), {
        apply: true,
        typeId: null,
        pdfSource: 'scwc20a_geom_v1',
        batchSize: 250,
    });
    assert.throws(() => parseArgs(['--pdf-source=bad/source']), /unsupported characters/);
    assert.throws(() => parseArgs(['--pdf-source=source', '--type-id=42']), /mutually exclusive/);
});

test('syncBatch removes obsolete issue ordinals before rebuilding prices', async () => {
    const statements = [];
    const calls = [];
    const db = {
        async query(sql, parameters) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            statements.push(normalized);
            calls.push({ sql: normalized, parameters });
            if (normalized.startsWith('SELECT id FROM coin_type')) return { rows: [{ id: 42 }] };
            if (normalized.startsWith('INSERT INTO catalog_issue_price')) return { rowCount: 7 };
            if (normalized.startsWith('INSERT INTO catalog_issue')) return { rowCount: 2 };
            return { rowCount: 0, rows: [] };
        },
    };

    const result = await syncBatch(db, 0, 500, null, 'scwc20a_geom_v1');
    const staleDelete = statements.findIndex((sql) => sql.startsWith('DELETE FROM catalog_issue issue'));
    const priceDelete = statements.findIndex((sql) => sql.startsWith('DELETE FROM catalog_issue_price price'));

    assert.notEqual(staleDelete, -1);
    assert.notEqual(priceDelete, -1);
    assert.ok(staleDelete < priceDelete);
    assert.match(statements[staleDelete], /issue\.source_ordinal > jsonb_array_length\(type\.ref_issues\)/);
    const typeSelect = calls.find((call) => call.sql.startsWith('SELECT id FROM coin_type'));
    assert.match(typeSelect.sql,
        /\(\(\$4::text IS NULL AND ref_source = 'scwc'\) OR \(\$4::text IS NOT NULL AND ref_pdf_src = \$4\)\)/);
    assert.deepEqual(typeSelect.parameters, [0, 500, null, 'scwc20a_geom_v1']);
    assert.deepEqual(result, { lastTypeId: 42, types: 1, issues: 2, prices: 7 });
    assert.equal(statements.at(-1), 'COMMIT');
});
