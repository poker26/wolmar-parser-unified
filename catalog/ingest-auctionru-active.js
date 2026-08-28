/**
 * Реабилитация активных офферов auction.ru: 1400 уже собранных InStock-лотов (auctionru_lots) →
 * общий coin-matcher → auction_lots(source_site='auction.ru', lot_status='active') → lot_type_link.
 * БЕЗ скрейпа/кредитов (данные уже в стейджинге). Питает «Доступно сейчас» / «где купить».
 * node catalog/ingest-auctionru-active.js
 */
const { pool } = require("./db");
const { parseTitle, matchType } = require("./coin-matcher");
const { extractSlabInfo } = require("../domain/slab-info");

(async () => {
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS auction_lots_src_lot ON auction_lots(source_site, lot_number) WHERE source_site IN ('meshok.net','auction.ru')");
  const lots = (await pool.query("SELECT offer_id, url, title, price, year FROM auctionru_lots WHERE title IS NOT NULL")).rows;
  console.log("активных auction.ru-лотов:", lots.length);
  const stat = {};
  for (const l of lots) {
    const p = parseTitle(l.title);
    const slabInfo = extractSlabInfo({ description: l.title, condition: p.grade });
    if (!p.denom) { stat.nodenom = (stat.nodenom || 0) + 1; continue; }
    if (!p.year && l.year) p.year = l.year;               // год из стейджинга, если в title нет
    const m = await matchType(pool, p);
    if (!m) { stat.nomatch = (stat.nomatch || 0) + 1; continue; }
    const r = await pool.query(
      `INSERT INTO auction_lots (source_site,source_category,lot_number,source_url,winning_bid,currency,condition,coin_description,year,lot_status,category,parsing_method,slab_status,grading_company_code,grading_company_raw,slab_grade_code,grade_source,slab_extractor_version,slab_evidence_text)
       VALUES ('auction.ru','auction.ru-coins',$1,$2,$3,'RUB',$4,$5,$6,'active','auction.ru','aru-active',$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (source_site,lot_number) WHERE source_site IN ('meshok.net','auction.ru') DO UPDATE SET
         winning_bid=EXCLUDED.winning_bid, lot_status='active', coin_description=EXCLUDED.coin_description,
         slab_status=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.slab_status ELSE EXCLUDED.slab_status END,
         grading_company_code=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.grading_company_code ELSE EXCLUDED.grading_company_code END,
         grading_company_raw=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.grading_company_raw ELSE EXCLUDED.grading_company_raw END,
         slab_grade_code=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.slab_grade_code ELSE EXCLUDED.slab_grade_code END,
         grade_source=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.grade_source ELSE EXCLUDED.grade_source END,
         slab_extractor_version=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.slab_extractor_version ELSE EXCLUDED.slab_extractor_version END,
         slab_evidence_text=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.slab_evidence_text ELSE EXCLUDED.slab_evidence_text END
       RETURNING id`,
      [String(l.offer_id), l.url, l.price, p.grade, l.title, p.year || null,
       slabInfo.slabStatus, slabInfo.gradingCompanyCode, slabInfo.gradingCompanyRaw,
       slabInfo.gradeSource === 'slab_label' ? slabInfo.gradeCode : null,
       slabInfo.gradeSource, slabInfo.extractorVersion, slabInfo.evidenceText]);
    await pool.query("INSERT INTO lot_type_link (lot_id,type_id,grade,match_method,match_confidence) VALUES ($1,$2,$3,'auctionru',$4) ON CONFLICT (lot_id) DO NOTHING",
      [r.rows[0].id, m.id, p.grade, m.conf]);
    stat.ok = (stat.ok || 0) + 1; stat["era_" + m.era] = (stat["era_" + m.era] || 0) + 1;
  }
  console.log("итог:", JSON.stringify(stat));
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
