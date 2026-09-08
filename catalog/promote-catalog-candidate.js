/**
 * Явная публикация одного просмотренного catalog_candidate в coin_type.
 * Без --apply показывает кандидата и его исходные карточки, ничего не меняя.
 *
 * node catalog/promote-catalog-candidate.js <candidate-id> [--apply]
 */
'use strict';

const { pool } = require('./db');
const { evaluateCandidateEvidence, publicationIdentity } = require('./catalog-candidates');

async function loadCandidate(client, id, lock = false) {
    const candidate = (await client.query(
        `SELECT * FROM catalog_candidate WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
        [id],
    )).rows[0];
    if (!candidate) throw new Error(`catalog_candidate ${id} не найден`);
    const observations = (await client.query(
        `SELECT o.*,COALESCE(a.avers_image_url,i.avers_image_url) AS avers_image_url,
                COALESCE(a.revers_image_url,i.revers_image_url) AS revers_image_url,
                i.country AS source_country,i.denomination AS source_denomination,
                i.year AS source_year,i.themes AS source_themes,i.title AS source_title,
                i.metal AS source_metal,i.weight_g AS source_weight_g,
                i.diameter_mm AS source_diameter_mm,i.mintage AS source_mintage,
                i.condition AS source_condition,
                s.evidence_tier,s.source_kind,s.catalog_role,s.display_name source_display_name
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
    console.log(`готовность: ${evidence.ready ? 'ДА' : 'НЕТ'} · фото=${evidence.hasPhoto ? 'да' : 'нет'} · primary/reference=${evidence.authoritativeSources} · независимые магазины=${evidence.dealerShopSources}`);
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
        const publication = publicationIdentity(candidate, observations);

        const existingTypeSql = publication.canonicalName
            ? `SELECT id FROM coin_type
                WHERE (($1='modern' AND era IS NULL) OR era=$1) AND country=$2 AND year=$3
                  AND lower(denomination_text)=lower($4)
                  AND (lower(trim(canonical_name))=lower(trim($5)) OR lower(trim(name_full))=lower(trim($5)))
                ORDER BY id LIMIT 1`
            : `SELECT id FROM coin_type
                WHERE (($1='modern' AND era IS NULL) OR era=$1) AND country=$2 AND year=$3
                  AND lower(denomination_text)=lower($4) AND lower(theme_core)=lower($5)
                ORDER BY id LIMIT 1`;
        let typeId = (await client.query(existingTypeSql, [
            candidate.era, candidate.country, candidate.year, candidate.denomination_text,
            publication.canonicalName || publication.themeCore,
        ])).rows[0]?.id;

        if (!typeId) {
            const imageUrl = observations.find((row) => row.avers_image_url)?.avers_image_url || null;
            const reverseImageUrl = observations.find((row) => row.revers_image_url)?.revers_image_url || null;
            const typeEra = candidate.era === 'modern' ? null : candidate.era;
            const insertSql = typeEra == null
                ? `INSERT INTO coin_type
                     (source,country,era,name_full,canonical_name,theme_core,theme_ru,denomination_text,
                      denomination_value,year,type_key,status,image_url,image_url_rev,metal,mass,diameter,
                      mintage,quality,created_at,updated_at)
                   VALUES ('market_candidate',$1,$2,$3,$4,$5,$5,$6,$7,$8,$9,'confirmed',$10,$11,$12,$13,$14,$15,$16,now(),now())
                   RETURNING id`
                : `INSERT INTO coin_type
                     (source,country,era,name_full,canonical_name,theme_core,theme_ru,denomination_text,
                      denomination_value,year,type_key,status,image_url,image_url_rev,metal,mass,diameter,
                      mintage,quality,created_at,updated_at)
                   VALUES ('market_candidate',$1,$2,$3,$4,$5,$5,$6,$7,$8,$9,'confirmed',$10,$11,$12,$13,$14,$15,$16,now(),now())
                   ON CONFLICT (era,type_key) WHERE era IS NOT NULL
                   DO UPDATE SET updated_at=now(),
                     canonical_name=COALESCE(coin_type.canonical_name,EXCLUDED.canonical_name),
                     image_url=COALESCE(coin_type.image_url,EXCLUDED.image_url),
                     image_url_rev=COALESCE(coin_type.image_url_rev,EXCLUDED.image_url_rev),
                     metal=COALESCE(coin_type.metal,EXCLUDED.metal),mass=COALESCE(coin_type.mass,EXCLUDED.mass),
                     diameter=COALESCE(coin_type.diameter,EXCLUDED.diameter),
                     mintage=COALESCE(coin_type.mintage,EXCLUDED.mintage),quality=COALESCE(coin_type.quality,EXCLUDED.quality)
                   RETURNING id`;
            typeId = (await client.query(insertSql, [
                candidate.country, typeEra, publication.nameFull, publication.canonicalName, publication.themeCore,
                candidate.denomination_text, candidate.denomination_value, candidate.year,
                candidate.candidate_key, imageUrl, reverseImageUrl, publication.metal,
                publication.mass, publication.diameter, publication.mintage, publication.quality,
            ])).rows[0].id;
        } else {
            await client.query(
                `UPDATE coin_type SET
                   canonical_name=COALESCE(canonical_name,$2),image_url=COALESCE(image_url,$3),
                   image_url_rev=COALESCE(image_url_rev,$4),metal=COALESCE(metal,$5),
                   mass=COALESCE(mass,$6),diameter=COALESCE(diameter,$7),
                   mintage=COALESCE(mintage,$8),quality=COALESCE(quality,$9),updated_at=now()
                 WHERE id=$1`,
                [typeId, publication.canonicalName,
                    observations.find((row) => row.avers_image_url)?.avers_image_url || null,
                    observations.find((row) => row.revers_image_url)?.revers_image_url || null,
                    publication.metal, publication.mass, publication.diameter,
                    publication.mintage, publication.quality],
            );
        }

        await client.query(
            `INSERT INTO lot_type_link (lot_id,type_id,grade,match_method,match_confidence)
             SELECT o.lot_id,$2,a.condition,'catalog_candidate_review',1
               FROM catalog_candidate_observation o JOIN auction_lots a ON a.id=o.lot_id
              WHERE o.candidate_id=$1
             ON CONFLICT (lot_id) DO NOTHING`,
            [id, typeId],
        );
        const protectedLinks = (await client.query(
            `SELECT l.source_item_id,l.type_id,l.match_method
               FROM catalog_candidate_observation o
               JOIN catalog_source_item i ON i.id=o.source_item_id
               JOIN catalog_source_item_type_link l ON l.source_item_id=i.id
              WHERE o.candidate_id=$1 AND l.type_id<>$2`,
            [id, typeId],
        )).rows;
        if (protectedLinks.length) {
            throw new Error(`кандидат конфликтует с просмотренной связью источника: ${JSON.stringify(protectedLinks)}`);
        }
        await client.query(
            `INSERT INTO catalog_source_item_type_link
               (source_item_id,type_id,match_method,match_confidence)
             SELECT o.source_item_id,$2,'catalog_candidate_review',1
               FROM catalog_candidate_observation o
              WHERE o.candidate_id=$1 AND o.source_item_id IS NOT NULL
             ON CONFLICT (source_item_id) DO UPDATE SET
               type_id=EXCLUDED.type_id,match_method=EXCLUDED.match_method,
               match_confidence=EXCLUDED.match_confidence`,
            [id, typeId],
        );
        await client.query(
            `UPDATE catalog_candidate SET status='promoted',promoted_type_id=$2,
                    name_full=$3,theme_core=$4,
                    reviewed_at=now(),updated_at=now()
              WHERE id=$1`,
            [id, typeId, publication.nameFull, publication.themeCore],
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
