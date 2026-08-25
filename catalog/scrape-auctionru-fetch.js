/**
 * auction.ru ПАРСЕР — Фаза B (process). Очередь → fetch карточки → парс (номинал/цена/статус) +
 * фото в MinIO bucket coin-photos/<offer_id>/N.jpg → запись в auctionru_lots, mark done. Resume-safe.
 * Страну/тему/грейд + матчинг в coin_type — отдельным шагом интеграции (по title).
 * node catalog/scrape-auctionru-fetch.js [limit]   (детач для полного прогона)
 */
const { execSync } = require("child_process");
const fs = require("fs");
const { pool } = require("./db");
const Minio = require("minio");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
const get = (url) => { try { return execSync(`curl -s -A "${UA}" --max-time 35 "${url}"`, { maxBuffer: 64 * 1024 * 1024 }).toString("utf8"); } catch (e) { return ""; } };
const sleep = (ms) => { try { execSync(`sleep ${ms / 1000}`); } catch (_) {} };

const env = Object.fromEntries(fs.readFileSync("/opt/numismatics/.env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/\r$/, "").replace(/^["']|["']$/g, "")]; }));
const mc = new Minio.Client({ endPoint: env.MINIO_ENDPOINT, port: 443, useSSL: true, accessKey: env.MINIO_ACCESS_KEY, secretKey: env.MINIO_SECRET_KEY });
const BUCKET = "coin-photos";
const RU_UNIT = /^(rubl|kopej|kopee|kopei)/;

const slugDenom = (slug) => { const m = slug.match(/^(\d+(?:_\d+)?)_([a-z]+)/); if (!m) return null; const num = m[1].includes("_") ? (() => { const [a, b] = m[1].split("_"); return b ? +a / +b : +a; })() : +m[1]; return { num, unit: m[2] }; };

async function dlPhoto(url, key) {
  const tmp = "/tmp/aru_" + Math.random().toString(36).slice(2) + ".jpg";
  try {
    execSync(`curl -s -A "${UA}" --max-time 30 -o "${tmp}" "${url}"`);
    if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 1000) { try { fs.unlinkSync(tmp); } catch (_) {} return false; }
    await mc.fPutObject(BUCKET, key, tmp, { "Content-Type": "image/jpeg" });
    fs.unlinkSync(tmp); return true;
  } catch (e) { try { fs.unlinkSync(tmp); } catch (_) {} return false; }
}

(async () => {
  const lim = parseInt(process.argv[2] || "0", 10);
  const q = await pool.query(`SELECT offer_id,url,slug,year FROM auctionru_queue WHERE status='pending' ORDER BY year DESC ${lim ? "LIMIT " + lim : ""}`);
  console.log("к обработке:", q.rows.length);
  let ok = 0, dead = 0, ph = 0;
  for (const r of q.rows) {
    const html = get(r.url); sleep(180);
    if (!html || html.length < 2000) { await pool.query("UPDATE auctionru_queue SET status='dead' WHERE offer_id=$1", [r.offer_id]); dead++; continue; }
    const title = (html.match(/og:title"\s+content="([^"]*)"/) || [])[1] || "";
    const price = (html.match(/"price"\s*:\s*"?(\d+)"?/) || [])[1] || null;
    const ended = /Завершен|Завершён|Лот продан|Продан/i.test(html);
    const d = slugDenom(r.slug);
    const isForeign = d ? !RU_UNIT.test(d.unit) : null;
    const purls = [...new Set([...html.matchAll(/https:\/\/static\.auction\.ru\/offer_images\/[^\s"'\\]+?\.jpe?g/g)].map((m) => m[0]))].slice(0, 4);
    let np = 0;
    for (let i = 0; i < purls.length; i++) { if (await dlPhoto(purls[i], `${r.offer_id}/${i}.jpg`)) np++; }
    ph += np;
    await pool.query(
      `INSERT INTO auctionru_lots (offer_id,slug,url,title,denom_value,denom_unit,year,is_foreign,price,sold,status,n_photos,minio_prefix)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (offer_id) DO UPDATE SET title=EXCLUDED.title,price=EXCLUDED.price,sold=EXCLUDED.sold,n_photos=EXCLUDED.n_photos,minio_prefix=EXCLUDED.minio_prefix`,
      [r.offer_id, r.slug, r.url, title, d ? d.num : null, d ? d.unit : null, r.year, isForeign, price ? +price : null, ended && !!price, ended ? "ended" : "active", np, np ? `${BUCKET}/${r.offer_id}/` : null]);
    await pool.query("UPDATE auctionru_queue SET status='done' WHERE offer_id=$1", [r.offer_id]);
    ok++;
    if (ok % 25 === 0) process.stderr.write(`  ok=${ok} фото=${ph}\r`);
  }
  console.log(`\nFETCH DONE: обработано ${ok} | мёртвых ${dead} | фото залито ${ph}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
