/**
 * numismat.ru — curl+cheerio парсер (БЕЗ браузера, сайт чистый HTML без обходов).
 * Аукционный дом (source_site='numismat.ru') → идёт в ценовую (value) медиану wolmar+numismat.
 * Страница: au.shtml?au=<N>&num=100&page=<K>; лот в блоке .tview (полное описание .lot_txt + цены).
 * Экспорт: listAuctions(html), parseNumismatPage(html, au), ingestNumismatPage({au,page}).
 */
const { execFile } = require("child_process");
const cheerio = require("cheerio");
const { pool } = require("./db");
const { parseTitle, matchType } = require("./coin-matcher");

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36";
const curlGet = (url) => new Promise((resolve) =>
  execFile("curl", ["-s", "-A", UA, "--max-time", "40", url], { maxBuffer: 64 * 1024 * 1024 }, (e, out) => resolve(out || "")));

const num = (s) => { const m = String(s || "").replace(/[\s ]/g, "").match(/(\d+)/); return m ? parseInt(m[1], 10) : null; };

// Список номеров аукционов с auction.shtml
function listAuctions(html) {
  return [...new Set([...String(html).matchAll(/au\.shtml\?au=(\d+)/g)].map((m) => +m[1]))].sort((a, b) => a - b);
}

// Дата "HH:MM:SS DD.MM.YYYY" → ISO
function parseDate(s) {
  const m = String(s || "").match(/(\d{2}):(\d{2}):(\d{2})\s+(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[6]}-${m[5]}-${m[4]} ${m[1]}:${m[2]}:${m[3]}` : null;
}

// Парс лотов со страницы. Берём .tview блоки (полное описание + блок цен).
function parseNumismatPage(html, au) {
  const $ = cheerio.load(html);
  const lots = [];
  $("div.tview").each((_, el) => {
    const $b = $(el);
    const priceBox = $b.find(".shop-priceN");
    // номер лота: id="l<au>_<N>" в shop-priceN
    const idAttr = priceBox.attr("id") || $b.attr("id") || "";
    const lm = idAttr.match(new RegExp(`l${au}_(\\d+)`)) || idAttr.match(/l\w*?_(\d+)/) || idAttr.match(/l(\d+)/);
    const lotNumber = lm ? lm[1] : null;
    const description = $b.find(".lot_txt").text().replace(/\s+/g, " ").trim();
    const startingBid = num(priceBox.find(".p_start .priceR").first().text());
    // итоговая цена закрытого лота: p_cur0 / p_cur-1 (текущая=финальная). p_bid пустой = без ставок.
    let winningBid = num(priceBox.find(".p_cur0 .priceR, .p_cur-1 .priceR").first().text());
    if (!winningBid) winningBid = num(priceBox.find(".p_bid .priceR").first().text());
    const endDate = parseDate(priceBox.find(".s_close, .l_closed1").first().text());
    const imgs = [...new Set($b.find(".shop-pic img[data-src]").map((i, im) => $(im).attr("data-src")).get())]
      .map((s) => (s.startsWith("http") ? s : "https://numismat.ru" + s).replace(/\?.*$/, ""));
    if (lotNumber && description) lots.push({ lotNumber, description, startingBid, winningBid, endDate, images: imgs });
  });
  return lots;
}

// total лотов аукциона (для расчёта числа страниц)
function totalLots(html) {
  const m = String(html).match(/всего лотов:?\s*([\d\s ]+)/i);
  return m ? num(m[1]) : null;
}

const PER = 100;   // лотов на страницу (num=100)
const auUrl = (au, page) => `https://numismat.ru/au.shtml?au=${au}&num=${PER}&page=${page}`;

// Ингест одной страницы аукциона → auction_lots(source_site='numismat.ru') + lot_type_link.
async function ingestNumismatPage({ au, page = 0 }) {
  const html = await curlGet(auUrl(au, page));
  const lots = parseNumismatPage(html, au);
  const stat = { lots: lots.length };
  // auction_number с namespace-префиксом 'n' — чтобы НЕ коллизить с wolmar (общий констрейнт lot_number+auction_number,
  // без source_site; wolmar/numismat номера пересекаются). 'n1056' уникален в numismat-пространстве.
  const auKey = "n" + au;
  for (const l of lots) {
    const sold = l.winningBid && l.winningBid > 0;
    const r = await pool.query(
      `INSERT INTO auction_lots (lot_number,auction_number,source_site,coin_description,winning_bid,starting_bid,auction_end_date,avers_image_url,revers_image_url,source_url,lot_status,year,parsing_method)
       VALUES ($1,$2,'numismat.ru',$3,$4,$5,$6,$7,$8,$9,'closed',$10,'numismat-curl')
       ON CONFLICT (lot_number,auction_number) DO UPDATE SET winning_bid=EXCLUDED.winning_bid, coin_description=EXCLUDED.coin_description, auction_end_date=EXCLUDED.auction_end_date
       RETURNING id`,
      [l.lotNumber, auKey, l.description, sold ? l.winningBid : null, l.startingBid, l.endDate,
       l.images[0] || null, l.images[1] || null, auUrl(au, page),
       (l.description.match(/(\d{4})\s*г/) || [])[1] || null]).catch(() => null);
    if (!r) { stat.err = (stat.err || 0) + 1; continue; }
    stat.ok = (stat.ok || 0) + 1;
    // матч к каталогу (для медиан); идемпотентно
    try {
      const m = await matchType(pool, parseTitle(l.description));
      if (m) { await pool.query("INSERT INTO lot_type_link (lot_id,type_id,match_method,match_confidence) VALUES ($1,$2,'numismat',$3) ON CONFLICT (lot_id) DO NOTHING", [r.rows[0].id, m.id, m.conf]); stat.linked = (stat.linked || 0) + 1; }
    } catch (_) {}
  }
  return stat;
}

module.exports = { listAuctions, parseNumismatPage, ingestNumismatPage, totalLots, curlGet, auUrl, PER };
