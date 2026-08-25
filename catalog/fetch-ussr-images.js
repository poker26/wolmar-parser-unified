/**
 * Фото для USSR-типов из fcoins: на карточке catalogussrub fcoins показывает wolmar-фото
 * проходов — берём первую пару полноразмерных URL (аверс/реверс) и кладём в coin_type.
 * Идемпотентно (skip если image_url уже есть). Запуск: node catalog/fetch-ussr-images.js
 */
const { execSync } = require("child_process");
const { pool } = require("./db");
const N = require("./normalize");

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
function curl(url) {
  return execSync(`curl -s -A "${UA}" "${url}" | iconv -f CP1251 -t UTF-8//TRANSLIT 2>/dev/null`, { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
}
function sleep(ms) { try { execSync(`sleep ${ms / 1000}`); } catch (_) {} }
function clean(s) { return String(s || "").replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ").replace(/&#\d+;/g, " ").replace(/\s+/g, " ").trim(); }

function parseCard(html) {
  const h1 = (html.match(/<h1[^>]*>([^<]*)<\/h1>/i) || [])[1] || "";
  let name = clean(h1).replace(/^Описание и стоимость монеты\s*/i, "").trim();
  const ym = html.match(/год выпуска[^«]*«(\d{4})»/i) || html.match(/«(\d{4})»/) || html.match(/\b(19\d{2}|20\d{2})\b/);
  const year = ym ? parseInt(ym[1], 10) : null;
  // первая пара полноразмерных wolmar-фото (из onclick window.open)
  const full = [...html.matchAll(/window\.open\('(https:\/\/www\.wolmar\.ru\/images\/auctions\/[^']+_([12])\.jpg)'/gi)];
  let av = null, rv = null;
  for (const m of full) {
    if (m[2] === "1" && !av) av = m[1];
    if (m[2] === "2" && !rv) rv = m[1];
    if (av && rv) break;
  }
  return { name, year, av, rv };
}

(async () => {
  await pool.query(`ALTER TABLE coin_type ADD COLUMN IF NOT EXISTS image_url TEXT, ADD COLUMN IF NOT EXISTS image_url_rev TEXT`);
  // индекс типов СССР по ключу (деном|год|ядро|спец)
  const t = await pool.query("SELECT id, denomination_value, year, theme_core, spec_flag, image_url FROM coin_type WHERE era='ussr'");
  const byKey = new Map();
  for (const r of t.rows) {
    const dv = r.denomination_value == null ? null : Number(r.denomination_value);
    byKey.set([dv, r.year, r.theme_core, r.spec_flag ? "S" : ""].join("|"), r);
  }
  // карточки fcoins
  const ids = new Set();
  let empty = 0;
  for (let p = 1; p <= 20; p++) {
    const html = curl(`https://www.fcoins.ru/catalogussrub.asp?pagenom=${p}`);
    const found = [...new Set([...html.matchAll(/catalogussrub(\d+)\.asp/gi)].map((m) => m[1]))];
    const before = ids.size;
    found.forEach((x) => ids.add(x));
    if (ids.size === before) { if (++empty >= 2) break; } else empty = 0;
    sleep(120);
  }
  console.log(`карточек fcoins: ${ids.size}`);
  let matched = 0, updated = 0, noimg = 0, nomatch = 0;
  for (const id of ids) {
    try {
      const c = parseCard(curl(`https://www.fcoins.ru/catalog/catalogussrub/catalogussrub${id}.asp`));
      if (!c.name) continue;
      const denom = N.denomination(c.name);
      const core = N.core(N.stripNominal(c.name));
      const spec = N.specFlag(c.name);
      const hit = byKey.get([denom.value, c.year, core, spec ? "S" : ""].join("|"));
      if (!hit) { nomatch++; continue; }
      matched++;
      if (!c.av) { noimg++; continue; }
      if (hit.image_url) continue; // уже есть
      await pool.query("UPDATE coin_type SET image_url=$1, image_url_rev=$2 WHERE id=$3", [c.av, c.rv, hit.id]);
      updated++;
    } catch (e) {}
    sleep(120);
  }
  const cov = await pool.query("SELECT count(*) FILTER (WHERE image_url IS NOT NULL) has, count(*) total FROM coin_type WHERE era='ussr'");
  console.log(`matched=${matched} updated=${updated} noimg=${noimg} nomatch=${nomatch}`);
  console.log(`USSR типов с фото: ${cov.rows[0].has}/${cov.rows[0].total}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
