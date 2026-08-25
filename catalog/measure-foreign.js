/** Измерение парсера иностранных монет (без записи). node catalog/measure-foreign.js */
const { pool } = require("./db");
const F = require("./foreign");
const cat = "Монеты иностранные";
const THRESH = 2;
const STOPLIST = new Set(["африка", "европа", "азия", "америка", "топ-грейд", "топ грейд", "бронтозавр", "банковский токен", "зомбобык"]);

const collapse = (s) => String(s || "").replace(/\s+/g, " ").trim();
const METAL_ALT = F.METALS.join("|");
function cleanSeg(s) {
  let t = s.replace(F.STRIP_QUAL, " ").replace(F.FINISH_RE, " ");
  F.STRIP_QUAL.lastIndex = 0; F.FINISH_RE.lastIndex = 0;
  t = t.replace(/\s*(1[5-9]\d\d|20\d\d).*$/, "");
  t = t.replace(new RegExp(`(?<![A-Za-z])(${METAL_ALT})(?![A-Za-z]).*$`, "i"), "");
  return collapse(t).replace(/^[.,\s\-|]+/, "").replace(/[.,\s\-|]+$/, "").trim();
}
function restOf(desc) {
  const head = collapse(desc).split("|")[0];
  const segs = head.split(". ").map((s) => s.trim()).filter(Boolean);
  return segs.slice(1).map(cleanSeg);
}

(async () => {
  const q = await pool.query(`SELECT coin_description d, condition, winning_bid FROM auction_lots WHERE category=$1 AND coin_description IS NOT NULL`, [cat]);
  const live = q.rows.filter((r) => !F.BATCH_RE.test(r.d) && !(F.EXCLUDE_RE.test(r.d) | (F.EXCLUDE_RE.lastIndex = 0)));

  // PASS A: страновой якорь
  const cf = new Map();
  for (const r of live) {
    const rest = restOf(r.d);
    // кандидат страны = первый place-like сегмент, НЕ застоплистенный и НЕ субгосударство
    const cand = rest.find((x) => x && F.isPlaceLike(x) && !STOPLIST.has(F.setKey(x)) && !F.SUBSTATE_PARENT[F.setKey(x)]);
    if (!cand) continue;
    cf.set(F.setKey(cand), (cf.get(F.setKey(cand)) || 0) + 1);
  }
  const countrySet = new Set([...cf.entries()].filter(([, n]) => n >= THRESH).map(([k]) => k));
  console.log(`PASS A: страновой якорь (freq>=${THRESH}): ${countrySet.size}`);

  // PASS B: словарь субгосударств (сосед страны, place-like, freq>=2)
  const sf = new Map();
  for (const r of live) {
    const rest = restOf(r.d);
    let pi = -1; for (let i = 0; i < rest.length; i++) if (rest[i] && countrySet.has(F.setKey(rest[i]))) { pi = i; break; }
    if (pi < 0) continue;
    for (const j of [pi + 1, pi - 1]) {
      if (j < 0 || j >= rest.length || j === pi) continue;
      const seg = rest[j];
      if (seg && F.isIssuerLike(seg) && !countrySet.has(F.setKey(seg)) && !STOPLIST.has(F.setKey(seg))) sf.set(F.setKey(seg), (sf.get(F.setKey(seg)) || 0) + 1);
    }
  }
  const substateSet = new Set([...sf.entries()].filter(([, n]) => n >= 2).map(([k]) => k));
  console.log(`PASS B: словарь субгосударств (freq>=2): ${substateSet.size}`);

  // PASS C: разбор
  let ok = 0, batch = 0, fake = 0, nocountry = 0, noseg = 0, withIssuer = 0;
  const types = new Map(), countries = new Map(), issuers = new Map(); const noSamp = [];
  for (const r of q.rows) {
    const p = F.parse(r.d, countrySet, substateSet);
    if (!p) { noseg++; continue; }
    if (p.excluded) { p.reason === "batch" ? batch++ : fake++; continue; }
    if (p.reason === "no-segments") { noseg++; continue; }
    if (p.reason === "no-country") { nocountry++; if (noSamp.length < 30) noSamp.push(`[${p.raw1 || "?"}] ${r.d.slice(0, 85)}`); continue; }
    ok++;
    if (p.issuer) { withIssuer++; issuers.set(`${p.country} / ${p.issuer}`, (issuers.get(`${p.country} / ${p.issuer}`) || 0) + 1); }
    types.set(`${p.country}|${p.issuer || ""}|${p.denomValue || ""} ${p.unit}|${p.year || ""}|${p.metal || ""}`, 1);
    countries.set(p.country, (countries.get(p.country) || 0) + 1);
  }
  console.log(`\nPASS C (всего ${q.rows.length}):`);
  console.log(`  распознано: ${ok} (с эмитентом: ${withIssuer})`);
  console.log(`  батчи: ${batch} | фейки/брак: ${fake} | без страны(abstain): ${nocountry} | без сегм: ${noseg}`);
  console.log(`  ТИПОВ: ${types.size} | стран: ${countries.size} | пар страна/эмитент: ${issuers.size}`);
  console.log(`\n=== топ-20 эмитентов ===\n` + [...issuers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => `  ${n}\t${k}`).join("\n"));
  console.log(`\n=== 30 abstain ===\n` + noSamp.map((s) => "  " + s).join("\n"));
  await pool.end(); process.exit(0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
