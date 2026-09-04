/**
 * Управление реестром источников каталога. Физического удаления нет: retire сохраняет историю.
 *
 * node catalog/source-registry.js list [--status proposed] [--kind shop]
 * node catalog/source-registry.js due [limit]
 * node catalog/source-registry.js show <source-key>
 * node catalog/source-registry.js add <key> <name> <url> <kind> <tier> <role>
 * node catalog/source-registry.js set-status <key> <status>
 * node catalog/source-registry.js set-access <key> <unknown|allowed|restricted|blocked>
 * node catalog/source-registry.js set-adapter <key> <adapter-key>
 * node catalog/source-registry.js schedule <key> <PostgreSQL interval>
 * node catalog/source-registry.js retire <key> [note]
 */
'use strict';

const SOURCE_KINDS = new Set([
    'auction_house', 'marketplace', 'shop', 'specialist_catalog', 'central_bank', 'mint', 'producer',
]);
const EVIDENCE_TIERS = new Set(['primary', 'reference', 'dealer', 'marketplace']);
const CATALOG_ROLES = new Set(['discovery', 'confirmation', 'both']);
const SOURCE_STATUSES = new Set(['proposed', 'probing', 'active', 'paused', 'blocked', 'retired']);
const ACCESS_STATUSES = new Set(['unknown', 'allowed', 'restricted', 'blocked']);
const RUN_KINDS = new Set(['probe', 'incremental', 'backfill']);
const RUN_STATUSES = new Set(['succeeded', 'partial', 'failed', 'cancelled']);

function option(args, name) {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : null;
}

function assertOneOf(label, value, allowed) {
    if (!allowed.has(value)) throw new Error(`${label}: недопустимое значение ${value || '(пусто)'}`);
    return value;
}

function sourceKey(value) {
    const key = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(key)) throw new Error('source-key должен быть доменным ключом в ASCII');
    return key;
}

async function listSources(db, { status = null, kind = null, dueOnly = false, limit = 200 } = {}) {
    const params = [];
    const where = [];
    if (status) { params.push(status); where.push(`status=$${params.length}`); }
    if (kind) { params.push(kind); where.push(`source_kind=$${params.length}`); }
    if (dueOnly) where.push("status IN ('probing','active') AND adapter_key IS NOT NULL AND next_poll_at <= now()");
    params.push(limit);
    return (await db.query(
        `SELECT source_key,display_name,source_kind,home_country,evidence_tier,catalog_role,
                price_role,status,priority,adapter_key,poll_interval::text AS poll_interval,next_poll_at,
                access_review_status,last_success_at,last_failure_at,last_error
           FROM catalog_source ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY priority,display_name LIMIT $${params.length}`,
        params,
    )).rows;
}

async function setStatus(db, key, status) {
    assertOneOf('status', status, SOURCE_STATUSES);
    const result = await db.query(
        `UPDATE catalog_source
            SET status=$2,retired_at=CASE WHEN $2='retired' THEN now() ELSE NULL END,updated_at=now()
          WHERE source_key=$1 AND ($2<>'active' OR adapter_key IS NOT NULL) RETURNING *`,
        [sourceKey(key), status],
    );
    if (!result.rows.length) throw new Error(`источник ${key} не найден или для active не задан адаптер`);
    return result.rows[0];
}

async function startSourceRun(db, key, runKind) {
    assertOneOf('run-kind', runKind, RUN_KINDS);
    const result = await db.query(
        `WITH source AS (
           SELECT source_key FROM catalog_source
            WHERE source_key=$1 AND status IN ('probing','active') AND adapter_key IS NOT NULL
         ), run AS (
           INSERT INTO catalog_source_run (source_key,run_kind)
           SELECT source_key,$2 FROM source RETURNING *
         )
         touched AS (
           UPDATE catalog_source s SET
             last_probe_at=CASE WHEN $2='probe' THEN now() ELSE s.last_probe_at END,
             updated_at=now()
           FROM run WHERE s.source_key=run.source_key
           RETURNING s.source_key
         )
         SELECT run.* FROM run JOIN touched USING (source_key)`,
        [sourceKey(key), runKind],
    );
    if (!result.rows.length) throw new Error(`источник ${key} не активен для запуска`);
    return result.rows[0];
}

async function finishSourceRun(db, runId, status, stats = {}) {
    assertOneOf('run-status', status, RUN_STATUSES);
    const numericRunId = Number(runId);
    if (!Number.isInteger(numericRunId) || numericRunId <= 0) throw new Error('run-id должен быть положительным целым');
    const number = (name) => {
        const value = Number(stats[name] || 0);
        if (!Number.isInteger(value) || value < 0) throw new Error(`${name} должен быть неотрицательным целым`);
        return value;
    };
    const externalCost = stats.externalCost == null ? null : Number(stats.externalCost);
    if (externalCost != null && (!Number.isFinite(externalCost) || externalCost < 0)) {
        throw new Error('externalCost должен быть неотрицательным числом');
    }
    const result = await db.query(
        `WITH finished AS (
           UPDATE catalog_source_run SET
             status=$2,finished_at=now(),pages_fetched=$3,items_seen=$4,
             observations_saved=$5,candidates_staged=$6,errors_count=$7,
             external_cost=$8,cursor=$9,error_summary=$10
           WHERE id=$1 AND status='running' RETURNING *
         )
         touched AS (
           UPDATE catalog_source s SET
             last_success_at=CASE WHEN finished.status IN ('succeeded','partial') THEN now() ELSE s.last_success_at END,
             last_failure_at=CASE WHEN finished.status='failed' THEN now() ELSE s.last_failure_at END,
             last_error=CASE WHEN finished.status='failed' THEN finished.error_summary ELSE NULL END,
             next_poll_at=CASE WHEN s.poll_interval IS NULL OR s.status NOT IN ('probing','active')
                               THEN NULL ELSE now()+s.poll_interval END,
             updated_at=now()
           FROM finished WHERE s.source_key=finished.source_key
           RETURNING s.source_key
         )
         SELECT finished.* FROM finished JOIN touched USING (source_key)`,
        [
            numericRunId, status, number('pagesFetched'), number('itemsSeen'),
            number('observationsSaved'), number('candidatesStaged'), number('errorsCount'),
            externalCost,
            stats.cursor == null ? null : stats.cursor,
            stats.errorSummary || null,
        ],
    );
    if (!result.rows.length) throw new Error(`активный запуск ${runId} не найден`);
    return result.rows[0];
}

function printRows(rows) {
    for (const row of rows) {
        const schedule = row.poll_interval ? ` · ${row.poll_interval}` : '';
        const adapter = row.adapter_key ? ` · adapter=${row.adapter_key}` : '';
        console.log(`${String(row.priority).padStart(2)} · ${row.status.padEnd(8)} · ${row.source_key} · ${row.source_kind} · ${row.evidence_tier}/${row.catalog_role}${adapter}${schedule}`);
    }
}

async function main(args, db) {
    const command = args[0] || 'list';
    if (command === 'list' || command === 'due') {
        const status = option(args, 'status');
        const kind = option(args, 'kind');
        if (status) assertOneOf('status', status, SOURCE_STATUSES);
        if (kind) assertOneOf('kind', kind, SOURCE_KINDS);
        const rawLimit = command === 'due' ? Number(args[1]) : Number(option(args, 'limit'));
        const limit = Math.min(Math.max(rawLimit || 200, 1), 1000);
        printRows(await listSources(db, { status, kind, dueOnly: command === 'due', limit }));
        return;
    }

    if (command === 'show') {
        const key = sourceKey(args[1]);
        const source = (await db.query('SELECT * FROM catalog_source WHERE source_key=$1', [key])).rows[0];
        if (!source) throw new Error(`источник ${key} не найден`);
        const runs = (await db.query(
            'SELECT * FROM catalog_source_run WHERE source_key=$1 ORDER BY started_at DESC LIMIT 20',
            [key],
        )).rows;
        console.log(JSON.stringify({ source, recentRuns: runs }, null, 2));
        return;
    }

    if (command === 'add') {
        const [keyArg, name, url, kind, tier, role] = args.slice(1);
        const key = sourceKey(keyArg);
        assertOneOf('kind', kind, SOURCE_KINDS);
        assertOneOf('tier', tier, EVIDENCE_TIERS);
        assertOneOf('role', role, CATALOG_ROLES);
        if (!name) throw new Error('не задано название источника');
        const parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('base URL должен быть HTTP(S)');
        const row = (await db.query(
            `INSERT INTO catalog_source
               (source_key,display_name,base_url,source_kind,evidence_tier,catalog_role,price_role,status)
             VALUES ($1,$2,$3,$4,$5,$6,'none','proposed')
             ON CONFLICT (source_key) DO UPDATE SET
               display_name=EXCLUDED.display_name,base_url=EXCLUDED.base_url,
               source_kind=EXCLUDED.source_kind,evidence_tier=EXCLUDED.evidence_tier,
               catalog_role=EXCLUDED.catalog_role,updated_at=now()
             RETURNING *`,
            [key, name, parsedUrl.href, kind, tier, role],
        )).rows[0];
        console.log(JSON.stringify(row, null, 2));
        return;
    }

    const key = sourceKey(args[1]);
    if (command === 'set-status') {
        console.log(JSON.stringify(await setStatus(db, key, args[2]), null, 2));
        return;
    }
    if (command === 'set-access') {
        const access = assertOneOf('access', args[2], ACCESS_STATUSES);
        const row = (await db.query(
            `UPDATE catalog_source SET access_review_status=$2,access_reviewed_at=now(),updated_at=now()
              WHERE source_key=$1 RETURNING *`,
            [key, access],
        )).rows[0];
        if (!row) throw new Error(`источник ${key} не найден`);
        console.log(JSON.stringify(row, null, 2));
        return;
    }
    if (command === 'set-adapter') {
        if (!args[2]) throw new Error('не задан adapter-key');
        const row = (await db.query(
            'UPDATE catalog_source SET adapter_key=$2,updated_at=now() WHERE source_key=$1 RETURNING *',
            [key, args[2]],
        )).rows[0];
        if (!row) throw new Error(`источник ${key} не найден`);
        console.log(JSON.stringify(row, null, 2));
        return;
    }
    if (command === 'schedule') {
        if (!args[2]) throw new Error('не задан интервал, например "1 day"');
        const row = (await db.query(
            `UPDATE catalog_source SET poll_interval=$2::interval,
                    next_poll_at=COALESCE(next_poll_at,now()),updated_at=now()
              WHERE source_key=$1 RETURNING *`,
            [key, args[2]],
        )).rows[0];
        if (!row) throw new Error(`источник ${key} не найден`);
        console.log(JSON.stringify(row, null, 2));
        return;
    }
    if (command === 'retire') {
        const note = args.slice(2).join(' ').trim() || null;
        const row = (await db.query(
            `UPDATE catalog_source SET status='retired',retired_at=now(),
                    notes=CASE WHEN $2::text IS NULL THEN notes ELSE concat_ws(E'\n',NULLIF(notes,''),$2) END,
                    updated_at=now()
              WHERE source_key=$1 RETURNING *`,
            [key, note],
        )).rows[0];
        if (!row) throw new Error(`источник ${key} не найден`);
        console.log(JSON.stringify(row, null, 2));
        return;
    }
    throw new Error(`неизвестная команда ${command}`);
}

if (require.main === module) {
    const { pool } = require('./db');
    main(process.argv.slice(2), pool)
        .catch((error) => { console.error('FATAL', error.message); process.exitCode = 1; })
        .finally(() => pool.end());
}

module.exports = {
    ACCESS_STATUSES,
    CATALOG_ROLES,
    EVIDENCE_TIERS,
    RUN_KINDS,
    RUN_STATUSES,
    SOURCE_KINDS,
    SOURCE_STATUSES,
    finishSourceRun,
    listSources,
    main,
    setStatus,
    sourceKey,
    startSourceRun,
};
