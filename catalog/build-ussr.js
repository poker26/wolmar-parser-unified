/**
 * Каталог монет — СССР памятные/юбилейные (1965-1992). Скелет из fcoins catalogussrub
 * (каталог Федорина), затем матч наших USSR-лотов по теме (как у современных).
 * Ходячку/погодовку НЕ берём. Запуск: node catalog/build-ussr.js
 */
const { execSync } = require("child_process");
const { pool } = require("./db");
const N = require("./normalize");

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
const CAT_CATEGORY = "Монеты РСФСР, СССР, России";

function curl(url) {
  return execSync(`curl -s -A "${UA}" "${url}" | iconv -f CP1251 -t UTF-8//TRANSLIT 2>/dev/null`, { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
}
function sleep(ms) { try { execSync(`sleep ${ms / 1000}`); } catch (_) {} }
function clean(s) { return String(s || "").replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ").replace(/&#\d+;/g, " ").replace(/\s+/g, " ").trim(); }
const toks = (c) => new Set(String(c || "").split(" ").filter((w) => w.length >= 3));
function sim(a, b) { if (!a.size || !b.size) return 0; let i = 0; for (const w of b) if (a.has(w)) i++; const j = i / (a.size + b.size - i); return Math.max(i === b.size ? 0.9 : 0, j); }

function parseCard(html) {
  const h1 = (html.match(/<h1[^>]*>([^<]*)<\/h1>/i) || [])[1] || "";
  let name = clean(h1).replace(/^Описание и стоимость монеты\s*/i, "").trim();
  if (!name) { const t = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || ""; name = clean(t).replace(/^Монета\s*/i, "").replace(/\s*цена в каталоге.*/i, "").trim(); }
  const ym = html.match(/год выпуска[^«]*«(\d{4})»/i) || html.match(/«(\d{4})»/) || html.match(/\b(19\d{2}|20\d{2})\b/);
  const year = ym ? parseInt(ym[1], 10) : null;
  let mint = null;
  const mm = html.match(/Монетный двор[:\s]*<\/[^>]*>\s*<[^>]*>([^<]{1,30})</i) || html.match(/\b(ЛМД|ММД|СПМД)\b/);
  if (mm) { mint = clean(mm[1]); if (!/[A-ZА-ЯЁ]/.test(mint)) mint = null; }
  return { name, year, mint };
}

async function scrapeSkeleton() {
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS coin_type_era_key ON coin_type(era, type_key) WHERE era IS NOT NULL`);
  const have = await pool.query("SELECT count(*) c FROM coin_type WHERE era='ussr' AND source='fcoins_ussr'");
  if (parseInt(have.rows[0].c, 10) > 100) { console.log(`skeleton fcoins_ussr уже есть (${have.rows[0].c}), скрейп пропускаю`); return; }
  await pool.query("DELETE FROM coin_type WHERE era='ussr'");
  // фаза1: id карточек по страницам
  const ids = new Set();
  let empty = 0;
  for (let p = 1; p <= 20; p++) {
    const html = curl(`https://www.fcoins.ru/catalogussrub.asp?pagenom=${p}`);
    const found = [...new Set([...html.matchAll(/catalogussrub(\d+)\.asp/gi)].map((m) => m[1]))];
    const before = ids.size;
    found.forEach((x) => ids.add(x));
    if (ids.size === before) { if (++empty >= 2) break; } else empty = 0;
    sleep(150);
  }
  console.log(`USSR: ${ids.size} карточек`);
  // фаза2: карточки -> coin_type
  let ok = 0;
  for (const id of ids) {
    try {
      const c = parseCard(curl(`https://www.fcoins.ru/catalog/catalogussrub/catalogussrub${id}.asp`));
      if (!c.name) continue;
      const denom = N.denomination(c.name);
      const theme = N.stripNominal(c.name);
      const core = N.core(theme);
      const spec = N.specFlag(c.name);
      const tk = N.typeKey({ denomValue: denom.value, year: c.year, mint: c.mint, themeCore: core, spec });
      await pool.query(
        `INSERT INTO coin_type (source, era, name_full, theme_core, denomination_text, denomination_value, year, mint, spec_flag, type_key, country, status)
         VALUES ('fcoins_ussr','ussr',$1,$2,$3,$4,$5,$6,$7,$8,'SU','confirmed')
         ON CONFLICT (era, type_key) WHERE era IS NOT NULL DO NOTHING`,
        [c.name, core, denom.text, denom.value, c.year, c.mint, spec, tk]
      );
      ok++;
    } catch (e) {}
    if (ok % 50 === 0) process.stderr.write(`  card ok=${ok}\r`);
    sleep(120);
  }
  console.log(`USSR типов в coin_type: ${ok}`);
}

async function matchLots() {
  // ЧИСТИМ ДО построения индекса: иначе byKey ссылается на удаляемые auction_ussr-id → FK-violation при повторном прогоне.
  await pool.query("DELETE FROM lot_type_link l USING coin_type ct WHERE l.type_id=ct.id AND ct.era='ussr'");
  await pool.query("DELETE FROM coin_type WHERE era='ussr' AND source='auction_ussr'");
  await pool.query("DELETE FROM review_queue WHERE bucket LIKE 'ussr|%'");
  const t = await pool.query("SELECT id, denomination_value, year, theme_core, spec_flag FROM coin_type WHERE era='ussr'");
  const byKey = new Map(), byDYS = new Map();
  for (const r of t.rows) {
    const dv = r.denomination_value == null ? null : Number(r.denomination_value);
    byKey.set([dv, r.year, r.theme_core, r.spec_flag ? "S" : ""].join("|"), { id: r.id });
    for (const dy of [r.year]) { const k = [dv, dy, r.spec_flag ? "S" : ""].join("|"); if (!byDYS.has(k)) byDYS.set(k, []); byDYS.get(k).push({ id: r.id, tk: toks(r.theme_core) }); }
  }
  const q = await pool.query(
    `SELECT id, year, condition, coin_description d FROM auction_lots WHERE category=$1 AND year BETWEEN 1961 AND 1992 AND coin_description IS NOT NULL AND (auction_end_date IS NULL OR auction_end_date < now())`,
    [CAT_CATEGORY]
  );
  const st = { total: q.rows.length, exact: 0, fuzzy: 0, selfbuilt: 0, skip: 0 };
  const links = [];
  const selfKey = new Map();      // key -> {denomText, denomValue, year, core, spec, name}
  const selfLots = [];            // {lot, key, grade}
  for (const r of q.rows) {
    if (N.isExcluded(r.d)) { st.skip++; continue; }
    const cn = r.d.match(/^(.+?)(?=\s*\d{4}\s*г)/); if (!cn) { st.skip++; continue; }
    const name = cn[1].trim(); const denom = N.denomination(name);
    if (denom.value == null) { st.skip++; continue; }
    const theme = N.stripNominal(name), core = N.core(theme); if (!core) { st.skip++; continue; }
    const spec = N.specFlag(r.d);
    const hit = byKey.get([denom.value, r.year, core, spec ? "S" : ""].join("|"));
    if (hit) { links.push([r.id, hit.id, r.condition, "exact_core", 1.0]); st.exact++; continue; }
    const ourT = toks(core); const cand = [];
    for (const dy of [r.year, r.year - 1, r.year + 1]) for (const c of byDYS.get([denom.value, dy, spec ? "S" : ""].join("|")) || []) cand.push({ id: c.id, sc: sim(ourT, c.tk) });
    cand.sort((a, b) => b.sc - a.sc);
    const strong = cand.filter((c) => c.sc >= 0.6);
    if (strong.length && (strong.length === 1 || strong[0].sc - strong[1].sc >= 0.2)) { links.push([r.id, strong[0].id, r.condition, "fuzzy", +strong[0].sc.toFixed(2)]); st.fuzzy++; continue; }
    // САМО-СБОРКА: чистая тема -> свой тип (fcoins catalogussrub неполон)
    const k = [denom.value, r.year, core, spec ? "S" : ""].join("|");
    if (!selfKey.has(k)) selfKey.set(k, { denomText: denom.text, denomValue: denom.value, year: r.year, core, spec, name: denom.text + ". " + theme });
    selfLots.push({ lot: r.id, key: k, grade: r.condition });
    st.selfbuilt++;
  }
  // вставляем само-собранные типы СССР
  const selfArr = [...selfKey.entries()];
  for (let i = 0; i < selfArr.length; i += 800) {
    const ch = selfArr.slice(i, i + 800), nm = [], tc = [], dt = [], dv = [], yr = [], sp = [], tk = [];
    for (const [key, v] of ch) { nm.push(v.name); tc.push(v.core); dt.push(v.denomText); dv.push(v.denomValue); yr.push(v.year); sp.push(v.spec); tk.push(key); }
    await pool.query(`INSERT INTO coin_type (source,era,name_full,theme_core,denomination_text,denomination_value,year,spec_flag,type_key,country,status)
      SELECT 'auction_ussr','ussr',n,c,dtx,dval,y,s,k,'SU','confirmed'
      FROM unnest($1::text[],$2::text[],$3::text[],$4::numeric[],$5::int[],$6::bool[],$7::text[]) AS u(n,c,dtx,dval,y,s,k)
      ON CONFLICT (era,type_key) WHERE era IS NOT NULL DO NOTHING`, [nm, tc, dt, dv, yr, sp, tk]);
  }
  // карта key->id для само-собранных, привязываем их лоты
  const sid = await pool.query("SELECT id, type_key FROM coin_type WHERE era='ussr' AND source='auction_ussr'");
  const id4 = new Map(sid.rows.map((r) => [r.type_key, r.id]));
  for (const l of selfLots) { const tid = id4.get(l.key); if (tid) links.push([l.lot, tid, l.grade, "structural", 1.0]); }
  for (let i = 0; i < links.length; i += 1000) {
    const ch = links.slice(i, i + 1000), lo = [], ty = [], gr = [], me = [], cf = [];
    for (const x of ch) { lo.push(x[0]); ty.push(x[1]); gr.push(x[2]); me.push(x[3]); cf.push(x[4]); }
    await pool.query(`INSERT INTO lot_type_link (lot_id,type_id,grade,match_method,match_confidence)
      SELECT * FROM unnest($1::int[],$2::int[],$3::text[],$4::text[],$5::numeric[])
      ON CONFLICT (lot_id) DO UPDATE SET type_id=EXCLUDED.type_id, grade=EXCLUDED.grade, match_method=EXCLUDED.match_method, match_confidence=EXCLUDED.match_confidence`, [lo, ty, gr, me, cf]);
  }
  const linked = st.exact + st.fuzzy + st.selfbuilt;
  const c = await pool.query("SELECT count(*) c, count(*) FILTER (WHERE source='fcoins_ussr') f, count(*) FILTER (WHERE source='auction_ussr') s FROM coin_type WHERE era='ussr'");
  console.log("=========== СССР (юбилейные/памятные) ===========");
  console.log(`лотов (1961-1992): ${st.total}, пропущено(ходячка/без темы): ${st.skip}`);
  console.log(`привязано: ${linked} (${Math.round(100 * linked / st.total)}%) = exact ${st.exact} + fuzzy ${st.fuzzy} + self-built ${st.selfbuilt}`);
  console.log(`типов СССР: ${c.rows[0].c} (fcoins ${c.rows[0].f} + само-сборка ${c.rows[0].s})`);
}

(async () => {
  await scrapeSkeleton();
  await matchLots();
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
