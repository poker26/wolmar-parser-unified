'use strict';

const { pool } = require('./db');

const DEFAULT_BATCH_SIZE = 500;

function parseArgs(argv) {
    const apply = argv.includes('--apply');
    const typeArg = argv.find((arg) => arg.startsWith('--type-id='));
    const batchArg = argv.find((arg) => arg.startsWith('--batch-size='));
    const typeId = typeArg ? Number(typeArg.slice('--type-id='.length)) : null;
    const batchSize = batchArg ? Number(batchArg.slice('--batch-size='.length)) : DEFAULT_BATCH_SIZE;
    if (typeArg && (!Number.isSafeInteger(typeId) || typeId <= 0)) throw new Error('type-id must be a positive integer');
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 5000) throw new Error('batch-size must be between 1 and 5000');
    return { apply, typeId, batchSize };
}

async function inventory(db, typeId = null) {
    const result = await db.query(
        `SELECT count(*)::int types,
                COALESCE(sum(jsonb_array_length(ref_issues)), 0)::int issues,
                count(*) FILTER (
                    WHERE EXISTS (
                        SELECT 1 FROM jsonb_array_elements(ref_issues) issue
                        WHERE jsonb_typeof(issue->'prices') = 'object'
                          AND EXISTS (
                              SELECT 1 FROM jsonb_each(issue->'prices') price
                              WHERE price.value <> 'null'::jsonb
                          )
                    )
                )::int types_with_prices
         FROM coin_type
         WHERE ref_source = 'scwc'
           AND jsonb_typeof(ref_issues) = 'array'
           AND ($1::int IS NULL OR id = $1)`,
        [typeId],
    );
    return result.rows[0];
}

async function syncBatch(db, afterTypeId, batchSize, onlyTypeId = null) {
    await db.query('BEGIN');
    try {
        const types = await db.query(
            `SELECT id
             FROM coin_type
             WHERE ref_source = 'scwc'
               AND jsonb_typeof(ref_issues) = 'array'
               AND id > $1
               AND ($3::int IS NULL OR id = $3)
             ORDER BY id
             LIMIT $2`,
            [afterTypeId, batchSize, onlyTypeId],
        );
        if (!types.rows.length) {
            await db.query('COMMIT');
            return null;
        }
        const typeIds = types.rows.map((row) => row.id);

        const issues = await db.query(
            `INSERT INTO catalog_issue (
                type_id, source, source_ordinal, year, year_label, mint, variety,
                mintage, ref_pdf_src, ref_pdf_page, source_data, updated_at
             )
             SELECT ct.id,
                    'scwc',
                    src.ordinality::int,
                    CASE
                        WHEN substring(src.issue->>'year' from '(\\d{4})') ~ '^(1[0-9]{3}|20[0-9]{2}|21[0-9]{2}|2200)$'
                        THEN substring(src.issue->>'year' from '(\\d{4})')::int
                    END,
                    NULLIF(btrim(src.issue->>'year'), ''),
                    NULLIF(btrim(COALESCE(src.issue->>'mint', src.issue->>'mintmark', src.issue->>'mint_mark')), ''),
                    NULLIF(btrim(COALESCE(src.issue->>'variety', src.issue->>'note', src.issue->>'notes')), ''),
                    CASE
                        WHEN regexp_replace(COALESCE(src.issue->>'mintage', ''), '[^0-9]', '', 'g') <> ''
                        THEN regexp_replace(src.issue->>'mintage', '[^0-9]', '', 'g')::bigint
                    END,
                    ct.ref_pdf_src,
                    ct.ref_pdf_page,
                    src.issue,
                    now()
             FROM coin_type ct
             CROSS JOIN LATERAL jsonb_array_elements(ct.ref_issues) WITH ORDINALITY src(issue, ordinality)
             WHERE ct.id = ANY($1::int[])
             ON CONFLICT (type_id, source, source_ordinal) DO UPDATE SET
                year = EXCLUDED.year,
                year_label = EXCLUDED.year_label,
                mint = EXCLUDED.mint,
                variety = EXCLUDED.variety,
                mintage = EXCLUDED.mintage,
                ref_pdf_src = EXCLUDED.ref_pdf_src,
                ref_pdf_page = EXCLUDED.ref_pdf_page,
                source_data = EXCLUDED.source_data,
                updated_at = now()
             RETURNING id`,
            [typeIds],
        );

        await db.query(
            `DELETE FROM catalog_issue_price price
             USING catalog_issue issue
             WHERE price.issue_id = issue.id
               AND issue.type_id = ANY($1::int[])`,
            [typeIds],
        );
        const prices = await db.query(
            `INSERT INTO catalog_issue_price (
                issue_id, source_label, price_kind, grade_code, currency, amount_minor, source_value
             )
             SELECT issue.id,
                    upper(regexp_replace(btrim(price.key), '\\s+', '', 'g')),
                    classified.price_kind,
                    classified.grade_code,
                    'USD',
                    round(replace(btrim(price.value), ',', '.')::numeric * 100)::bigint,
                    price.value
             FROM catalog_issue issue
             CROSS JOIN LATERAL jsonb_each_text(
                CASE WHEN jsonb_typeof(issue.source_data->'prices') = 'object'
                     THEN issue.source_data->'prices'
                     ELSE '{}'::jsonb
                END
             ) price
             CROSS JOIN LATERAL catalog_classify_krause_price_label(price.key) classified
             WHERE issue.type_id = ANY($1::int[])
               AND btrim(price.value) ~ '^[0-9]+([.,][0-9]+)?$'
             ON CONFLICT (issue_id, source_label, currency) DO UPDATE SET
                price_kind = EXCLUDED.price_kind,
                grade_code = EXCLUDED.grade_code,
                amount_minor = EXCLUDED.amount_minor,
                source_value = EXCLUDED.source_value
             RETURNING issue_id`,
            [typeIds],
        );
        await db.query('COMMIT');
        return {
            lastTypeId: typeIds.at(-1),
            types: typeIds.length,
            issues: issues.rowCount,
            prices: prices.rowCount,
        };
    } catch (error) {
        await db.query('ROLLBACK');
        throw error;
    }
}

async function syncAll(db, { batchSize = DEFAULT_BATCH_SIZE, typeId = null, onBatch = () => {} } = {}) {
    let afterTypeId = typeId ? typeId - 1 : 0;
    const totals = { types: 0, issues: 0, prices: 0 };
    while (true) {
        const batch = await syncBatch(db, afterTypeId, batchSize, typeId);
        if (!batch) break;
        totals.types += batch.types;
        totals.issues += batch.issues;
        totals.prices += batch.prices;
        afterTypeId = batch.lastTypeId;
        onBatch({ ...batch, totals: { ...totals } });
        if (typeId) break;
    }
    return totals;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    try {
        const found = await inventory(pool, options.typeId);
        console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', ...found }, null, 2));
        if (!options.apply) return;
        const totals = await syncAll(pool, {
            batchSize: options.batchSize,
            typeId: options.typeId,
            onBatch: ({ lastTypeId, totals: progress }) => {
                console.log(`through type ${lastTypeId}: ${progress.types} types, ${progress.issues} issues, ${progress.prices} prices`);
            },
        });
        console.log(JSON.stringify({ synced: totals }, null, 2));
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    });
}

module.exports = { DEFAULT_BATCH_SIZE, inventory, parseArgs, syncAll, syncBatch };
