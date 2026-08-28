'use strict';

const path = require('node:path');

const appRoot = process.env.WOLMAR_APP_ROOT || process.cwd();
const domainRoot = process.env.WOLMAR_SLAB_DOMAIN_ROOT || appRoot;
const { pool } = require(path.join(appRoot, 'catalog', 'db'));
const { extractSlabInfo } = require(path.join(domainRoot, 'domain', 'slab-info'));

function integerArg(name, fallback) {
    const prefix = `--${name}=`;
    const raw = process.argv.find((value) => value.startsWith(prefix));
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw.slice(prefix.length), 10);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new TypeError(`${name} must be a non-negative integer`);
    }
    return parsed;
}

function increment(object, key, amount = 1) {
    object[key] = (object[key] || 0) + amount;
}

function incrementMap(map, key, amount = 1) {
    map.set(key, (map.get(key) || 0) + amount);
}

function completedSale(row) {
    if (!['closed', 'sold'].includes(String(row.lot_status || '').toLowerCase())) return false;
    if (!(Number(row.winning_bid) > 0)) return false;
    return !row.auction_end_date || new Date(row.auction_end_date).getTime() <= Date.now();
}

function possibleUnknownCompany(evidenceText) {
    if (!evidenceText) return null;
    const match = evidenceText.match(
        /(?:(?:в|во)\s+(?:слабе|холдере)|(?:slab|holder|slabbed))\s*[:;,\-]?\s*([A-ZА-ЯЁ][A-ZА-ЯЁ.\-]{1,15})/iu,
    );
    if (!match) return null;
    const candidate = match[1].toUpperCase();
    if (/^(?:MS|PF|PR|SP|AU|XF|VF|VG|F|G)\d/.test(candidate)) return null;
    return candidate;
}

function comparableBucket(count) {
    if (count === 1) return '1';
    if (count === 2) return '2';
    if (count <= 4) return '3-4';
    if (count <= 9) return '5-9';
    return '10+';
}

async function updateBatch(rows) {
    if (!rows.length) return;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const parameters = [];
        const tuples = rows.map((row, index) => {
            const slab = row.slab;
            parameters.push(
                row.id,
                slab.slabStatus,
                slab.gradingCompanyCode,
                slab.gradingCompanyRaw,
                slab.gradeSource === 'slab_label' ? slab.gradeCode : null,
                slab.gradeSource,
                slab.extractorVersion,
                slab.evidenceText,
            );
            const offset = index * 8;
            return `(
                $${offset + 1}::integer,
                $${offset + 2}::text,
                $${offset + 3}::text,
                $${offset + 4}::text,
                $${offset + 5}::text,
                $${offset + 6}::text,
                $${offset + 7}::text,
                $${offset + 8}::text
            )`;
        });
        await client.query(`
            WITH extracted (
                id,
                slab_status,
                grading_company_code,
                grading_company_raw,
                slab_grade_code,
                grade_source,
                slab_extractor_version,
                slab_evidence_text
            ) AS (VALUES ${tuples.join(',')})
            UPDATE auction_lots al
            SET slab_status = extracted.slab_status,
                grading_company_code = extracted.grading_company_code,
                grading_company_raw = extracted.grading_company_raw,
                slab_grade_code = extracted.slab_grade_code,
                grade_source = extracted.grade_source,
                slab_extractor_version = extracted.slab_extractor_version,
                slab_evidence_text = extracted.slab_evidence_text
            FROM extracted
            WHERE al.id = extracted.id
              AND al.grade_source <> 'user'
              AND ROW(
                    al.slab_status,
                    al.grading_company_code,
                    al.grading_company_raw,
                    al.slab_grade_code,
                    al.grade_source,
                    al.slab_extractor_version,
                    al.slab_evidence_text
                  ) IS DISTINCT FROM ROW(
                    extracted.slab_status,
                    extracted.grading_company_code,
                    extracted.grading_company_raw,
                    extracted.slab_grade_code,
                    extracted.grade_source,
                    extracted.slab_extractor_version,
                    extracted.slab_evidence_text
                  )
        `, parameters);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function main() {
    const write = process.argv.includes('--write');
    if (write && !process.argv.includes('--confirmed')) {
        throw new Error('--write requires the additional --confirmed safeguard');
    }
    const batchSize = Math.min(integerArg('batch-size', 2000), 5000);
    const limit = integerArg('limit', 0);
    const sampleLimit = integerArg('samples', 100);
    let afterId = integerArg('after-id', 0);
    let processed = 0;
    const report = {
        mode: write ? 'write' : 'dry-run',
        extractorVersion: 'slab-info-v1',
        generatedAt: new Date().toISOString(),
        afterId,
        limit: limit || null,
        totals: { lots: 0, slabbed: 0, raw: 0, unknown: 0, labelGrades: 0 },
        bySource: {},
        companies: {},
        rawCompanySpellings: {},
        unknownCompanyTokens: {},
        comparableGroupBuckets: {},
        manualSamples: [],
    };
    const comparableGroups = new Map();
    const sampleKeys = new Map();

    while (!limit || processed < limit) {
        const take = limit ? Math.min(batchSize, limit - processed) : batchSize;
        const result = await pool.query(`
            SELECT al.id,
                   COALESCE(al.source_site, 'unknown') AS source_site,
                   al.coin_description,
                   al.condition,
                   al.winning_bid,
                   al.lot_status,
                   al.auction_end_date,
                   linked.type_id
            FROM auction_lots al
            LEFT JOIN LATERAL (
                SELECT ltl.type_id
                FROM lot_type_link ltl
                WHERE ltl.lot_id = al.id
                ORDER BY ltl.type_id
                LIMIT 1
            ) linked ON true
            WHERE al.id > $1
            ORDER BY al.id
            LIMIT $2
        `, [afterId, take]);
        if (!result.rows.length) break;

        const writes = [];
        for (const row of result.rows) {
            const slab = extractSlabInfo({
                description: row.coin_description,
                condition: row.condition,
            });
            writes.push({ id: row.id, slab });
            processed++;
            report.totals.lots++;
            increment(report.totals, slab.slabStatus);
            if (slab.gradeSource === 'slab_label') report.totals.labelGrades++;

            const source = report.bySource[row.source_site] || {
                lots: 0,
                slabbed: 0,
                raw: 0,
                unknown: 0,
                labelGrades: 0,
            };
            source.lots++;
            source[slab.slabStatus]++;
            if (slab.gradeSource === 'slab_label') source.labelGrades++;
            report.bySource[row.source_site] = source;

            if (slab.gradingCompanyCode) increment(report.companies, slab.gradingCompanyCode);
            if (slab.gradingCompanyRaw) increment(report.rawCompanySpellings, slab.gradingCompanyRaw);
            if (slab.slabStatus === 'slabbed' && slab.gradingCompanyCode === 'OTHER') {
                increment(report.unknownCompanyTokens, slab.gradingCompanyRaw || 'unreadable');
            } else if (slab.slabStatus === 'slabbed' && !slab.gradingCompanyCode) {
                const possible = possibleUnknownCompany(slab.evidenceText);
                if (possible) increment(report.unknownCompanyTokens, possible);
            }

            const sampleKey = `${row.source_site}|${slab.slabStatus}|${slab.gradingCompanyCode || 'none'}`;
            const samplesForKey = sampleKeys.get(sampleKey) || 0;
            if (
                report.manualSamples.length < sampleLimit
                && (slab.slabStatus !== 'unknown' || slab.gradingCompanyCode)
                && samplesForKey < 5
            ) {
                report.manualSamples.push({
                    id: row.id,
                    sourceSite: row.source_site,
                    condition: row.condition,
                    extracted: slab,
                    description: String(row.coin_description || '').slice(0, 500),
                });
                sampleKeys.set(sampleKey, samplesForKey + 1);
            }

            if (row.type_id && completedSale(row)) {
                const groupKey = [
                    row.type_id,
                    slab.gradeCode || 'none',
                    slab.slabStatus,
                    slab.gradingCompanyCode || 'none',
                ].join('|');
                incrementMap(comparableGroups, groupKey);
            }
            afterId = Number(row.id);
        }

        if (write) await updateBatch(writes);
        process.stderr.write(`processed=${processed} afterId=${afterId}\r`);
    }

    for (const count of comparableGroups.values()) {
        increment(report.comparableGroupBuckets, comparableBucket(count));
    }
    report.lastId = afterId;
    report.comparableGroups = comparableGroups.size;
    report.manualSamples = report.manualSamples.slice(0, sampleLimit);
    process.stderr.write('\n');
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main()
    .finally(() => pool.end())
    .catch((error) => {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    });
