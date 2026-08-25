/**
 * Live-поиск по площадкам (сценарий 2 «где купить / история»). auction.ru: GET-форма поиска →
 * URL `/listing/offer/search_<query+с+плюсами>` (browser-fetch, проходит DDoS-Guard, robots-clean).
 * Возвращает офферы с ценой из встроенного JSON-стейта (lotGroups items: {id,price,title,type}).
 *   const { searchAuctionRu } = require("./live-search");
 */
const { fetchHtml } = require("./browser-fetch");
const { execFile } = require("child_process");

// Поиск ВНУТРИ категории «Монеты» (monety-48393), а не по всему сайту — иначе лезут палатки/марки/открытки/банкноты.
// Форма проверена: /listing/offer/<категория>/search_<q>. Банкноты — отдельная категория, сюда не попадают.
const COINS_CAT = "monety-48393";
const surl = (q) => `https://auction.ru/listing/offer/${COINS_CAT}/search_` + encodeURIComponent(q).replace(/%20/g, "+");

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36";
// curl страницы оффера (DDoS-Guard пропускает с UA — как в scrape-auctionru-fetch). Async, не блокирует loop.
const curlGet = (url) => new Promise((resolve) =>
  execFile("curl", ["-s", "-A", UA, "--max-time", "18", url], { maxBuffer: 32 * 1024 * 1024 }, (e, out) => resolve(out || "")));

// декод HTML-сущностей в og:title (&middot; &mdash; &laquo; … и числовые)
const decodeEnt = (s) => !s ? s : s
  .replace(/&middot;/g, "·").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
  .replace(/&laquo;/g, "«").replace(/&raquo;/g, "»").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");

// Enrich: цена + чистый RU-заголовок + фото со страницы оффера (как в scrape-auctionru-fetch).
async function fetchOfferDetail(url) {
  const html = await curlGet(url);
  if (!html || html.length < 1500) return {};
  const title = decodeEnt((html.match(/og:title"\s+content="([^"]*)"/) || [])[1] || null);
  const price = (html.match(/"price"\s*:\s*"?(\d+)"?/) || [])[1];
  const image = (html.match(/og:image"\s+content="(https:\/\/static\.auction\.ru\/[^"]+?\.jpe?g)"/) || [])[1]
    || (html.match(/https:\/\/static\.auction\.ru\/offer_images\/[^\s"'\\]+?\.jpe?g/) || [])[0] || null;
  const ended = /Завершен|Завершён|Лот продан|\bПродан\b/i.test(html);
  return { price: price ? +price : null, title_ru: title, image, ended };
}

// рекурсивно найти массив офферов (объекты с id+price+title) в распарсенном JSON
function findItems(o) {
  let best = [];
  (function walk(x) {
    if (Array.isArray(x)) {
      if (x.length && x[0] && typeof x[0] === "object" && "id" in x[0] && "price" in x[0] && "title" in x[0]) { if (x.length > best.length) best = x; }
      x.forEach(walk);
    } else if (x && typeof x === "object") { for (const k of Object.keys(x)) walk(x[k]); }
  })(o);
  return best;
}

async function searchAuctionRu(query, { max = 25, enrich = 6 } = {}) {
  // curl (НЕ браузер): сервер-рендер применяет поиск внутри категории; puppeteer-SPA сбрасывает на дефолт категории.
  let h = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    h = await curlGet(surl(query));
    if (/ddos-guard|checking your browser|just a moment/i.test(h)) { h = ""; continue; }  // челлендж — повтор
    if (h && h.length > 5000) break;
  }
  if (!h || /ничего не найдено|по вашему запросу.{0,30}не найден/i.test(h)) return { found: 0, offers: [] };
  // офферы из HTML-ссылок (slug = описание лота в транслите); цены/фото — на страницах лотов (enrich ниже)
  const seen = new Set(), offers = [];
  for (const m of h.matchAll(/\/offer\/([a-z0-9_-]+)-i(\d+)\.html/gi)) {
    const slug = m[1], id = m[2];
    if (seen.has(id)) continue; seen.add(id);
    offers.push({ id, slug, title: decodeURIComponent(slug).replace(/_/g, " "), url: `https://auction.ru/offer/${slug}-i${id}.html` });
    if (offers.length >= max) break;
  }
  // enrich топ-N: цена + чистый заголовок + фото (параллельно curl, страницы офферов DDoS-Guard пропускает)
  if (enrich > 0 && offers.length) {
    await Promise.all(offers.slice(0, enrich).map(async (o) => {
      try { const d = await fetchOfferDetail(o.url); o.price = d.price ?? null; o.title_ru = d.title_ru || null; o.image = d.image || null; o.ended = !!d.ended; }
      catch (_) { /* оффер без enrich — покажем ссылкой */ }
    }));
  }
  return { found: seen.size, offers };
}

// ── meshok.net (за Cloudflare → Scrapfly) ─────────────────────────────────────
const { fetchHtml: solverFetch } = require("./solver-fetch");
const MESHOK_COINS = "252";   // категория «Монеты» (поиск ВНУТРИ неё, иначе глобал тащит картины/книги/значки)

function parseMeshokLots(html) {
  const scripts = [...String(html).matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const s of scripts) { let j; try { j = JSON.parse(s); } catch (_) { continue; }
    const mod = j["store/lots/cache"]; if (mod && mod.cache) { const arr = Array.isArray(mod.cache) ? mod.cache : Object.values(mod.cache); if (arr.length) return arr; } }
  return [];
}

// Поиск на meshok через Scrapfly. Лоты (id/price/title/bidsCount/endDate) уже в JSON-стейте — enrich НЕ нужен.
async function searchMeshok(query, { max = 24 } = {}) {
  const url = `https://meshok.net/listing?good=${MESHOK_COINS}&search=${encodeURIComponent(query)}`;
  // 1 попытка (retries:0) — чтобы уложиться в таймаут nginx (~60с); Scrapfly residential+render ~15-30с.
  const r = await solverFetch(url, { residential: true, waitMs: 4000, waitForSelector: ".itemCard_789be", retries: 0 });
  const lots = parseMeshokLots(r.content || "");
  const offers = [];
  for (const l of lots) {
    if (!l.price) continue;
    offers.push({ id: String(l.id), title: l.title || "", price: l.price, bids: l.bidsCount || 0,
      end: l.endDate || null, qty: l.quantity || 1, url: `https://meshok.net/item/${l.id}` });
    if (offers.length >= max) break;
  }
  return { found: lots.length, offers };
}

module.exports = { searchAuctionRu, surl, fetchOfferDetail, searchMeshok };
