/**
 * Интеграция auction.ru → coin_type (v1: ИНОСТРАННЫЕ 2019+). Парс title (страна через numis_country_map,
 * номинал, тема), отсев не-монет/наборов/РФ-мispарс, дедуп → self-типы era='foreign' source='auctionru'
 * с ФОТО (image_url=/api/coinphoto) + ценой auction.ru (aru_price медиана). Re-runnable.
 * node catalog/integrate-auctionru.js
 */
const { pool } = require("./db");

const photoUrl = (oid) => `/api/coinphoto?k=${oid}/0.jpg`;
const NONCOIN = /банкнот|карточк|конверт|жетон|значок|медал|открытк|\bмарк[аи]\b|сувенир|магнит|закладк|плакат|календар/i;
const SET = /набор|комплект|подборк|\bлот\b|\d+\s*шт\b|\d+\s*монет|запайк/i;
const tc = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

const parseDenom = (t) => {
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(рубл[а-яё]*|копе[а-яё]*|евро|доллар[а-яё]*|центов?|фунт[а-яё]*|тенге|гривен|гривн[а-яё]*|сум[а-яё]*|песо|юан[а-яё]*|лир[а-яё]*|динар[а-яё]*|драм[а-яё]*|манат[а-яё]*|франк[а-яё]*|крон[а-яё]*|вон[а-яё]*|иен[а-яё]*|йен[а-яё]*|рупи[а-яё]*|реал[а-яё]*|шиллинг[а-яё]*|форинт[а-яё]*|злот[а-яё]*|бат[а-яё]*|лев[а-яё]*|ле[йя][а-яё]*)/i);
  if (!m) return null;
  return { num: parseFloat(m[1].replace(",", ".")), unit: m[2].toLowerCase(), isRf: /^(рубл|копе)/.test(m[2].toLowerCase()) };
};

(async () => {
  await pool.query(`ALTER TABLE coin_type ADD COLUMN IF NOT EXISTS aru_price BIGINT, ADD COLUMN IF NOT EXISTS aru_count INT, ADD COLUMN IF NOT EXISTS aru_url TEXT`);
  const cm = (await pool.query("SELECT ru,en FROM numis_country_map WHERE en IS NOT NULL")).rows.sort((a, b) => b.ru.length - a.ru.length);
  const findCountry = (t) => { for (const r of cm) if (t.includes(r.ru)) return { en: tc(r.en), ru: r.ru }; return null; };

  const lots = (await pool.query("SELECT offer_id,title,year,n_photos,price,url FROM auctionru_lots WHERE is_foreign AND n_photos>0")).rows;
  const groups = new Map();
  let skNon = 0, skRf = 0, skCtry = 0, skDen = 0;
  for (const l of lots) {
    const t = (l.title || "").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
    if (NONCOIN.test(t) || SET.test(t)) { skNon++; continue; }
    const d = parseDenom(t); if (!d) { skDen++; continue; }
    if (d.isRf) { skRf++; continue; }
    const c = findCountry(t); if (!c) { skCtry++; continue; }
    const theme = t.replace(/^\s*\d+(?:[.,]\d+)?\s*[а-яё]+/i, "").replace(/\b20\d{2}\s*года?\b/gi, "")
      .replace(new RegExp(c.ru, "gi"), "").replace(/\b(UNC|PROOF|пруф|пресс|в слабе|ngs|pcgs|\bau\b|ms\d*|\bxf\b|оригинал|серебро|золото|редкая)\b/gi, "")
      .replace(/[^а-яёa-z0-9 ]/gi, " ").replace(/\s+/g, " ").trim().slice(0, 50);
    const key = `${c.en}|${d.num} ${d.unit}|${l.year}|${theme.toLowerCase()}`;
    let g = groups.get(key);
    if (!g) { g = { country: c.en, denom: `${d.num} ${d.unit}`, year: l.year, theme, prices: [], offer: l.offer_id, url: l.url }; groups.set(key, g); }
    if (l.price) g.prices.push(+l.price);
  }
  console.log(`foreign-лотов с фото: ${lots.length} | групп-типов: ${groups.size} | skip: non-coin ${skNon}, РФ-мispарс ${skRf}, без страны ${skCtry}, без номинала ${skDen}`);

  let up = 0;
  for (const g of groups.values()) {
    const p = g.prices.sort((a, b) => a - b);
    const med = p.length ? p[Math.floor(p.length / 2)] : null;
    const nf = `${g.denom}. ${g.country}${g.theme ? " — " + g.theme : ""} ${g.year}`.replace(/\s+/g, " ").trim();
    const tk = (`aru|${g.country}|${g.denom}|${g.year}|${g.theme}`).toLowerCase().slice(0, 200);
    await pool.query(
      `INSERT INTO coin_type (source,era,status,name_full,country,denomination_text,year,type_key,image_url,aru_price,aru_count,aru_url,theme_core)
       VALUES ('auctionru','foreign','confirmed',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (era,type_key) WHERE era IS NOT NULL
       DO UPDATE SET aru_price=EXCLUDED.aru_price, aru_count=EXCLUDED.aru_count, aru_url=EXCLUDED.aru_url, image_url=COALESCE(coin_type.image_url,EXCLUDED.image_url)`,
      [nf, g.country, g.denom, g.year, tk, photoUrl(g.offer), med, g.prices.length, g.url, g.theme]);
    up++;
  }
  console.log(`auction.ru foreign-типов создано/обновлено: ${up}`);
  const c = (await pool.query("SELECT count(*) c, count(image_url) img FROM coin_type WHERE source='auctionru'")).rows[0];
  console.log(`итого source=auctionru: ${c.c} типов, с фото ${c.img}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
