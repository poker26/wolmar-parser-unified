/**
 * Ингест meshok.net через Scrapfly. Завершённые (opt=2, sold) И активные (opt=1, current offers) →
 * auction_lots(source_site='meshok.net', lot_status='sold'|'active') → lot_type_link → source-aware.
 * Лоты из JSON-стейта store/lots/cache (map id→лот). Матч — общий coin-matcher (все эры). БЕЗ фото.
 *   node catalog/ingest-meshok.js --file <path> <opt>          — тест парса/матча БЕЗ Scrapfly (бесплатно)
 *   node catalog/ingest-meshok.js <cat> <maxPages> <opt>       — боевой (opt: 2=sold[деф], 1=active)
 */
const fs = require("fs");
const { pool } = require("./db");
const { fetchHtml } = require("./solver-fetch");
const { parseTitle, matchType } = require("./coin-matcher");

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
  if (sold && !(l.bidsCount > 0)) return "unsold";          // завершён без ставок — НЕ сделка
  if (!l.price) return "noprice";
  // l.quantity>1 = у продавца N ОДИНАКОВЫХ монет в наличии (цена за штуку) — валидный одиночный оффер, НЕ набор.
  // Реальные наборы разных монет ловит текстовый SET-фильтр (p.isSet).
  const p = parseTitle(l.title);
  if (p.isSet) return "set";
  if (!p.denom) return "nodenom";
  if (!p.year) return "noyear";
  const m = await matchType(pool, p);
  if (!m) return "nomatch";
  if (dry) { console.log(`  ${sold ? "SOLD " : "ACTIVE"} ${l.price}₽ [${m.era}] type=${m.id} | ${(l.title || "").slice(0, 46)}`); return "ok"; }
  const r = await pool.query(
    `INSERT INTO auction_lots (source_site,source_category,lot_number,source_url,winning_bid,currency,condition,auction_end_date,coin_description,year,lot_status,category,parsing_method,bids_count)
     VALUES ('meshok.net','meshok-coins',$1,$2,$3,'RUB',$4,$5,$6,$7,$8,'meshok','meshok-ingest',$9)
     ON CONFLICT (source_site,lot_number) WHERE source_site IN ('meshok.net','auction.ru') DO UPDATE SET winning_bid=EXCLUDED.winning_bid, condition=EXCLUDED.condition, auction_end_date=EXCLUDED.auction_end_date, lot_status=EXCLUDED.lot_status, bids_count=EXCLUDED.bids_count
     RETURNING id, (xmax = 0) AS inserted`,
    [String(l.id), `https://meshok.net/item/${l.id}`, l.price, p.grade, l.endDate || null, l.title, p.year, sold ? "sold" : "active", l.bidsCount || 0]);
  await pool.query("INSERT INTO lot_type_link (lot_id,type_id,grade,match_method,match_confidence) VALUES ($1,$2,$3,'meshok',$4) ON CONFLICT (lot_id) DO NOTHING",
    [r.rows[0].id, m.id, p.grade, m.conf]);
  return r.rows[0].inserted ? "new" : "dup";   // «new» = реально вставлен; «dup» = апдейт уже виденного (для терминации)
}

// Переиспользуемо (CLI + Temporal-активити): фетч ОДНОЙ страницы категории + ингест лотов. Идемпотентно (upsert).
async function ensureMeshokIndex() {
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS auction_lots_src_lot ON auction_lots(source_site, lot_number) WHERE source_site IN ('meshok.net','auction.ru')");
}
async function ingestMeshokPage({ cat, page = 1, opt = "2", onHeartbeat } = {}) {
  const sold = String(opt) === "2";
  const u = `https://meshok.net/listing?good=${cat}&opt=${opt}${page > 1 ? "&page=" + page : ""}`;
  let content = "", cost = 0, lots = [];
  for (let attempt = 0; attempt < 3 && !lots.length; attempt++) {
    const r = await fetchHtml(u, { residential: true, waitMs: 6000, waitForSelector: ".itemCard_789be" });
    content = r.content || ""; cost += r.cost || 0; lots = parseLots(content);
    if (onHeartbeat) onHeartbeat({ phase: "fetch", attempt, lots: lots.length });
  }
  const stat = { lots: lots.length, cost };
  for (const l of lots) {
    const r = await ingestLot(l, sold, false); stat[r] = (stat[r] || 0) + 1;
  }
  if (onHeartbeat) onHeartbeat({ phase: "done", stat });
  return stat;
}

if (require.main === module) (async () => {
  const args = process.argv.slice(2);
  const dry = args[0] === "--file";
  const opt = args[2] || "2";
  const sold = opt === "2";
  if (!dry) await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS auction_lots_src_lot ON auction_lots(source_site, lot_number) WHERE source_site IN ('meshok.net','auction.ru')");

  let pages = [];
  if (dry) pages = [fs.readFileSync(args[1], "utf8")];
  else {
    const cat = args[0] || "252", maxP = parseInt(args[1] || "1", 10);
    for (let p = 1; p <= maxP; p++) {
      const u = `https://meshok.net/listing?good=${cat}&opt=${opt}${p > 1 ? "&page=" + p : ""}`;
      let content = "", cost = 0, n = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetchHtml(u, { residential: true, waitMs: 6000, waitForSelector: ".itemCard_789be" });
        content = r.content || ""; cost += r.cost || 0; n = parseLots(content).length;
        if (n > 0) break;
      }
      console.log(`страница ${p} (opt=${opt}): ${content.length} байт, лотов=${n}, cost=${cost}`);
      if (content) pages.push(content);
    }
  }
  const stat = {}, eras = {};
  for (const html of pages) {
    const lots = parseLots(html);
    console.log(`лотов в стейте: ${lots.length} (режим ${sold ? "SOLD" : "ACTIVE"})`);
    for (const l of lots) {
      const r = await ingestLot(l, sold, dry); stat[r] = (stat[r] || 0) + 1;
    }
  }
  console.log("итог:", JSON.stringify(stat));
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });

module.exports = { ingestMeshokPage, ensureMeshokIndex, parseLots, ingestLot };
