/**
 * auction.ru WATCH-поллер. Следит за активными лотами очереди; на переходе InStock→OutOfStock
 * (+финал.цена +ставки) фиксирует СОСТОЯВШУЮСЯ сделку → auction_lots (source_site='auction.ru')
 * → lot_type_link → source-aware медианы/прогноз. Планируемый джоб (cron). Resume по captured.
 *   node catalog/poll-auctionru.js              — боевой проход по очереди
 *   node catalog/poll-auctionru.js --test <url> [<url2>...]  — dry-run: что бы записал
 */
const { pool } = require("./db");
const { fetchHtml, close } = require("./browser-fetch");   // браузер-стелс: проходит DDoS-Guard
const { extractSlabInfo } = require("../domain/slab-info");
const photoUrl = (oid) => `/api/coinphoto?k=${oid}/0.jpg`;

const tc = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const parseDenom = (t) => {
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(рубл[а-яё]*|копе[а-яё]*|евро|доллар[а-яё]*|центов?|фунт[а-яё]*|тенге|гривен|гривн[а-яё]*|сум[а-яё]*|песо|юан[а-яё]*|лир[а-яё]*|динар[а-яё]*|драм[а-яё]*|манат[а-яё]*|франк[а-яё]*|крон[а-яё]*|вон[а-яё]*|иен[а-яё]*|йен[а-яё]*|рупи[а-яё]*|реал[а-яё]*|шиллинг[а-яё]*|форинт[а-яё]*|злот[а-яё]*|бат[а-яё]*|лев[а-яё]*|ле[йя][а-яё]*)/i);
  if (!m) return null;
  const unit = m[2].toLowerCase();
  return { num: parseFloat(m[1].replace(",", ".")), unit, value: /^копе/.test(unit) ? parseFloat(m[1]) / 100 : parseFloat(m[1]), isRf: /^(рубл|копе)/.test(unit) };
};
const gradeFromTitle = (t) => {
  const m = t.match(/\b(MS\s?7\d|MS\s?6\d|PF\s?7\d|PF\s?6\d|PR\s?\d\d|Proof|пруф|UNC|АНЦ|aUNC|AU|XF|VF|VG|\bF\b|\bG\b)\b/i);
  return { grade: m ? m[1].toUpperCase().replace(/\s/g, "") : null };
};
const parse = (html) => {
  const av = (html.match(/"availability":"[^"]*\/(InStock|OutOfStock|SoldOut|Discontinued)"/) || [])[1] || null;
  const price = (html.match(/"price"\s*:\s*"?(\d+)"?/) || [])[1];
  const title = ((html.match(/og:title"\s+content="([^"]*)"/) || [])[1] || "").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
  const hasBids = /bid">\s*\d/.test(html);
  const photos = [...new Set([...html.matchAll(/https:\/\/static\.auction\.ru\/offer_images\/[^\s"'\\]+?\.jpe?g/g)].map((m) => m[0]))];
  return { av, price: price ? +price : null, title, hasBids, nPhotos: photos.length };
};

let CMAP = null;
async function countryEn(title) {
  if (!CMAP) CMAP = (await pool.query("SELECT ru,en FROM numis_country_map WHERE en IS NOT NULL")).rows.sort((a, b) => b.ru.length - a.ru.length);
  for (const r of CMAP) if (title.includes(r.ru)) return tc(r.en);
  return null;
}

// матч лота → coin_type (foreign: страна+номинал+год / RF≥1992: модерн по номинал+год+тема); иначе self-тип. Возвращает {id, conf}
async function matchOrCreateType(o) {
  const d = parseDenom(o.title); if (!d) return null;
  if (d.isRf) {
    if (o.year < 1992) return null;  // имперское/СССР — поллер v1 не матчит (другой матчер)
    const rows = (await pool.query(
      "SELECT id, name_full FROM coin_type WHERE (era IS NULL AND country='RU') AND denomination_value=$1 AND year=$2", [d.value, o.year])).rows;
    if (rows.length) {
      const words = o.title.toLowerCase().split(/[^а-яё0-9]+/).filter((w) => w.length > 3);
      let best = rows[0], bs = -1;
      for (const r of rows) { const nf = (r.name_full || "").toLowerCase(); const sc = words.filter((w) => nf.includes(w)).length; if (sc > bs) { bs = sc; best = r; } }
      return { id: best.id, conf: bs > 0 ? 0.8 : 0.5 };
    }
    return await createSelf(o, d, "RU", null);
  }
  const cen = await countryEn(o.title); if (!cen) return null;
  const ex = (await pool.query(
    "SELECT id FROM coin_type WHERE era='foreign' AND country=$1 AND year=$2 AND denomination_text ILIKE $3 LIMIT 1",
    [cen, o.year, `${d.num}%`])).rows[0];
  if (ex) return { id: ex.id, conf: 0.7 };
  return await createSelf(o, d, cen, `${d.num} ${d.unit}`);
}

async function createSelf(o, d, country, denomText) {
  const era = d.isRf ? null : "foreign";
  const theme = o.title.replace(/^\s*\d+(?:[.,]\d+)?\s*[а-яё]+/i, "").replace(/\b20\d{2}\s*года?\b/gi, "").replace(/[^а-яёa-z0-9 ]/gi, " ").replace(/\s+/g, " ").trim().slice(0, 50);
  const tk = (`aru|${country}|${d.num} ${d.unit}|${o.year}|${theme}`).toLowerCase().slice(0, 200);
  const nf = `${d.num} ${d.unit}. ${country === "RU" ? "Россия" : country}${theme ? " — " + theme : ""} ${o.year}`.replace(/\s+/g, " ").trim();
  const r = await pool.query(
    `INSERT INTO coin_type (source,era,status,name_full,country,denomination_text,denomination_value,year,type_key,image_url,theme_core)
     VALUES ('auctionru',$1,'confirmed',$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (era,type_key) WHERE era IS NOT NULL DO UPDATE SET image_url=COALESCE(coin_type.image_url,EXCLUDED.image_url)
     RETURNING id`,
    [era, nf, country, denomText, d.isRf ? d.value : null, o.year, tk, photoUrl(o.offer_id), theme]);
  return { id: r.rows[0].id, conf: 0.6 };
}

async function captureSale(o, dry) {
  const g = gradeFromTitle(o.title);
  const slabInfo = extractSlabInfo({ description: o.title, condition: g.grade });
  const m = await matchOrCreateType(o);
  if (dry) { console.log(`  SALE ${o.price}₽ | grade=${g.grade} | slab=${slabInfo.slabStatus}/${slabInfo.gradingCompanyCode || '-'} | type=${m ? m.id + " conf" + m.conf : "НЕ сматчен"} | ${o.title.slice(0, 55)}`); return; }
  if (!m) return false;
  // Тот же offer_id уже лежит active-оффером (ingest-auctionru-active) — частичный уникальный индекс
  // auction_lots_src_lot (source_site, lot_number) WHERE source_site IN ('meshok.net','auction.ru').
  // Сделка не плодит вторую строку, а ПЕРЕВОДИТ оффер в 'sold' с финальной ценой.
  const r = await pool.query(
    `INSERT INTO auction_lots (source_site,source_category,lot_number,source_url,winning_bid,currency,condition,auction_end_date,coin_description,avers_image_url,year,lot_status,category,parsing_method,bids_count,slab_status,grading_company_code,grading_company_raw,slab_grade_code,grade_source,slab_extractor_version,slab_evidence_text)
     VALUES ('auction.ru','auction.ru-coins',$1,$2,$3,'RUB',$4,now(),$5,$6,$7,'sold','auction.ru','auctionru-poller',$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (source_site, lot_number) WHERE source_site IN ('meshok.net','auction.ru') DO UPDATE SET
       lot_status='sold', winning_bid=EXCLUDED.winning_bid, auction_end_date=now(),
       condition=COALESCE(EXCLUDED.condition, auction_lots.condition),
       coin_description=COALESCE(EXCLUDED.coin_description, auction_lots.coin_description),
       source_url=COALESCE(EXCLUDED.source_url, auction_lots.source_url),
       bids_count=COALESCE(EXCLUDED.bids_count, auction_lots.bids_count),
       parsing_method='auctionru-poller',
       slab_status=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.slab_status ELSE EXCLUDED.slab_status END,
       grading_company_code=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.grading_company_code ELSE EXCLUDED.grading_company_code END,
       grading_company_raw=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.grading_company_raw ELSE EXCLUDED.grading_company_raw END,
       slab_grade_code=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.slab_grade_code ELSE EXCLUDED.slab_grade_code END,
       grade_source=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.grade_source ELSE EXCLUDED.grade_source END,
       slab_extractor_version=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.slab_extractor_version ELSE EXCLUDED.slab_extractor_version END,
       slab_evidence_text=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.slab_evidence_text ELSE EXCLUDED.slab_evidence_text END
     RETURNING id`,
    [o.offer_id, o.url, o.price, g.grade, o.title, photoUrl(o.offer_id), o.year, o.hasBids ? 1 : null,
     slabInfo.slabStatus, slabInfo.gradingCompanyCode, slabInfo.gradingCompanyRaw,
     slabInfo.gradeSource === 'slab_label' ? slabInfo.gradeCode : null,
     slabInfo.gradeSource, slabInfo.extractorVersion, slabInfo.evidenceText]);
  await pool.query(
    `INSERT INTO lot_type_link (lot_id,type_id,grade,match_method,match_confidence) VALUES ($1,$2,$3,'auctionru',$4) ON CONFLICT (lot_id) DO NOTHING`,
    [r.rows[0].id, m.id, g.grade, m.conf]);
  return true;
}

(async () => {
  const args = process.argv.slice(2);
  if (args[0] === "--test") {
    for (const url of args.slice(1)) {
      const p = parse(await fetchHtml(url));
      const oid = (url.match(/-i(\d+)\.html/) || [])[1];
      const year = +((url.match(/_((?:19|20)\d{2})_goda_/) || [])[1]) || null;
      console.log(`\n${p.av} | price=${p.price} | bids=${p.hasBids} | фото=${p.nPhotos}`);
      if ((p.av === "OutOfStock" || p.av === "SoldOut") && p.price && p.hasBids) {
        await captureSale({ offer_id: oid, url, price: p.price, title: p.title, hasBids: p.hasBids, year }, true);
      } else console.log("  → не сделка (активно/без ставок/без цены) — пропуск");
    }
    await close(); await pool.end(); return;
  }

  const lim = parseInt(args[0] || "0", 10);
  const lots = (await pool.query(`SELECT offer_id,url,year FROM auctionru_queue WHERE NOT captured AND COALESCE(status,'') <> 'dead' ORDER BY last_checked ASC NULLS FIRST ${lim ? "LIMIT " + lim : ""}`)).rows;
  console.log("слежу за лотами:", lots.length);
  let sold = 0, active = 0, dead = 0, failed = 0;
  for (const l of lots) {
   try {
    const html = await fetchHtml(l.url);
    if (!html || html.length < 1500) { await pool.query("UPDATE auctionru_queue SET status='dead' WHERE offer_id=$1", [l.offer_id]); dead++; continue; }
    const p = parse(html);
    if ((p.av === "OutOfStock" || p.av === "SoldOut") && p.price && p.hasBids) {
      const okk = await captureSale({ offer_id: l.offer_id, url: l.url, price: p.price, title: p.title, hasBids: p.hasBids, year: l.year }, false);
      await pool.query("UPDATE auctionru_queue SET captured=$2, availability='OutOfStock', last_price=$3, has_bids=true, last_checked=now() WHERE offer_id=$1", [l.offer_id, !!okk, p.price]);
      if (okk) sold++;
    } else {
      await pool.query("UPDATE auctionru_queue SET availability=$2, last_price=$3, has_bids=$4, last_checked=now() WHERE offer_id=$1", [l.offer_id, p.av, p.price, p.hasBids]);
      active++;
    }
    if ((sold + active) % 100 === 0) process.stderr.write(`  sold=${sold} active=${active}\r`);
   } catch (e) {
    // сбой на одном оффере (сеть/парс/БД) не должен ронять весь ночной проход
    failed++;
    console.error(`  ОШИБКА offer ${l.offer_id}: ${e.message}`);
   }
  }
  console.log(`\nPOLL: продаж зафиксировано ${sold} | активных обновлено ${active} | мёртвых ${dead} | сбоев ${failed}`);
  await close(); await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
