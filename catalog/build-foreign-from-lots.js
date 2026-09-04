/**
 * Кандидаты современных типов из любых наблюдений 2019+: проданных, активных и непроданных.
 *
 * Скрипт не публикует coin_type. С --apply он идемпотентно наполняет catalog_candidate и сохраняет
 * точные lot_id/URL, на которых основан каждый кандидат. Публикация выполняется отдельной явной
 * командой promote-catalog-candidate.js после просмотра доказательств.
 *
 * node catalog/build-foreign-from-lots.js [--from 2019] [--min 1] [--show 40] [--apply]
 */
'use strict';

const { pool } = require('./db');
const { DIAG, parseTitle, matchType } = require('./coin-matcher');
const { deriveCatalogCandidate, stageCatalogCandidate } = require('./catalog-candidates');

const arg = (name, fallback) => {
    const index = process.argv.indexOf(`--${name}`);
    return index > -1 ? Number(process.argv[index + 1]) : fallback;
};

async function main() {
    const apply = process.argv.includes('--apply');
    const from = arg('from', 2019);
    const minimumEvidence = arg('min', 1);
    const show = arg('show', 40);
    DIAG.on = true;
    console.log(`${apply ? '(ЗАПИСЬ КАНДИДАТОВ)' : '(сухой прогон)'} с ${from} года, порог ${minimumEvidence}`);

    const rows = (await pool.query(
        `SELECT a.id,a.coin_description,a.source_site,a.lot_number,a.source_url,a.lot_status
           FROM auction_lots a
           LEFT JOIN lot_type_link l ON l.lot_id=a.id
          WHERE l.lot_id IS NULL AND a.coin_description IS NOT NULL AND a.year >= $1`,
        [from],
    )).rows;
    console.log(`несвязанных наблюдений с ${from} года: ${rows.length}`);

    const groups = new Map();
    for (const row of rows) {
        const parsed = parseTitle(row.coin_description);
        if (!parsed.denom || !parsed.year || parsed.year < from) continue;
        let match = null;
        try { match = await matchType(pool, parsed); } catch (_) { continue; }
        const matchReason = DIAG.reason;
        if (match || !/нет типа/.test(String(matchReason || ''))) continue;
        const candidate = await deriveCatalogCandidate(pool, parsed);
        if (!candidate) continue;
        const group = groups.get(candidate.candidateKey) || { candidate, observations: [] };
        group.observations.push({ row, parsed, matchReason });
        groups.set(candidate.candidateKey, group);
    }

    const wanted = [...groups.values()]
        .filter((group) => group.observations.length >= minimumEvidence)
        .sort((a, b) => b.observations.length - a.observations.length);
    console.log(`уникальных кандидатов: ${groups.size}, прошли порог: ${wanted.length}`);
    for (const group of wanted.slice(0, show)) {
        const sources = [...new Set(group.observations.map(({ row }) => row.source_site))].join(',');
        console.log(`  ${String(group.observations.length).padStart(3)} · [${sources}] ${group.candidate.nameFull}`.slice(0, 150));
    }
    if (wanted.length > show) console.log(`  … ещё ${wanted.length - show}`);

    let observationsAdded = 0;
    if (apply) {
        for (const group of wanted) {
            for (const { row, parsed, matchReason } of group.observations) {
                const staged = await stageCatalogCandidate(pool, {
                    parsed,
                    matchReason,
                    lot: {
                        id: row.id,
                        sourceSite: row.source_site,
                        sourceLotNumber: row.lot_number,
                        sourceUrl: row.source_url,
                        lotStatus: row.lot_status,
                        title: row.coin_description,
                    },
                });
                if (staged.observationAdded) observationsAdded++;
            }
        }
    }
    console.log(`${apply ? 'КАНДИДАТОВ ОБНОВЛЕНО' : 'К ПОСТАНОВКЕ В ОЧЕРЕДЬ'}: ${wanted.length}`);
    if (apply) console.log(`новых связей с исходными наблюдениями: ${observationsAdded}`);
    await pool.end();
}

if (require.main === module) main().catch((error) => {
    console.error('FATAL', error.message);
    process.exit(1);
});

module.exports = { main };
