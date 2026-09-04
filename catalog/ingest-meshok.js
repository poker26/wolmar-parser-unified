/**
 * Ингест meshok.net через Scrapfly. Любая карточка монеты (активная, проданная или завершённая
 * без ставок) сохраняется для каталога. Только состоявшаяся сделка получает lot_status='sold'
 * и цену прохода; непроданный лот хранится как ended_unsold с winning_bid=NULL.
 * Лоты из JSON-стейта store/lots/cache (map id→лот). Матч — общий coin-matcher (все эры). БЕЗ фото.
 *   node catalog/ingest-meshok.js --file <path> <sold|active>     — тест парса/матча БЕЗ Scrapfly
 *   node catalog/ingest-meshok.js <cat> <maxPages> <sold|active>  — боевой
 *
 * ПАРАМЕТРЫ ЛИСТИНГА (разобраны 26.08 по коду фронта, функция разбора query в shared-бандле):
 *   good=<категория> · opt=2 аукционы / opt=3 фикс-цена · a_o=25 завершённая выдача
 *   pp=<размер страницы> (до 200; 500 отдаёт пусто) · pN=<СМЕЩЕНИЕ в лотах, не номер страницы>
 * Проверено: pp=200 → 200 лотов за один вызов, pN=2000 листает вглубь (модерн-РФ ~2145 сделок,
 * даты окончания с февраля по август). Параметры page/p/offset/pageNumber сайт игнорирует.
 * ⚠️ Без a_o=25 листинг отдаёт ИДУЩИЕ аукционы, а не завершённые — на этом мы обожглись: 209 строк
 * записались как sold с ценой «ставка в моменте» (см. auction_end_date > parsed_at).
 */
const fs = require("fs");
const { pool } = require("./db");
const { fetchHtml } = require("./solver-fetch");
const { DIAG, parseTitle, matchType } = require("./coin-matcher");
const { stageCatalogCandidate } = require('./catalog-candidates');
const { classifyMeshokObservation } = require('./marketplace-observation');
const { extractSlabInfo } = require("../domain/slab-info");

// лоты из JSON-стейта (application/json → store/lots/cache.cache = map id→лот)
function parseLots(html) {
  const scripts = [...html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const s of scripts) {
    let j; try { j = JSON.parse(s); } catch (_) { continue; }
    const mod = j["store/lots/cache"];
    if (mod && mod.cache) { const arr = Array.isArray(mod.cache) ? mod.cache : Object.values(mod.cache); if (arr.length) return arr; }
  }
  return [];
}

async function ingestLot(l, sold, dry) {
  const observation = classifyMeshokObservation({
    mode: sold ? 'ended' : 'active', bidsCount: l.bidsCount, price: l.price, endDate: l.endDate,
  });
  // l.quantity>1 = у продавца N ОДИНАКОВЫХ монет в наличии (цена за штуку) — валидный одиночный оффер, НЕ набор.
  // Реальные наборы разных монет ловит текстовый SET-фильтр (p.isSet).
  const p = parseTitle(l.title);
  const slabInfo = extractSlabInfo({ description: l.title, condition: p.grade });
  if (p.isNonCoin) return "noncoin";
  if (p.isSet) return "set";
  if (!p.denom) return "nodenom";
  if (!p.year) return "noyear";
  // Несматченный лот всё равно СОХРАНЯЕМ (без связи с типом): страница уже оплачена кредитами, а
  // матчер иностранных монет заведомо слабее русского (межъязыковой барьер, экзотические номиналы).
  // Привязать задним числом умеет catalog/relink-orphans.js. На медианы это не влияет — они считаются
  // через lot_type_link, а его у сироты нет.
  DIAG.on = true;
  const m = await matchType(pool, p);
  const matchReason = DIAG.reason;
  if (dry) { console.log(`  ${observation.lotStatus.toUpperCase()} ${l.price || '-'}₽ [${m ? m.era : matchReason || "не сматчен"}] type=${m ? m.id : "-"} | ${(l.title || "").slice(0, 46)}`); return m ? "ok" : "nomatch"; }
  const r = await pool.query(
    `INSERT INTO auction_lots (source_site,source_category,lot_number,source_url,winning_bid,currency,condition,auction_end_date,coin_description,year,lot_status,category,parsing_method,bids_count,slab_status,grading_company_code,grading_company_raw,slab_grade_code,grade_source,slab_extractor_version,slab_evidence_text)
     VALUES ('meshok.net','meshok-coins',$1,$2,$3,'RUB',$4,$5,$6,$7,$8,'meshok','meshok-ingest',$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (source_site,lot_number) WHERE source_site IN ('meshok.net','auction.ru') DO UPDATE SET
       winning_bid=CASE WHEN auction_lots.lot_status='sold' AND EXCLUDED.lot_status<>'sold' THEN auction_lots.winning_bid ELSE EXCLUDED.winning_bid END,
       condition=EXCLUDED.condition, auction_end_date=EXCLUDED.auction_end_date,
       lot_status=CASE WHEN auction_lots.lot_status='sold' AND EXCLUDED.lot_status<>'sold' THEN auction_lots.lot_status ELSE EXCLUDED.lot_status END,
       bids_count=EXCLUDED.bids_count,
       slab_status=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.slab_status ELSE EXCLUDED.slab_status END,
       grading_company_code=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.grading_company_code ELSE EXCLUDED.grading_company_code END,
       grading_company_raw=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.grading_company_raw ELSE EXCLUDED.grading_company_raw END,
       slab_grade_code=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.slab_grade_code ELSE EXCLUDED.slab_grade_code END,
       grade_source=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.grade_source ELSE EXCLUDED.grade_source END,
       slab_extractor_version=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.slab_extractor_version ELSE EXCLUDED.slab_extractor_version END,
       slab_evidence_text=CASE WHEN auction_lots.grade_source='user' THEN auction_lots.slab_evidence_text ELSE EXCLUDED.slab_evidence_text END
     RETURNING id, lot_status, (xmax = 0) AS inserted`,
    [String(l.id), `https://meshok.net/item/${l.id}`, observation.storedPrice, p.grade, l.endDate || null, l.title, p.year, observation.lotStatus, l.bidsCount || 0,
      slabInfo.slabStatus, slabInfo.gradingCompanyCode, slabInfo.gradingCompanyRaw,
      slabInfo.gradeSource === 'slab_label' ? slabInfo.gradeCode : null,
      slabInfo.gradeSource, slabInfo.extractorVersion, slabInfo.evidenceText]);
  if (m) {
    await pool.query("INSERT INTO lot_type_link (lot_id,type_id,grade,match_method,match_confidence) VALUES ($1,$2,$3,'meshok',$4) ON CONFLICT (lot_id) DO NOTHING",
      [r.rows[0].id, m.id, p.grade, m.conf]);
  } else {
    const staged = await stageCatalogCandidate(pool, {
      parsed: p,
      matchReason,
      lot: {
        id: r.rows[0].id,
        sourceSite: 'meshok.net',
        sourceLotNumber: String(l.id),
        sourceUrl: `https://meshok.net/item/${l.id}`,
        lotStatus: r.rows[0].lot_status,
        title: l.title,
      },
    });
    if (staged.staged) return r.rows[0].inserted ? "new-candidate" : "dup-candidate";
  }
  const fresh = r.rows[0].inserted;             // «new» = реально вставлен; «dup» = апдейт уже виденного (для терминации)
  if (!m) return fresh ? "new-unmatched" : "dup-unmatched";
  return fresh ? "new" : "dup";
}

// Переиспользуемо (CLI + Temporal-активити): фетч ОДНОЙ страницы категории + ингест лотов. Идемпотентно (upsert).
async function ensureMeshokIndex() {
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS auction_lots_src_lot ON auction_lots(source_site, lot_number) WHERE source_site IN ('meshok.net','auction.ru')");
}
const PAGE_SIZE = 200;            // максимум, который отдаёт листинг (500 уже пусто)
// mode: 'sold' — успешно завершённые аукционы (a_o=25), 'active' — идущие. Старый вызов с opt=2/1
// продолжает работать: 2 → sold, 1 → active.
const listUrl = ({ cat, mode, offset, pageSize = PAGE_SIZE }) =>
  `https://meshok.net/listing?good=${cat}&opt=2${mode === "sold" ? "&a_o=25" : ""}&pp=${pageSize}${offset ? `&pN=${offset}` : ""}`;

async function ingestMeshokPage({ cat, page = 1, mode, opt, pageSize = PAGE_SIZE, onHeartbeat } = {}) {
  const m = mode || (String(opt) === "1" ? "active" : "sold");
  const sold = m === "sold";
  const u = listUrl({ cat, mode: m, offset: (page - 1) * pageSize, pageSize });
  let content = "", cost = 0, lots = [];
  for (let attempt = 0; attempt < 3 && !lots.length; attempt++) {
    const r = await fetchHtml(u, { residential: true, waitMs: 6000, waitForSelector: ".itemCard_789be" });
    content = r.content || ""; cost += r.cost || 0; lots = parseLots(content);
    if (onHeartbeat) onHeartbeat({ phase: "fetch", attempt, lots: lots.length });
  }
  // Подпись страницы = id первого и последнего лота. За концом пагинации meshok отдаёт ТЕ ЖЕ лоты,
  // и это единственный честный признак конца: считать по «0 новых» нельзя — страница может быть
  // целиком составлена из уже виденных карточек, хотя пагинация ещё не кончилась.
  const stat = { lots: lots.length, cost, sig: lots.length ? `${lots[0].id}:${lots[lots.length - 1].id}` : null };
  for (const l of lots) {
    if (sold && !(l.bidsCount > 0)) stat['ended-unsold'] = (stat['ended-unsold'] || 0) + 1;
    const r = await ingestLot(l, sold, false); stat[r] = (stat[r] || 0) + 1;
  }
  if (onHeartbeat) onHeartbeat({ phase: "done", stat });
  return stat;
}

if (require.main === module) (async () => {
  const args = process.argv.slice(2);
  const dry = args[0] === "--file";
  const modeArg = (args[2] || "sold").toLowerCase();
  const mode = modeArg === "active" || modeArg === "1" ? "active" : "sold";
  const sold = mode === "sold";
  if (!dry) await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS auction_lots_src_lot ON auction_lots(source_site, lot_number) WHERE source_site IN ('meshok.net','auction.ru')");

  let pages = [];
  if (dry) pages = [fs.readFileSync(args[1], "utf8")];
  else {
    const cat = args[0] || "252", maxP = parseInt(args[1] || "1", 10);
    for (let p = 1; p <= maxP; p++) {
      const u = listUrl({ cat, mode, offset: (p - 1) * PAGE_SIZE });
      let content = "", cost = 0, n = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetchHtml(u, { residential: true, waitMs: 6000, waitForSelector: ".itemCard_789be" });
        content = r.content || ""; cost += r.cost || 0; n = parseLots(content).length;
        if (n > 0) break;
      }
      console.log(`страница ${p} (${mode}, смещение ${(p - 1) * PAGE_SIZE}): ${content.length} байт, лотов=${n}, cost=${cost}`);
      if (content) pages.push(content);
    }
  }
  const stat = {}, eras = {};
  for (const html of pages) {
    const lots = parseLots(html);
    console.log(`лотов в стейте: ${lots.length} (режим ${sold ? "SOLD" : "ACTIVE"})`);
    for (const l of lots) {
      if (sold && !(l.bidsCount > 0)) stat['ended-unsold'] = (stat['ended-unsold'] || 0) + 1;
      const r = await ingestLot(l, sold, dry); stat[r] = (stat[r] || 0) + 1;
    }
  }
  console.log("итог:", JSON.stringify(stat));
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });

module.exports = { ingestMeshokPage, ensureMeshokIndex, parseLots, ingestLot };
