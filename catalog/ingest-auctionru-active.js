/**
 * Перенос сохранённых карточек auction.ru в общий слой наблюдений каталога.
 * Статус продажи не является фильтром: активная и завершённая без подтверждённых ставок карточка
 * тоже может описывать новый тип. Неподтверждённая цена завершённой карточки не сохраняется как
 * winning_bid. Несматченные иностранные выпуски попадают в catalog_candidate, не в coin_type.
 *
 * node catalog/ingest-auctionru-active.js
 */
'use strict';

const { pool } = require('./db');
const { DIAG, parseTitle, matchType } = require('./coin-matcher');
const { stageCatalogCandidate } = require('./catalog-candidates');
const { finishSourceRun, startSourceRun } = require('./source-registry');
const { extractSlabInfo } = require('../domain/slab-info');

const photoUrl = (offerId, index) => `/api/coincat/photo/${offerId}/${index}`;

async function main() {
    let sourceRun = null;
    try {
    sourceRun = await startSourceRun(pool, 'auction.ru', 'backfill');
    await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS auction_lots_src_lot ON auction_lots(source_site, lot_number) WHERE source_site IN ('meshok.net','auction.ru')");
    const lots = (await pool.query(
        'SELECT offer_id,url,title,price,year,status,n_photos FROM auctionru_lots WHERE title IS NOT NULL',
    )).rows;
    console.log('карточек auction.ru:', lots.length);
    const stat = {};

    for (const lot of lots) {
        const parsed = parseTitle(lot.title);
        const slabInfo = extractSlabInfo({ description: lot.title, condition: parsed.grade });
        if (parsed.isNonCoin) { stat.noncoin = (stat.noncoin || 0) + 1; continue; }
        if (parsed.isSet) { stat.set = (stat.set || 0) + 1; continue; }
        if (!parsed.denom) { stat.nodenom = (stat.nodenom || 0) + 1; continue; }
        if (!parsed.year && lot.year) parsed.year = lot.year;
        if (!parsed.year) { stat.noyear = (stat.noyear || 0) + 1; continue; }

        DIAG.on = true;
        const match = await matchType(pool, parsed);
        const matchReason = DIAG.reason;
        const lotStatus = lot.status === 'active' ? 'active' : 'ended_unsold';
        const storedPrice = lotStatus === 'active' ? lot.price : null;
        const result = await pool.query(
            `INSERT INTO auction_lots
               (source_site,source_category,lot_number,source_url,winning_bid,currency,condition,
                coin_description,avers_image_url,revers_image_url,year,lot_status,category,parsing_method,
                slab_status,grading_company_code,grading_company_raw,slab_grade_code,grade_source,
                slab_extractor_version,slab_evidence_text)
             VALUES ('auction.ru','auction.ru-coins',$1,$2,$3,'RUB',$4,$5,$6,$7,$8,$9,'auction.ru',
                     'aru-catalog-observation',$10,$11,$12,$13,$14,$15,$16)
             ON CONFLICT (source_site,lot_number) WHERE source_site IN ('meshok.net','auction.ru')
             DO UPDATE SET
               winning_bid=CASE WHEN auction_lots.lot_status='sold' THEN auction_lots.winning_bid ELSE EXCLUDED.winning_bid END,
               lot_status=CASE WHEN auction_lots.lot_status='sold' THEN auction_lots.lot_status ELSE EXCLUDED.lot_status END,
               coin_description=EXCLUDED.coin_description,
               avers_image_url=COALESCE(auction_lots.avers_image_url,EXCLUDED.avers_image_url),
               revers_image_url=COALESCE(auction_lots.revers_image_url,EXCLUDED.revers_image_url),
               parsing_method=EXCLUDED.parsing_method,
               slab_status=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.slab_status ELSE EXCLUDED.slab_status END,
               grading_company_code=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.grading_company_code ELSE EXCLUDED.grading_company_code END,
               grading_company_raw=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.grading_company_raw ELSE EXCLUDED.grading_company_raw END,
               slab_grade_code=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.slab_grade_code ELSE EXCLUDED.slab_grade_code END,
               grade_source=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.grade_source ELSE EXCLUDED.grade_source END,
               slab_extractor_version=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.slab_extractor_version ELSE EXCLUDED.slab_extractor_version END,
               slab_evidence_text=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.slab_evidence_text ELSE EXCLUDED.slab_evidence_text END
             RETURNING id,lot_status`,
            [
                String(lot.offer_id), lot.url, storedPrice, parsed.grade, lot.title,
                lot.n_photos > 0 ? photoUrl(lot.offer_id, 0) : null,
                lot.n_photos > 1 ? photoUrl(lot.offer_id, 1) : null,
                parsed.year, lotStatus,
                slabInfo.slabStatus, slabInfo.gradingCompanyCode, slabInfo.gradingCompanyRaw,
                slabInfo.gradeSource === 'slab_label' ? slabInfo.gradeCode : null,
                slabInfo.gradeSource, slabInfo.extractorVersion, slabInfo.evidenceText,
            ],
        );

        if (match) {
            await pool.query(
                "INSERT INTO lot_type_link (lot_id,type_id,grade,match_method,match_confidence) VALUES ($1,$2,$3,'auctionru',$4) ON CONFLICT (lot_id) DO NOTHING",
                [result.rows[0].id, match.id, parsed.grade, match.conf],
            );
            stat.linked = (stat.linked || 0) + 1;
            continue;
        }

        const staged = await stageCatalogCandidate(pool, {
            parsed,
            matchReason,
            lot: {
                id: result.rows[0].id,
                sourceSite: 'auction.ru',
                sourceLotNumber: String(lot.offer_id),
                sourceUrl: lot.url,
                lotStatus: result.rows[0].lot_status,
                title: lot.title,
            },
        });
        const key = staged.observationAdded ? 'candidate' : staged.staged ? 'candidate_existing' : 'unmatched';
        stat[key] = (stat[key] || 0) + 1;
    }

    console.log('итог:', JSON.stringify(stat));
    const skipped = ['noncoin', 'set', 'nodenom', 'noyear'].reduce((sum, key) => sum + (stat[key] || 0), 0);
    await finishSourceRun(pool, sourceRun.id, 'succeeded', {
        itemsSeen: lots.length,
        observationsSaved: Math.max(0, lots.length - skipped),
        candidatesStaged: stat.candidate || 0,
    });
    } catch (error) {
        try { if (sourceRun) {
            await finishSourceRun(pool, sourceRun.id, 'failed', { errorsCount: 1, errorSummary: error.message });
        } } catch (_) { /* сохраняем исходную ошибку */ }
        throw error;
    } finally {
        await pool.end();
    }
}

if (require.main === module) main().catch((error) => {
    console.error('FATAL', error.message);
    process.exit(1);
});

module.exports = { main };
