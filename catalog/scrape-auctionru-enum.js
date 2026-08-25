/**
 * auction.ru ПАРСЕР — Фаза A (enumeration). Прокрутка sitemap → монето-подобные offer 2019+ → очередь.
 * Грубый фильтр по slug (год 2019+, num_unit, не филателия); тонкая чистка — в Фазе B (по заголовку).
 * Resume-safe (ON CONFLICT). Детач. node catalog/scrape-auctionru-enum.js
 */
const { execSync } = require("child_process");
const { pool } = require("./db");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
const sleep = (ms) => { try { execSync(`sleep ${ms / 1000}`); } catch (_) {} };
const get1 = (url) => { try { return execSync(`curl -s -A "${UA}" --max-time 40 "${url}"`, { maxBuffer: 256 * 1024 * 1024 }).toString("utf8"); } catch (e) { return ""; } };
// DDoS-Guard/таймаут иногда отдаёт пустоту — молча получалось «под-сайтмапов: 0» и холостой прогон. Ретраим.
const get = (url, tries = 3) => {
  for (let i = 0; i < tries; i++) {
    const h = get1(url);
    if (h && h.length > 200 && !/ddos-guard|checking your browser|just a moment/i.test(h)) return h;
    sleep(2000 * (i + 1));
  }
  return "";
};

const PHIL = /(kpd|kartmaksimum|konvert|buklet|otkrytka|znachok|_znak_|_marka_|_marok_|medal|zheton|_lot_|podborka|kljaser|albom|katalog|_bona_|^bona_|banknot|bankonot)/;
// Номинал+валюта ГДЕ УГОДНО в слаге, а не только в начале: «moneta_10_rublej_2024_goda…»,
// «kazakhstan_10_tenge_2020_goda…» раньше отбрасывались якорем ^\d — это ~треть годных офферов.
const DENOM = /(^|_)\d+(_\d+)?_(rubl|rub|kopeek|kopejk|kopeika|kop|dollar|evro|euro|cent|centov|frank|funt|marok|marki|kron|zlot|lir|peso|rupi|jen|ien|von|juan|dinar|dram|manat|tenge|griven|grivn|som|lev|lej|forint|shilling|dukat|taler|gulden|real|bat)/;

(async () => {
  const idx = get("https://auction.ru/sitemap.xml");
  const maps = [...idx.matchAll(/<loc>(https:\/\/auction\.ru\/sitemaps\/sitemap_\d+\.xml)<\/loc>/g)].map((m) => m[1]);
  console.log("под-сайтмапов:", maps.length);
  // Пустой индекс = сайтмап не отдался (или сменил формат). Раньше это тихо давало «добавлено 0».
  if (!maps.length) { console.error("FATAL sitemap.xml пуст или не распознан — очередь не пополнена"); await pool.end(); process.exit(1); }
  let skippedEmpty = 0;
  let added = 0, scanned = 0;
  for (const sm of maps) {
    const xml = get(sm); sleep(250); scanned++;
    if (!xml) { skippedEmpty++; continue; }
    const batch = [];
    for (const m of xml.matchAll(/<loc>(https:\/\/auction\.ru\/offer\/([a-z0-9_-]+)-i(\d+)\.html)<\/loc>/g)) {
      const url = m[1], slug = m[2], oid = m[3];
      const ym = slug.match(/_(2019|202[0-6])_goda_/); if (!ym) continue;
      if (!DENOM.test(slug)) continue;                   // <число>_<валюта> в любом месте слага
      if (PHIL.test(slug)) continue;
      batch.push({ oid, url, slug, year: +ym[1] });
    }
    for (let i = 0; i < batch.length; i += 500) {
      const ch = batch.slice(i, i + 500), oi = [], u = [], s = [], y = [];
      for (const b of ch) { oi.push(b.oid); u.push(b.url); s.push(b.slug); y.push(b.year); }
      const r = await pool.query(`INSERT INTO auctionru_queue (offer_id,url,slug,year) SELECT * FROM unnest($1::text[],$2::text[],$3::text[],$4::int[]) ON CONFLICT (offer_id) DO NOTHING`, [oi, u, s, y]);
      added += r.rowCount;
    }
    if (scanned % 10 === 0) console.log(`  sitemap ${scanned}/${maps.length} | очередь +${added}`);
  }
  if (skippedEmpty) console.error(`ВНИМАНИЕ: ${skippedEmpty} под-сайтмапов не отдались (после ретраев)`);
  const tot = (await pool.query("SELECT count(*) c FROM auctionru_queue")).rows[0].c;
  console.log(`ENUM DONE: добавлено ${added} | всего в очереди ${tot}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
