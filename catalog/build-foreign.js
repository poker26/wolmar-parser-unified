/**
 * Каталог монет — ИНОСТРАННЫЕ. Само-сборка типов из наших auction_lots (нет внешнего референса).
 * Тип = Страна | Эмитент(субгосударство) | Номинал | Год | Металл. Проходы привязываются 100%
 * по построению; непарсящиеся (нет страны/сегментов) → review_queue (НЕ выдумываем тип).
 * Numista-обогащение (km#/имя/фото) — отдельный слой ПОТОМ (поля nullable уже заведены).
 * Запуск: node catalog/build-foreign.js
 */
const { pool } = require("./db");
const F = require("./foreign");

const CAT = "Монеты иностранные";

async function ensureColumns() {
  await pool.query(`ALTER TABLE coin_type
    ADD COLUMN IF NOT EXISTS era TEXT,
    ADD COLUMN IF NOT EXISTS issuer TEXT,
    ADD COLUMN IF NOT EXISTS metal TEXT,
    ADD COLUMN IF NOT EXISTS km_number TEXT,
    ADD COLUMN IF NOT EXISTS numista_id TEXT,
    ADD COLUMN IF NOT EXISTS canonical_name TEXT,
    ADD COLUMN IF NOT EXISTS ref_image_url TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS coin_type_era_key
    ON coin_type(era, type_key) WHERE era IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS coin_type_country ON coin_type(country) WHERE era='foreign'`);
}

// ключ типа включает ТЕМУ (нормализованную) — разные памятные монеты одной страны/номинала = разные типы
const keyOf = (p) => [p.country, p.issuer || "?", `${p.denomValue || ""} ${p.unit}`.trim(), p.year || "", p.metal || "", (p.theme || "").toLowerCase()].join("|");

async function bulkInsertTypes(types) {
  for (let i = 0; i < types.length; i += 700) {
    const ch = types.slice(i, i + 700);
    const nf = [], co = [], iss = [], dt = [], yr = [], me = [], tk = [], tc = [];
    for (const t of ch) { nf.push(t.name_full); co.push(t.country); iss.push(t.issuer); dt.push(t.denom_text); yr.push(t.year); me.push(t.metal); tk.push(t.type_key); tc.push(t.theme || ""); }
    await pool.query(
      `INSERT INTO coin_type (source, era, name_full, country, issuer, denomination_text, year, metal, status, type_key, theme_core)
       SELECT 'auction_foreign','foreign', nf, co, iss, dt, yr, me, 'confirmed', tk, tc
       FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::int[],$6::text[],$7::text[],$8::text[]) AS u(nf,co,iss,dt,yr,me,tk,tc)
       ON CONFLICT (era, type_key) WHERE era IS NOT NULL DO NOTHING`,
      [nf, co, iss, dt, yr, me, tk, tc]);
  }
}
async function bulkLink(links) {
  for (let i = 0; i < links.length; i += 1000) {
    const ch = links.slice(i, i + 1000);
    const lot = [], typ = [], gr = [];
    for (const r of ch) { lot.push(r.lot_id); typ.push(r.type_id); gr.push(r.grade); }
    await pool.query(
      `INSERT INTO lot_type_link (lot_id, type_id, grade, match_method)
       SELECT lot, typ, gr, 'structural' FROM unnest($1::int[],$2::int[],$3::text[]) AS u(lot,typ,gr)
       ON CONFLICT (lot_id) DO UPDATE SET type_id=EXCLUDED.type_id, grade=EXCLUDED.grade, match_method=EXCLUDED.match_method`,
      [lot, typ, gr]);
  }
}
async function bulkReview(rows) {
  for (let i = 0; i < rows.length; i += 1000) {
    const ch = rows.slice(i, i + 1000);
    const lot = [], th = [];
    for (const r of ch) { lot.push(r.lot_id); th.push(r.theme); }
    await pool.query(
      `INSERT INTO review_queue (lot_id, our_theme, finding, status)
       SELECT lot, th, 'no_match', 'open' FROM unnest($1::int[],$2::text[]) AS u(lot,th)`,
      [lot, th]);
  }
}

(async () => {
  await ensureColumns();
  await pool.query("DELETE FROM coin_type WHERE era='foreign'"); // чистая пересборка (cascade сносит links)
  await pool.query("DELETE FROM review_queue WHERE finding='no_match' AND our_theme LIKE 'FOREIGN:%'");

  const q = await pool.query(
    `SELECT id, condition, coin_description d FROM auction_lots
     WHERE category=$1 AND coin_description IS NOT NULL AND (auction_end_date IS NULL OR auction_end_date < now())`, [CAT]);

  const { countrySet, substateSet } = F.deriveSets(q.rows.map((r) => r.d));

  const typeMap = new Map(); const lotKeys = []; const review = [];
  let excludedBatch = 0, excludedFake = 0, abstain = 0, noseg = 0;
  for (const r of q.rows) {
    const p = F.parse(r.d, countrySet, substateSet);
    if (!p) { noseg++; continue; }
    if (p.excluded) { p.reason === "batch" ? excludedBatch++ : excludedFake++; continue; }
    if (p.reason === "no-segments") { noseg++; continue; }
    if (p.reason === "no-country") { abstain++; review.push({ lot_id: r.id, theme: "FOREIGN: " + String(r.d).slice(0, 120) }); continue; }
    const key = keyOf(p);
    if (!typeMap.has(key)) typeMap.set(key, p);
    lotKeys.push({ id: r.id, key, grade: r.condition });
  }

  const types = [...typeMap.entries()].map(([key, p]) => ({
    type_key: key, country: p.country, issuer: p.issuer || null, theme: p.theme || null,
    denom_text: `${p.denomValue || ""} ${p.unit}`.trim(), year: p.year || null, metal: p.metal || null,
    name_full: `${p.denom}. ${p.country}${p.issuer ? " (" + p.issuer + ")" : ""}${p.theme ? " — " + p.theme : ""}${p.year ? " " + p.year : ""}`.trim(),
  }));
  await bulkInsertTypes(types);

  const idr = await pool.query("SELECT id, type_key FROM coin_type WHERE era='foreign'");
  const id4key = new Map(idr.rows.map((r) => [r.type_key, r.id]));
  const links = lotKeys.map((l) => ({ lot_id: l.id, type_id: id4key.get(l.key), grade: l.grade })).filter((l) => l.type_id);
  await bulkLink(links);
  await bulkReview(review);

  const c = await pool.query("SELECT count(*) c FROM coin_type WHERE era='foreign'");
  const lk = await pool.query("SELECT count(*) c FROM lot_type_link l JOIN coin_type ct ON ct.id=l.type_id WHERE ct.era='foreign'");
  const cn = await pool.query("SELECT count(DISTINCT country) c FROM coin_type WHERE era='foreign'");
  console.log("================ ИНОСТРАННЫЕ (само-сборка из наших данных) ================");
  console.log(`лотов(архив): ${q.rows.length}`);
  console.log(`исключено: батчи ${excludedBatch}, копии/брак ${excludedFake}; без сегментов ${noseg}; abstain→review ${abstain}`);
  console.log(`типов: ${c.rows[0].c} | стран: ${cn.rows[0].c} | проходов привязано: ${lk.rows[0].c}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
