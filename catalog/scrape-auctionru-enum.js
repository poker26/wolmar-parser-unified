/**
 * auction.ru ПАРСЕР — Фаза A (enumeration). Прокрутка sitemap → монето-подобные offer 2019+ → очередь.
 * Грубый фильтр по slug (год 2019+, num_unit, не филателия); тонкая чистка — в Фазе B (по заголовку).
 * Resume-safe (ON CONFLICT). Детач. node catalog/scrape-auctionru-enum.js
 */
const { execSync } = require("child_process");
const { pool } = require("./db");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
const get = (url) => { try { return execSync(`curl -s -A "${UA}" --max-time 40 "${url}"`, { maxBuffer: 256 * 1024 * 1024 }).toString("utf8"); } catch (e) { return ""; } };
const sleep = (ms) => { try { execSync(`sleep ${ms / 1000}`); } catch (_) {} };

const PHIL = /(kpd|kartmaksimum|konvert|buklet|otkrytka|znachok|_znak_|_marka_|_marok_|medal|zheton|_lot_|podborka|kljaser|albom|katalog)/;

(async () => {
  const idx = get("https://auction.ru/sitemap.xml");
  const maps = [...idx.matchAll(/<loc>(https:\/\/auction\.ru\/sitemaps\/sitemap_\d+\.xml)<\/loc>/g)].map((m) => m[1]);
  console.log("под-сайтмапов:", maps.length);
  let added = 0, scanned = 0;
  for (const sm of maps) {
    const xml = get(sm); sleep(250); scanned++;
    const batch = [];
    for (const m of xml.matchAll(/<loc>(https:\/\/auction\.ru\/offer\/([a-z0-9_-]+)-i(\d+)\.html)<\/loc>/g)) {
      const url = m[1], slug = m[2], oid = m[3];
      const ym = slug.match(/_(2019|202[0-6])_goda_/); if (!ym) continue;
      if (!/^\d+(_\d+)?_[a-z]/.test(slug)) continue;     // <число>_<валюта>
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
  const tot = (await pool.query("SELECT count(*) c FROM auctionru_queue")).rows[0].c;
  console.log(`ENUM DONE: добавлено ${added} | всего в очереди ${tot}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
