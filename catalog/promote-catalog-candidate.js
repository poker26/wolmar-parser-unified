/**
 * Явная публикация одного просмотренного catalog_candidate в coin_type.
 * Без --apply показывает кандидата и его исходные карточки, ничего не меняя.
 *
 * node catalog/promote-catalog-candidate.js <candidate-id> [--apply]
 */
'use strict';

const { pool } = require('./db');
const { evaluateCandidateEvidence } = require('./catalog-candidates');

async function loadCandidate(client, id, lock = false) {
    const candidate = (await client.query(
        `SELECT * FROM catalog_candidate WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
        [id],
    )).rows[0];
    if (!candidate) throw new Error(`catalog_candidate ${id} не найден`);
    const observations = (await client.query(
        `SELECT o.*,COALESCE(a.avers_image_url,i.avers_image_url) AS avers_image_url,
                COALESCE(a.revers_image_url,i.revers_image_url) AS revers_image_url,
                s.evidence_tier,s.catalog_role,s.display_name source_display_name
           FROM catalog_candidate_observation o
           LEFT JOIN auction_lots a ON a.id=o.lot_id
           LEFT JOIN catalog_source_item i ON i.id=o.source_item_id
           LEFT JOIN catalog_source s ON s.source_key=o.source_site
          WHERE o.candidate_id=$1 ORDER BY o.observed_at DESC`,
        [id],
    )).rows;
    return { candidate, observations };
}

function printCandidate(candidate, observations) {
    console.log(`#${candidate.id} [${candidate.status}] ${candidate.name_full}`);
    console.log(`ключ: ${candidate.candidate_key}`);
    console.log(`наблюдений: ${observations.length}; источников: ${new Set(observations.map((row) => row.source_site)).size}`);
    for (const row of observations.slice(0, 20)) {
        console.log(`  ${row.source_display_name || row.source_site} · ${row.evidence_tier || 'unranked'} · ${row.lot_status || '-'} · ${row.source_url || row.source_lot_number || row.lot_id}`);
        console.log(`    ${row.observed_title}`);
    }
    if (observations.length > 20) console.log(`  … ещё ${observations.length - 20}`);
    const evidence = evaluateCandidateEvidence(observations);
    console.log(`готовность: ${evidence.ready ? 'ДА' : 'НЕТ'} · фото=${evidence.hasPhoto ? 'да' : 'нет'} · primary/reference=${evidence.authoritativeSources}`);
    if (!evidence.ready) console.log(`  не хватает: ${evidence.reasons.join('; ')}`);
}

async function main() {
    const id = Number(process.argv[2]);
    if (!Number.isInteger(id) || id <= 0) throw new Error('укажите положительный candidate-id');
    const apply = process.argv.includes('--apply');
    if (!apply) {
        const snapshot = await loadCandidate(pool, id);
        printCandidate(snapshot.candidate, snapshot.observations);
        console.log('сухой просмотр; для публикации повторите с --apply');
        await pool.end();
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { candidate, observations } = await loadCandidate(client, id, true);
        printCandidate(candidate, observations);
        if (candidate.status === 'rejected') throw new Error('отклонённый кандидат нельзя публиковать без возврата в pending');
        if (candidate.status === 'promoted') {
            console.log(`уже опубликован как coin_type ${candidate.promoted_type_id}`);
            await client.query('COMMIT');
            return;
        }
        if (!observations.length) throw new Error('у кандидата нет исходных наблюдений');
        const evidence = evaluateCandidateEvidence(observations);
        if (!evidence.ready) throw new Error(`кандидат не готов к публикации: ${evidence.reasons.join('; ')}`);

        let typeId = (await client.query(
            `SELECT id FROM coin_type
              WHERE (($1='modern' AND era IS NULL) OR era=$1) AND country=$2 AND year=$3
                AND lower(denomination_text)=lower($4) AND lower(theme_core)=lower($5)
              ORDER BY id LIMIT 1`,
            [candidate.era, candidate.country, candidate.year, candidate.denomination_text, candidate.theme_core],
        )).rows[0]?.id;

        if (!typeId) {
            const imageUrl = observations.find((row) => row.avers_image_url)?.avers_image_url || null;
            const typeEra = candidate.era === 'modern' ? null : candidate.era;
            const insertSql = typeEra == null
                ? `INSERT INTO coin_type
                     (source,country,era,name_full,theme_core,theme_ru,denomination_text,
                      denomination_value,year,type_key,status,image_url,created_at,updated_at)
                   VALUES ('market_candidate',$1,$2,$3,$4,$4,$5,$6,$7,$8,'confirmed',$9,now(),now())
                   RETURNING id`
                : `INSERT INTO coin_type
                     (source,country,era,name_full,theme_core,theme_ru,denomination_text,
                      denomination_value,year,type_key,status,image_url,created_at,updated_at)
                   VALUES ('market_candidate',$1,$2,$3,$4,$4,$5,$6,$7,$8,'confirmed',$9,now(),now())
                   ON CONFLICT (era,type_key) WHERE era IS NOT NULL
                   DO UPDATE SET updated_at=now(),image_url=COALESCE(coin_type.image_url,EXCLUDED.image_url)
                   RETURNING id`;
            typeId = (await client.query(insertSql, [
                candidate.country, typeEra, candidate.name_full, candidate.theme_core,
                candidate.denomination_text, candidate.denomination_value, candidate.year,
                candidate.candidate_key, imageUrl,
            ])).rows[0].id;
        }

        await client.query(
            `INSERT INTO lot_type_link (lot_id,type_id,grade,match_method,match_confidence)
             SELECT o.lot_id,$2,a.condition,'catalog_candidate_review',1
               FROM catalog_candidate_observation o JOIN auction_lots a ON a.id=o.lot_id
              WHERE o.candidate_id=$1
             ON CONFLICT (lot_id) DO NOTHING`,
            [id, typeId],
        );
        await client.query(
            `INSERT INTO catalog_source_item_type_link
               (source_item_id,type_id,match_method,match_confidence)
             SELECT o.source_item_id,$2,'catalog_candidate_review',1
               FROM catalog_candidate_observation o
              WHERE o.candidate_id=$1 AND o.source_item_id IS NOT NULL
             ON CONFLICT (source_item_id) DO NOTHING`,
            [id, typeId],
        );
        await client.query(
            `UPDATE catalog_candidate SET status='promoted',promoted_type_id=$2,
                    reviewed_at=now(),updated_at=now()
              WHERE id=$1`,
            [id, typeId],
        );
        await client.query('COMMIT');
        console.log(`ОПУБЛИКОВАНО: catalog_candidate ${id} -> coin_type ${typeId}`);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) main().catch((error) => {
    console.error('FATAL', error.message);
    process.exit(1);
});

module.exports = { loadCandidate, main };
