/**
 * auction.ru WATCH-поллер и сборщик каталожных наблюдений.
 *
 * Каждая распознанная карточка сохраняется в auction_lots независимо от результата торгов.
 * Продажа влияет только на lot_status/winning_bid. Новый иностранный выпуск ставится в
 * catalog_candidate и не публикуется в coin_type без явного просмотра.
 *
 * node catalog/poll-auctionru.js [limit]
 * node catalog/poll-auctionru.js --test <url> [<url2>...]
 */
'use strict';

const { pool } = require('./db');
const { fetchHtml, close } = require('./browser-fetch');
const { DIAG, parseTitle, matchType } = require('./coin-matcher');
const { stageCatalogCandidate } = require('./catalog-candidates');
const { classifyAuctionRuObservation, isAuctionRuCardPage, parseAuctionRuPage } = require('./marketplace-observation');
const { finishSourceRun, startSourceRun } = require('./source-registry');
const { extractSlabInfo } = require('../domain/slab-info');

const MAX_FETCH_FAILURES = 5;

async function markQueueFailure(offerId, error) {
    return (await pool.query(
        `UPDATE auctionru_queue SET
           fetch_failures=fetch_failures+1,
           status=CASE WHEN fetch_failures+1 >= $2 THEN 'dead' ELSE status END,
           last_error=$3,last_checked=now(),
           next_check_at=CASE WHEN fetch_failures+1 >= $2 THEN NULL
                              ELSE now()+interval '15 minutes' * LEAST(fetch_failures+1,4) END
         WHERE offer_id=$1
         RETURNING status,fetch_failures`,
        [offerId, MAX_FETCH_FAILURES, String(error || 'empty_or_challenge').slice(0, 500)],
    )).rows[0];
}

async function saveObservation(offer, dry = false) {
    const parsed = parseTitle(offer.title);
    if (!parsed.year && offer.year) parsed.year = offer.year;
    if (parsed.isNonCoin) return { saved: false, reason: 'noncoin' };
    if (parsed.isSet) return { saved: false, reason: 'set' };
    if (!parsed.denom) return { saved: false, reason: 'nodenom' };
    if (!parsed.year) return { saved: false, reason: 'noyear' };

    const observation = classifyAuctionRuObservation({
        availability: offer.availability,
        hasBids: offer.hasBids,
        price: offer.price,
    });
    DIAG.on = true;
    const match = await matchType(pool, parsed);
    const matchReason = DIAG.reason;
    const slabInfo = extractSlabInfo({ description: offer.title, condition: parsed.grade });

    if (dry) {
        console.log(`  ${observation.lotStatus.toUpperCase()} · type=${match ? `${match.id} conf${match.conf}` : matchReason || '-'} · ${offer.title.slice(0, 80)}`);
        return { saved: false, dry: true, lotStatus: observation.lotStatus, matched: Boolean(match) };
    }

    const result = await pool.query(
        `INSERT INTO auction_lots
           (source_site,source_category,lot_number,source_url,winning_bid,currency,condition,
            auction_end_date,coin_description,avers_image_url,revers_image_url,year,lot_status,category,parsing_method,
            bids_count,slab_status,grading_company_code,grading_company_raw,slab_grade_code,
            grade_source,slab_extractor_version,slab_evidence_text)
         VALUES ('auction.ru','auction.ru-coins',$1,$2,$3,'RUB',$4,$5,$6,$7,$8,$9,$10,'auction.ru',
                 'auctionru-catalog-poller',$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (source_site,lot_number) WHERE source_site IN ('meshok.net','auction.ru')
         DO UPDATE SET
           lot_status=CASE WHEN auction_lots.lot_status='sold' AND EXCLUDED.lot_status<>'sold' THEN auction_lots.lot_status ELSE EXCLUDED.lot_status END,
           winning_bid=CASE WHEN auction_lots.lot_status='sold' AND EXCLUDED.lot_status<>'sold' THEN auction_lots.winning_bid ELSE EXCLUDED.winning_bid END,
           auction_end_date=COALESCE(EXCLUDED.auction_end_date,auction_lots.auction_end_date),
           condition=COALESCE(EXCLUDED.condition,auction_lots.condition),
           coin_description=EXCLUDED.coin_description,
           avers_image_url=COALESCE(auction_lots.avers_image_url,EXCLUDED.avers_image_url),
           revers_image_url=COALESCE(auction_lots.revers_image_url,EXCLUDED.revers_image_url),
           source_url=COALESCE(EXCLUDED.source_url,auction_lots.source_url),
           bids_count=COALESCE(EXCLUDED.bids_count,auction_lots.bids_count),
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
            String(offer.offerId), offer.url, observation.storedPrice, parsed.grade,
            observation.terminal ? new Date() : null, offer.title,
            offer.photos?.[0] || null, offer.photos?.[1] || null,
            parsed.year, observation.lotStatus, offer.hasBids ? 1 : 0,
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
        return { saved: true, lotStatus: observation.lotStatus, matched: true, terminal: observation.terminal };
    }

    const staged = await stageCatalogCandidate(pool, {
        parsed,
        matchReason,
        lot: {
            id: result.rows[0].id,
            sourceSite: 'auction.ru',
            sourceLotNumber: String(offer.offerId),
            sourceUrl: offer.url,
            lotStatus: result.rows[0].lot_status,
            title: offer.title,
        },
    });
    return {
        saved: true,
        lotStatus: result.rows[0].lot_status,
        matched: false,
        candidate: staged.observationAdded,
        terminal: observation.terminal,
    };
}

async function main() {
    const args = process.argv.slice(2);
    if (args[0] === '--test') {
        for (const url of args.slice(1)) {
            const page = parseAuctionRuPage(await fetchHtml(url));
            const offerId = (url.match(/-i(\d+)\.html/) || [])[1];
            const year = Number((url.match(/_((?:19|20)\d{2})_goda_/) || [])[1]) || null;
            console.log(`\n${page.availability} · price=${page.price || '-'} · bids=${page.hasBids} · фото=${page.nPhotos}`);
            await saveObservation({ offerId, url, year, ...page }, true);
        }
        await close();
        await pool.end();
        return;
    }

    const limit = parseInt(args[0] || '0', 10);
    let sourceRun = null;
    try {
        sourceRun = await startSourceRun(pool, 'auction.ru', 'incremental');
        const lots = (await pool.query(
            `SELECT offer_id,url,year FROM auctionru_queue
              WHERE NOT captured AND COALESCE(status,'') <> 'dead'
                AND (next_check_at IS NULL OR next_check_at <= now())
              ORDER BY last_checked ASC NULLS FIRST ${limit ? `LIMIT ${limit}` : ''}`,
        )).rows;
        console.log('проверяю карточек:', lots.length);
        const stat = { sold: 0, active: 0, ended_unsold: 0, candidate: 0, linked: 0, skipped: 0, dead: 0, retry_scheduled: 0, fetch_failed: 0, failed: 0 };

        for (const lot of lots) {
            try {
                const html = await fetchHtml(lot.url);
                if (!html || html.length < 1500) {
                    stat.fetch_failed++;
                    const failed = await markQueueFailure(lot.offer_id, 'empty_or_challenge');
                    stat[failed?.status === 'dead' ? 'dead' : 'retry_scheduled']++;
                    continue;
                }
                const page = parseAuctionRuPage(html);
                if (!isAuctionRuCardPage(html, page)) {
                    stat.fetch_failed++;
                    const failed = await markQueueFailure(lot.offer_id, 'challenge_or_invalid_card');
                    stat[failed?.status === 'dead' ? 'dead' : 'retry_scheduled']++;
                    continue;
                }
                const result = await saveObservation({ offerId: lot.offer_id, url: lot.url, year: lot.year, ...page });
                const terminal = ['OutOfStock', 'SoldOut', 'Discontinued'].includes(page.availability);
                await pool.query(
                    `UPDATE auctionru_queue SET captured=$2,availability=$3,last_price=$4,
                            has_bids=$5,last_checked=now(),last_success_at=now(),fetch_failures=0,
                            last_error=NULL,next_check_at=CASE WHEN $2 THEN NULL ELSE now()+interval '1 day' END,
                            status=CASE WHEN $2 THEN 'done' ELSE status END
                      WHERE offer_id=$1`,
                    [lot.offer_id, terminal, page.availability, page.price, page.hasBids],
                );
                if (!result.saved) stat.skipped++;
                else {
                    stat[result.lotStatus]++;
                    if (result.candidate) stat.candidate++;
                    if (result.matched) stat.linked++;
                }
                const done = stat.sold + stat.active + stat.ended_unsold + stat.skipped;
                if (done > 0 && done % 100 === 0) process.stderr.write(`  saved=${done - stat.skipped} candidates=${stat.candidate}\r`);
            } catch (error) {
                stat.failed++;
                stat.fetch_failed++;
                try {
                    const failed = await markQueueFailure(lot.offer_id, error.message);
                    stat[failed?.status === 'dead' ? 'dead' : 'retry_scheduled']++;
                } catch (_) { /* исходная ошибка важнее вторичной ошибки очереди */ }
                console.error(`  ОШИБКА offer ${lot.offer_id}: ${error.message}`);
            }
        }
        console.log(`\nPOLL: ${JSON.stringify(stat)}`);
        const saved = stat.sold + stat.active + stat.ended_unsold;
        await finishSourceRun(pool, sourceRun.id, stat.fetch_failed ? 'partial' : 'succeeded', {
            pagesFetched: lots.length,
            itemsSeen: lots.length,
            observationsSaved: saved,
            candidatesStaged: stat.candidate,
            errorsCount: stat.fetch_failed,
        });
    } catch (error) {
        try { if (sourceRun) {
            await finishSourceRun(pool, sourceRun.id, 'failed', { errorsCount: 1, errorSummary: error.message });
        } } catch (_) { /* сохраняем исходную ошибку */ }
        throw error;
    } finally {
        await close();
        await pool.end();
    }
}

if (require.main === module) main().catch((error) => {
    console.error('FATAL', error.message);
    process.exit(1);
});

module.exports = { MAX_FETCH_FAILURES, markQueueFailure, parse: parseAuctionRuPage, saveObservation, main };
