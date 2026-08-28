'use strict';

const { pool } = require('../catalog/db');

async function main() {
    const [sources, importedSamples, references, columns, tables] = await Promise.all([
        pool.query(
            `SELECT COALESCE(source, 'unknown') AS source,
                    COALESCE(ref_source, 'unknown') AS ref_source,
                    COALESCE(era, 'unknown') AS era,
                    count(*)::int AS types,
                    count(*) FILTER (WHERE bitkin_number IS NOT NULL)::int AS with_bitkin
             FROM coin_type
             WHERE era = 'imperial' OR bitkin_number IS NOT NULL
             GROUP BY COALESCE(source, 'unknown'), COALESCE(ref_source, 'unknown'), COALESCE(era, 'unknown')
             ORDER BY types DESC`,
        ),
        pool.query(
            `SELECT id,
                    name_full,
                    source_card_id,
                    type_key,
                    denomination_text,
                    denomination_value,
                    year,
                    mint,
                    ref_source,
                    ref_issues,
                    ref_prices
             FROM coin_type
             WHERE source = 'bitkin'
             ORDER BY id
             LIMIT 20`,
        ),
        pool.query(
            `SELECT bitkin_number,
                    count(*)::int AS types,
                    array_agg(id ORDER BY id) AS type_ids,
                    array_agg(name_full ORDER BY id) AS names
             FROM coin_type
             WHERE bitkin_number IN ('901.553', '441', '543', '545', '558')
             GROUP BY bitkin_number
             ORDER BY bitkin_number`,
        ),
        pool.query(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'coin_type'
               AND (column_name ILIKE '%bitkin%' OR column_name ILIKE '%catalog%' OR column_name ILIKE '%reference%')
             ORDER BY ordinal_position`,
        ),
        pool.query(
            `SELECT table_name
             FROM information_schema.tables
             WHERE table_schema = 'public'
               AND table_name IN ('coin_ref_raw', 'bitkin_import_page', 'bitkin_entry', 'bitkin_coin_type_match')
             ORDER BY table_name`,
        ),
    ]);

    const presentTables = new Set(tables.rows.map((row) => row.table_name));
    const shadow = {};
    if (presentTables.has('coin_ref_raw')) {
        shadow.rawSources = (await pool.query(
            `SELECT source,
                    count(*)::int AS pages,
                    min(page_no)::int AS min_page,
                    max(page_no)::int AS max_page
             FROM coin_ref_raw
             WHERE source LIKE 'bitkin_%'
             GROUP BY source
             ORDER BY source`,
        )).rows;
    }
    if (presentTables.has('bitkin_import_page')) {
        shadow.importPages = (await pool.query(
            `SELECT source,
                    count(*)::int AS pages,
                    sum(extracted_entries)::int AS extracted_entries,
                    sum(needs_review)::int AS needs_review,
                    min(pdf_page)::int AS min_pdf_page,
                    max(pdf_page)::int AS max_pdf_page
             FROM bitkin_import_page
             GROUP BY source
             ORDER BY source`,
        )).rows;
    }
    if (presentTables.has('bitkin_entry')) {
        shadow.entries = (await pool.query(
            `SELECT source,
                    count(*)::int AS entries,
                    count(DISTINCT bitkin_reference)::int AS distinct_references,
                    count(bitkin_reference)::int AS with_reference,
                    count(year)::int AS with_year,
                    count(denomination)::int AS with_denomination,
                    count(mint_mark)::int AS with_mint_mark,
                    count(*) FILTER (WHERE status <> 'extracted')::int AS needs_review
             FROM bitkin_entry
             GROUP BY source
             ORDER BY source`,
        )).rows;
        shadow.referenceSamples = (await pool.query(
            `SELECT id, source, pdf_page, printed_page, bitkin_reference,
                    bitkin_number, year, denomination, ruler, mint, mint_mark,
                    variant, rarity, status
             FROM bitkin_entry
             WHERE bitkin_reference IN ('901.553', '441', '543', '545', '558')
                OR bitkin_number_norm IN ('441', '543', '545', '553', '558')
             ORDER BY bitkin_reference, source, id
             LIMIT 100`,
        )).rows;
    }
    if (presentTables.has('bitkin_coin_type_match')) {
        shadow.matches = (await pool.query(
            `SELECT match_method, status, match_confidence,
                    count(*)::int AS matches,
                    count(DISTINCT entry_id)::int AS entries,
                    count(DISTINCT type_id)::int AS types
             FROM bitkin_coin_type_match
             GROUP BY match_method, status, match_confidence
             ORDER BY matches DESC`,
        )).rows;
    }
    console.log(JSON.stringify({
        shadowTables: [...presentTables],
        shadow,
        sourceCoverage: sources.rows,
        sampledReferences: references.rows,
        relevantColumns: columns.rows.map((row) => row.column_name),
        importedSamples: importedSamples.rows,
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => pool.end());
