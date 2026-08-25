/**
 * Каталог монет — ИМПЕРСКОЕ (1700-1917). Само-сборка типов из наших auction_lots.
 * Тип имперской монеты = структурные атрибуты (номинал+год+двор/минцмейстер+редкость),
 * свободного имени нет -> fuzzy не нужен, типы и проходы строятся одним проходом.
 * Биткин-номера = отдельный слой обогащения (позже). Запуск: node catalog/build-imperial.js
 */
const { pool } = require("./db");

const CATS = [
  "Монеты России до 1917 года (серебро)",
  "Монеты России до 1917 года (медь)",
  "Монеты России до 1917 (золото)",
];

function parse(d) {
  const cn = d.match(/^(.+?)(?=\s*\d{4}\s*г)/);
  if (!cn) return null;
  const denom = cn[1].trim().replace(/\s+/g, " ");
  let mm = d.match(/\d{4}\s*г?\.?\s*([^.|]{1,18}?)\.?\s*(?:Ag|Au|Pt|Pd|Cu|Ni|Fe|Zn)\b/i);
  let mint = mm ? mm[1].trim().replace(/\s+/g, " ") : null;
  if (mint && !/^[A-ZА-ЯЁ]/.test(mint)) mint = null; // мусорные токены
  const rare = /(RRR|RR|R1|R2|R3|редкост)/i.test(d) ? "R" : "";
  return { denom, mint, rare };
}
const keyOf = (p, year) => `${p.denom}|${year}|${p.mint || "?"}|${p.rare}`;

async function ensureColumns() {
  await pool.query(`ALTER TABLE coin_type
    ADD COLUMN IF NOT EXISTS era TEXT,
    ADD COLUMN IF NOT EXISTS rarity TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS coin_type_era_key
    ON coin_type(era, type_key) WHERE era IS NOT NULL`);
}

async function bulkInsertTypes(types) {
  for (let i = 0; i < types.length; i += 800) {
    const chunk = types.slice(i, i + 800);
    const n = [], dt = [], dv = [], y = [], m = [], r = [], tk = [], c = [];
    for (const t of chunk) { n.push(t.name_full); dt.push(t.denom); dv.push(t.denomValue); y.push(t.year); m.push(t.mint); r.push(t.rarity); tk.push(t.type_key); c.push(t.country); }
    await pool.query(
      `INSERT INTO coin_type (source, era, name_full, denomination_text, denomination_value, year, mint, rarity, status, type_key, country, theme_core)
       SELECT 'auction_imperial','imperial', n, dt, dv, y, m, r, 'confirmed', tk, c, ''
       FROM unnest($1::text[],$2::text[],$3::numeric[],$4::int[],$5::text[],$6::text[],$7::text[],$8::text[]) AS u(n,dt,dv,y,m,r,tk,c)
       ON CONFLICT (era, type_key) WHERE era IS NOT NULL DO NOTHING`,
      [n, dt, dv, y, m, r, tk, c]
    );
  }
}
async function bulkLink(links) {
  for (let i = 0; i < links.length; i += 1000) {
    const chunk = links.slice(i, i + 1000);
    const lot = [], typ = [], gr = [];
    for (const r of chunk) { lot.push(r.lot_id); typ.push(r.type_id); gr.push(r.grade); }
    await pool.query(
      `INSERT INTO lot_type_link (lot_id, type_id, grade, match_method)
       SELECT lot, typ, gr, 'structural' FROM unnest($1::int[],$2::int[],$3::text[]) AS u(lot,typ,gr)
       ON CONFLICT (lot_id) DO UPDATE SET type_id=EXCLUDED.type_id, grade=EXCLUDED.grade, match_method=EXCLUDED.match_method`,
      [lot, typ, gr]
    );
  }
}

(async () => {
  await ensureColumns();
  await pool.query("DELETE FROM coin_type WHERE era='imperial'"); // чистая пересборка (cascade сносит их lot_type_link)

  const q = await pool.query(
    "SELECT id, year, condition, coin_description d FROM auction_lots WHERE category = ANY($1) AND year BETWEEN 1700 AND 1917 AND coin_description IS NOT NULL AND (auction_end_date IS NULL OR auction_end_date < now())",
    [CATS]
  );
  // distinct типы
  const typeMap = new Map(); // key -> {denom,year,mint,rare}
  const lotKeys = [];        // {id, key, grade}
  let skipped = 0;
  for (const r of q.rows) {
    const p = parse(r.d);
    if (!p) { skipped++; continue; }
    const key = keyOf(p, r.year);
    if (!typeMap.has(key)) typeMap.set(key, p);
    lotKeys.push({ id: r.id, key, grade: r.condition });
  }

  const N = require("./normalize");
  const types = [...typeMap.entries()].map(([key, p]) => ({
    type_key: key, denom: p.denom, denomValue: N.denomination(p.denom).value,
    year: Number(key.split("|")[1]), mint: p.mint, rarity: p.rare || null, country: "RU",
    name_full: `${p.denom} ${key.split("|")[1]}${p.mint ? " " + p.mint : ""}${p.rare ? " " + p.rare : ""}`,
  }));
  await bulkInsertTypes(types);

  // карта key->id
  const idr = await pool.query("SELECT id, type_key FROM coin_type WHERE era='imperial'");
  const id4key = new Map(idr.rows.map((r) => [r.type_key, r.id]));
  const links = lotKeys.map((l) => ({ lot_id: l.id, type_id: id4key.get(l.key), grade: l.grade })).filter((l) => l.type_id);
  await bulkLink(links);

  const c = await pool.query("SELECT count(*) c FROM coin_type WHERE era='imperial'");
  const lk = await pool.query("SELECT count(*) c FROM lot_type_link l JOIN coin_type ct ON ct.id=l.type_id WHERE ct.era='imperial'");
  console.log("================ ИМПЕРСКОЕ (само-сборка из наших данных) ================");
  console.log(`лотов: ${q.rows.length}, пропущено(без номинала): ${skipped}`);
  console.log(`типов создано: ${c.rows[0].c}`);
  console.log(`проходов привязано: ${lk.rows[0].c} (100% по построению)`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
