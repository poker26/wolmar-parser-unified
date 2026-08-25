/**
 * Каталог монет — матчер: привязка наших auction_lots к типам coin_type (= проходы).
 * Двухступенчато: точный type_key → core+spec без двора (добор двора) → иначе в review_queue.
 * Чистая пересборка lot_type_link/review_queue. Запуск: node catalog/match-lots.js
 */
const { pool } = require("./db");
const N = require("./normalize");

const CATEGORY = "Монеты РСФСР, СССР, России";
const Y_MIN = 1992, Y_MAX = 2026; // скелет ЦБ покрывает 1992-2026

// токены ядра темы (для fuzzy)
function toks(core) { return new Set(String(core || "").split(" ").filter((w) => w.length >= 3)); }
// скор похожести: cbr-ядро полностью внутри нашего -> 0.9; иначе Жаккар
function simScore(ourT, candT) {
  if (!ourT.size || !candT.size) return 0;
  let inter = 0;
  for (const w of candT) if (ourT.has(w)) inter++;
  const jac = inter / (ourT.size + candT.size - inter);
  const contained = inter === candT.size ? 0.9 : 0;
  return Math.max(contained, jac);
}

function parseLot(d) {
  if (N.isExcluded(d)) return null;
  const cn = d.match(/^(.+?)(?=\s*\d{4}г)/);
  if (!cn) return null;
  const name = cn[1].trim();
  const denom = N.denomination(name);
  if (denom.value == null) return null;
  const theme = N.stripNominal(name);
  const themeCore = N.core(theme);
  if (!themeCore) return null;
  let mm = d.match(/\d{4}\s*г\.?\s*([^.|]{1,14}?)\.?\s*(?:Ag|Au|Pt|Pd|Cu|Ni)\b/i);
  let mint = mm ? mm[1].trim() : null;
  if (mint && (!/^[А-ЯЁA-Z][А-ЯЁA-Z0-9\s\/-]*$/.test(mint) || mint.length < 2)) mint = null;
  return { denomValue: denom.value, theme, themeCore, mint, spec: N.specFlag(d) };
}

async function bulkInsertLinks(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const vals = [], params = [];
    chunk.forEach((r, j) => {
      const b = j * 5;
      vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
      params.push(r.lot_id, r.type_id, r.grade, r.method, r.conf);
    });
    await pool.query(
      `INSERT INTO lot_type_link (lot_id, type_id, grade, match_method, match_confidence)
       VALUES ${vals.join(",")}
       ON CONFLICT (lot_id) DO UPDATE SET type_id=EXCLUDED.type_id, grade=EXCLUDED.grade,
         match_method=EXCLUDED.match_method, match_confidence=EXCLUDED.match_confidence`,
      params
    );
  }
}
async function bulkInsertReview(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const vals = [], params = [];
    chunk.forEach((r, j) => {
      const b = j * 5;
      vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5}::jsonb)`);
      params.push(r.lot_id, r.our_theme, r.bucket, r.finding, JSON.stringify(r.candidates || null));
    });
    await pool.query(
      `INSERT INTO review_queue (lot_id, our_theme, bucket, finding, candidates)
       VALUES ${vals.join(",")}`,
      params
    );
  }
}

(async () => {
  // 1) индексы типов в память
  const t = await pool.query("SELECT id, denomination_value, year, mint, theme_core, spec_flag FROM coin_type");
  const byKey = new Map();        // полный type_key -> {id,mint}
  const byCoreSpec = new Map();   // denom|year|core|spec -> [{id,mint}]
  const byDenYearSpec = new Map();// denom|year|spec -> [{id,mint,core,tk}]  (для fuzzy)
  for (const r of t.rows) {
    const dv = r.denomination_value == null ? null : Number(r.denomination_value);
    const key = N.typeKey({ denomValue: dv, year: r.year, mint: r.mint, themeCore: r.theme_core, spec: r.spec_flag });
    byKey.set(key, { id: r.id, mint: r.mint });
    const s = r.spec_flag ? "S" : "";
    const csk = [dv, r.year, r.theme_core, s].join("|");
    if (!byCoreSpec.has(csk)) byCoreSpec.set(csk, []);
    byCoreSpec.get(csk).push({ id: r.id, mint: r.mint });
    const dys = [dv, r.year, s].join("|");
    if (!byDenYearSpec.has(dys)) byDenYearSpec.set(dys, []);
    byDenYearSpec.get(dys).push({ id: r.id, mint: r.mint, core: r.theme_core, tk: toks(r.theme_core) });
  }
  console.log(`типов в индексе: ${byKey.size}`);

  // 2) чистая пересборка ТОЛЬКО современного сегмента (era IS NULL = cbr/modern).
  // НЕ трогаем imperial/ussr-связи — иначе rebuild-all затирает их работу (был баг: глобальный DELETE).
  await pool.query("DELETE FROM lot_type_link l USING coin_type ct WHERE l.type_id = ct.id AND ct.era IS NULL");
  await pool.query("DELETE FROM review_queue WHERE bucket NOT LIKE 'ussr|%'");

  // 3) наши лоты
  const q = await pool.query(
    `SELECT id, year, condition, coin_description FROM auction_lots
     WHERE category = $1 AND year BETWEEN $2 AND $3 AND coin_description IS NOT NULL
       AND (auction_end_date IS NULL OR auction_end_date < now())`,
    [CATEGORY, Y_MIN, Y_MAX]
  );
  const stat = { total: q.rows.length, exact: 0, mintless: 0, yearshift: 0, fuzzy: 0, no_match: 0, ambiguous: 0, skipped: 0 };
  const links = [], reviews = [];
  for (const r of q.rows) {
    const p = parseLot(r.coin_description);
    if (!p) { stat.skipped++; continue; }
    const bucket = `${p.denomValue}|${r.year}|${p.mint || "?"}`;
    const key = N.typeKey({ denomValue: p.denomValue, year: r.year, mint: p.mint, themeCore: p.themeCore, spec: p.spec });
    let hit = byKey.get(key);
    if (hit) { links.push({ lot_id: r.id, type_id: hit.id, grade: r.condition, method: "exact_core", conf: 1.0 }); stat.exact++; continue; }
    const cands = byCoreSpec.get([p.denomValue, r.year, p.themeCore, p.spec ? "S" : ""].join("|")) || [];
    if (cands.length === 1) { links.push({ lot_id: r.id, type_id: cands[0].id, grade: r.condition, method: "exact_core_mintless", conf: 0.9 }); stat.mintless++; continue; }
    if (cands.length > 1) { reviews.push({ lot_id: r.id, our_theme: p.theme, bucket, finding: "ambiguous", candidates: cands }); stat.ambiguous++; continue; }
    // фолбэк сдвига года: монета датирована не годом выпуска (лунная серия, Сочи). Только если кандидат ЕДИНСТВЕНный по соседним годам.
    let yhit = null, ycount = 0;
    for (const dy of [r.year - 1, r.year + 1, r.year - 2, r.year + 2]) {
      const c = byCoreSpec.get([p.denomValue, dy, p.themeCore, p.spec ? "S" : ""].join("|"));
      if (c && c.length) { ycount += c.length; if (!yhit) yhit = c[0]; }
    }
    if (ycount === 1 && yhit) { links.push({ lot_id: r.id, type_id: yhit.id, grade: r.condition, method: "year_shift", conf: 0.8 }); stat.yearshift++; continue; }
    // FUZZY: токен-похожесть внутри корзины (деном+год±1+спец), двор не должен противоречить
    const ourT = toks(p.themeCore);
    const cand = [];
    for (const dy of [r.year, r.year - 1, r.year + 1]) {
      for (const c of byDenYearSpec.get([p.denomValue, dy, p.spec ? "S" : ""].join("|")) || []) {
        if (p.mint && c.mint && p.mint !== c.mint) continue;
        cand.push({ id: c.id, core: c.core, sc: simScore(ourT, c.tk) });
      }
    }
    cand.sort((a, b) => b.sc - a.sc);
    const strong = cand.filter((c) => c.sc >= 0.6);
    if (strong.length >= 1 && (strong.length === 1 || strong[0].sc - strong[1].sc >= 0.2)) {
      links.push({ lot_id: r.id, type_id: strong[0].id, grade: r.condition, method: "fuzzy", conf: Number(strong[0].sc.toFixed(2)) }); stat.fuzzy++; continue;
    }
    if (strong.length > 1) { reviews.push({ lot_id: r.id, our_theme: p.theme, bucket, finding: "ambiguous", candidates: strong.slice(0, 4).map((c) => ({ id: c.id, core: c.core, sc: c.sc })) }); stat.ambiguous++; continue; }
    reviews.push({ lot_id: r.id, our_theme: p.theme, bucket, finding: "no_match", candidates: null }); stat.no_match++;
  }

  await bulkInsertLinks(links);
  await bulkInsertReview(reviews);

  const cov = await pool.query("SELECT count(DISTINCT type_id) c FROM lot_type_link");
  const gap = await pool.query("SELECT count(*) c FROM coin_type ct WHERE NOT EXISTS (SELECT 1 FROM lot_type_link l WHERE l.type_id=ct.id)");
  const linked = stat.exact + stat.mintless + stat.yearshift + stat.fuzzy;
  console.log("================ МАТЧ ЛОТОВ -> ТИПЫ (памятные 1992-2026) ================");
  console.log(`лотов всего: ${stat.total}`);
  console.log(`привязано: ${linked} (${Math.round(100 * linked / stat.total)}%) = exact ${stat.exact} + mintless ${stat.mintless} + year_shift ${stat.yearshift} + fuzzy ${stat.fuzzy}`);
  console.log(`в ревью: no_match ${stat.no_match}, ambiguous ${stat.ambiguous}`);
  console.log(`пропущено (наборы/брак/без темы/без номинала): ${stat.skipped}`);
  console.log(`типов с проходами: ${cov.rows[0].c} / ${byKey.size}; дыра полноты (типы без проходов): ${gap.rows[0].c}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
