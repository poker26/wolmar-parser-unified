/**
 * Каталог ИНОСТРАННЫХ — KM#-спайн, АНГЛИЙСКИЙ канон страны (Вариант A, v3).
 * Канон страны = английский (Краузе). km-типы для ВСЕХ стран coin_ref (с канонизацией вариантов
 * China/US/Germany). Линковка аукционных лотов: RU-страна → numis_country_map(ru→en) → канон →
 * матч (страна+номинал-значение+год, дизамбиг металл+тема_ru). Несматченные лоты → self (англ. если есть карта, иначе RU).
 * Запуск: node catalog/build-foreign-km.js
 */
const { pool } = require("./db");
const F = require("./foreign");

const CAT = "Монеты иностранные";
// канонизация EN-вариантов coin_ref → один канон
const EN_CANON = {
  "CHINA, PEOPLE'S REPUBLIC": "CHINA", "CHINA, PEOPLES REPUBLIC": "CHINA",
  "UNITED STATES OF AMERICA": "UNITED STATES", "GERMANY - FEDERAL REPUBLIC": "GERMANY",
  "GERMANY - DEMOCRATIC REPUBLIC": "GERMANY", "DEUTSCHE DEMOKRATISCHE REPUBLIK": "GERMANY",
  "REPUBLIQUE DEMOCRATIQUE DU CONGO": "CONGO, DEMOCRATIC REPUBLIC", "УКРАЇНА": "UKRAINE",
  "БЕЛАРУСЬ": "BELARUS", "SLOVENSKÁ REPUBLIKA": "SLOVAKIA", "RÉPUBLICA DE GUINEA ECUATORIAL": "EQUATORIAL GUINEA",
  "VIET NAM": "VIET NAM", "NIUE ISLAND": "NIUE", "REPUBLIC OF PALAU": "PALAU", "REPUBLIC OF LIBERIA": "LIBERIA",
  "SOMALI REPUBLIC": "SOMALIA", "UNITED KINGDOM": "GREAT BRITAIN", "OMANI RIAL": "OMAN",
};
const canon = (s) => EN_CANON[s] || s;
const METAL_KW = { Ag:"silver", Au:"gold", Pt:"platin", Pd:"pallad", "Cu-Ni":"nickel", Cu:"copper", Ni:"nickel",
  Br:"bronze", Al:"alumin", Fe:"steel", St:"steel", Zn:"zinc", Sn:"tin", Bm:"metallic", Bil:"billon" };
const val = (s) => {
  const str = String(s || "").trim();
  const m = str.match(/^\s*(\d+(?:[.,/]\d+)?)/);
  if (m) return m[1].replace(",", ".");
  if (/^(half|½|пол)/i.test(str)) return "0.5";
  if (/^(quarter|¼|четверть)/i.test(str)) return "0.25";
  if (/[a-zа-яё]/i.test(str)) return "1";
  return null;
};
const yo = (s) => String(s || "").toLowerCase();

async function ensureColumns() {
  await pool.query(`ALTER TABLE coin_type
    ADD COLUMN IF NOT EXISTS km_number TEXT, ADD COLUMN IF NOT EXISTS canonical_name TEXT, ADD COLUMN IF NOT EXISTS ruler TEXT,
    ADD COLUMN IF NOT EXISTS krause_subject TEXT, ADD COLUMN IF NOT EXISTS krause_design TEXT, ADD COLUMN IF NOT EXISTS ref_issues JSONB,
    ADD COLUMN IF NOT EXISTS mintage BIGINT, ADD COLUMN IF NOT EXISTS ref_source TEXT, ADD COLUMN IF NOT EXISTS year_start INT,
    ADD COLUMN IF NOT EXISTS year_end INT, ADD COLUMN IF NOT EXISTS issuer TEXT, ADD COLUMN IF NOT EXISTS metal TEXT,
    ADD COLUMN IF NOT EXISTS theme_core TEXT, ADD COLUMN IF NOT EXISTS composition TEXT, ADD COLUMN IF NOT EXISTS theme_ru TEXT,
    ADD COLUMN IF NOT EXISTS ref_pdf_src TEXT, ADD COLUMN IF NOT EXISTS ref_pdf_page INT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS coin_type_era_key ON coin_type(era, type_key) WHERE era IS NOT NULL`);
}

(async () => {
  await ensureColumns();
  // RU→EN карта стран (LLM)
  const cm = await pool.query("SELECT ru, en FROM numis_country_map WHERE en IS NOT NULL");
  const ru2en = new Map(cm.rows.map((r) => [r.ru, canon(r.en)]));
  console.log("RU→EN карта:", ru2en.size);

  await pool.query("DELETE FROM coin_type WHERE era='foreign'");

  // (1) KM#-типы из ВСЕХ coin_ref (английский канон)
  const cr = await pool.query(
    `SELECT cr.km, cr.country_norm, cr.denomination, cr.ruler, cr.subject, cr.design, cr.composition,
            cr.weight_g, cr.diameter_mm, cr.issues, cr.ref_src, cr.ref_page, COALESCE(ts.ru, td.ru) theme_ru
     FROM coin_ref cr LEFT JOIN numis_theme_tr ts ON ts.en=cr.subject LEFT JOIN numis_theme_tr td ON td.en=cr.design
     WHERE cr.source='scwc' AND cr.km IS NOT NULL`);
  // мердж по (canon страна, km): схлопывает варианты CHINA/US/Germany
  const byKey = new Map();
  for (const r of cr.rows) {
    const c = canon(r.country_norm);
    const key = `${c}|${r.km}`;
    if (!byKey.has(key)) byKey.set(key, { country: c, km: String(r.km), denom: r.denomination, ruler: r.ruler,
      subject: r.subject, design: r.design, theme_ru: r.theme_ru, comp: r.composition, w: r.weight_g, dia: r.diameter_mm,
      ref_src: r.ref_src, ref_page: r.ref_page, issues: [] });
    const t = byKey.get(key);
    for (const i of (r.issues || [])) t.issues.push(i);
    if (!t.theme_ru && r.theme_ru) t.theme_ru = r.theme_ru;
  }
  const kmTypes = [...byKey.values()].map((t) => {
    const yrs = t.issues.map((i) => parseInt(i.year, 10)).filter((y) => Number.isFinite(y) && y >= 1500 && y <= 2100);
    const theme = t.theme_ru || null;
    return { ...t, type_key: `km|${t.country}|${t.km}`,
      ys: yrs.length ? Math.min(...yrs) : null, ye: yrs.length ? Math.max(...yrs) : null,
      name_full: `${t.denom || ""}. ${t.country}${theme ? " — " + theme : ""}`.trim() };
  });
  for (let i = 0; i < kmTypes.length; i += 500) {
    const ch = kmTypes.slice(i, i + 500);
    const c = { nf:[],co:[],km:[],dt:[],rl:[],su:[],de:[],cm:[],ys:[],ye:[],ri:[],tk:[],tc:[],tr:[],rs:[],rp:[] };
    for (const t of ch) { c.nf.push(t.name_full); c.co.push(t.country); c.km.push(t.km); c.dt.push(t.denom);
      c.rl.push(t.ruler); c.su.push(t.subject); c.de.push(t.design); c.cm.push(t.comp); c.ys.push(t.ys); c.ye.push(t.ye);
      c.ri.push(JSON.stringify(t.issues)); c.tk.push(t.type_key); c.tc.push(t.theme_ru || t.subject || t.design || ""); c.tr.push(t.theme_ru || null);
      c.rs.push(t.ref_src || null); c.rp.push(Number.isFinite(t.ref_page) ? t.ref_page : null); }
    await pool.query(
      `INSERT INTO coin_type (source,era,status,name_full,country,km_number,denomination_text,ruler,krause_subject,krause_design,composition,year_start,year_end,ref_issues,type_key,theme_core,theme_ru,ref_pdf_src,ref_pdf_page,ref_source,year)
       SELECT 'scwc','foreign','catalog',nf,co,km,dt,rl,su,de,cm,ys,ye,CAST(ri AS jsonb),tk,tc,tr,rs,rp,'scwc',ye
       FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::int[],$10::int[],$11::text[],$12::text[],$13::text[],$14::text[],$15::text[],$16::int[]) AS u(nf,co,km,dt,rl,su,de,cm,ys,ye,ri,tk,tc,tr,rs,rp)
       ON CONFLICT (era,type_key) WHERE era IS NOT NULL DO NOTHING`,
      [c.nf,c.co,c.km,c.dt,c.rl,c.su,c.de,c.cm,c.ys,c.ye,c.ri,c.tk,c.tc,c.tr,c.rs,c.rp]);
  }
  const idr = await pool.query("SELECT id, country, km_number, composition, theme_ru FROM coin_type WHERE era='foreign' AND ref_source='scwc'");
  const compById = new Map(idr.rows.map((r) => [r.id, yo(r.composition)]));
  const themeRuById = new Map(idr.rows.map((r) => [r.id, yo(r.theme_ru)]));
  const id4 = new Map(idr.rows.map((r) => [`${yo(r.country)}|${r.km_number}`, r.id]));
  const STOP = new Set(["года","год","within","circle","value","date","denomination","above","below","left","right","series"]);
  const toks = (s) => new Set(String(s||"").toLowerCase().replace(/[^а-яёa-z0-9 ]/g," ").split(/\s+/).filter((w)=>w.length>=4&&!STOP.has(w)).map((w)=>w.slice(0,5)));
  const overlap = (a,b)=>{let n=0;for(const w of a)if(b.has(w))n++;return n;};
  const kmIdx = new Map();
  for (const t of kmTypes) { const id=id4.get(`${yo(t.country)}|${t.km}`); if(!id) continue; const v=val(t.denom); if(!v) continue;
    for (const i of t.issues){ const y=parseInt(i.year,10); if(!Number.isFinite(y)) continue; const k=`${yo(t.country)}|${v}|${y}`; if(!kmIdx.has(k)) kmIdx.set(k,[]); if(!kmIdx.get(k).includes(id)) kmIdx.get(k).push(id);} }

  // issuer-aware: немецкие/итальянские государства живут в Краузе ОТДЕЛЬНЫМИ странами (PRUSSIA, BAVARIA…),
  // а наш лот несёт верхнюю страну (Германия/Италия) + issuer (Пруссия). Разворачиваем issuer → реальные country из kmTypes по паттерну.
  const ISSUER_PAT = [
    ["пруссия", /^PRUSS|PREUSS/], ["саксония", /^SAXONY|^SAXE-/], ["бавария", /^BAVARIA|^BAYERN/],
    ["баден", /BADEN/], ["ганновер", /HANN?OVER/], ["тироль", /TYROL|TIROL/], ["вюртемберг", /W[UÜ]RT?TEMBERG/],
    ["франкфурт", /^FRANKFURT/], ["гамбург", /^HAMBURG/], ["неаполь", /^NAPLES|NEAPOL/], ["бремен", /^BREMEN/],
    ["любек", /^L[UÜ]BECK/], ["гессен", /^HESSE/], ["сардиния", /SARDINIA/], ["анхальт", /^ANHALT/],
    ["мекленбург", /^MECKLENBURG/], ["парма", /^PARMA/], ["венеция", /^VENICE|VENETIA/], ["сицилия", /SICIL/],
    ["тоскана", /TUSCANY/], ["брауншвейг", /BRUNSWICK|BRAUNSCHWEIG/], ["нюрнберг", /N[UÜ]RNBERG|NUREMBERG/],
    ["вюрцбург", /W[UÜ]RZBURG/], ["шлезвиг", /SCHLESWIG/], ["саксен", /^SAXE-/], ["вальдек", /WALDECK/],
  ];
  const allCC = [...new Set(kmTypes.map((t) => t.country))];
  const issuer2cc = new Map();
  for (const [iss, pat] of ISSUER_PAT) { const ccs = allCC.filter((c) => pat.test(c)).map(yo); if (ccs.length) issuer2cc.set(iss, ccs); }
  const ccsForIssuer = (issNorm) => { if (!issNorm) return null; for (const [iss, ccs] of issuer2cc) if (issNorm === iss || issNorm.startsWith(iss)) return ccs; return null; };
  console.log("issuer→Краузе-страны:", issuer2cc.size, "паттернов покрыто");

  // (2)+(3) лоты
  const lots = await pool.query(
    `SELECT id, condition, coin_description d FROM auction_lots WHERE category=$1 AND coin_description IS NOT NULL AND (auction_end_date IS NULL OR auction_end_date < now())`, [CAT]);
  const { countrySet, substateSet } = F.deriveSets(lots.rows.map((r) => r.d));
  const linkArr = []; const selfMap = new Map(); const selfLots = [];
  let matched=0, multi=0, self=0, skipped=0;
  for (const r of lots.rows) {
    const p = F.parse(r.d, countrySet, substateSet);
    if (!p || p.excluded || !p.country) { skipped++; continue; }
    const enc = ru2en.get(p.country) || null;     // RU→EN канон
    let done = false;
    if (p.denomValue != null && p.year) {
      let cands = null;
      const issNorm = p.issuer ? p.issuer.toLowerCase().replace(/\s*\(.*$/, "").trim() : null;
      const issCCs = ccsForIssuer(issNorm);
      if (issCCs) {   // государство: матч по странам-эмитентам Краузе (Пруссия→PRUSSIA…)
        const ids = [];
        for (const cc of issCCs) { const arr = kmIdx.get(`${cc}|${p.denomValue}|${p.year}`); if (arr) for (const id of arr) if (!ids.includes(id)) ids.push(id); }
        if (ids.length) cands = ids;
      }
      if (!cands && enc) cands = kmIdx.get(`${yo(enc)}|${p.denomValue}|${p.year}`);
      if (cands && cands.length) {
        let pick = cands;
        if (pick.length>1 && p.metal && METAL_KW[p.metal]) { const kw=METAL_KW[p.metal]; const f=pick.filter((id)=>(compById.get(id)||"").includes(kw)); if(f.length) pick=f; }
        if (pick.length>1 && p.theme) { const lt=toks(p.theme); let best=null,bs=0,tie=false;
          for(const id of pick){const sc=overlap(lt,toks(themeRuById.get(id)));if(sc>bs){bs=sc;best=id;tie=false;}else if(sc===bs&&sc>0)tie=true;}
          if(best&&bs>0&&!tie) pick=[best]; }
        if (pick.length===1){ linkArr.push({lot_id:r.id,type_id:pick[0],grade:r.condition}); matched++; done=true; } else multi++;
      }
    }
    if (!done) {
      const dispCountry = enc || p.country;   // self: англ. если есть карта, иначе RU
      const key = [dispCountry, p.issuer||"?", `${p.denomValue||""} ${p.unit}`.trim(), p.year||"", p.metal||"", (p.theme||"").toLowerCase()].join("|");
      if (!selfMap.has(key)) selfMap.set(key, { ...p, country: dispCountry, type_key: "self|"+key });
      selfLots.push({ id:r.id, key, grade:r.condition });
    }
  }
  const selfArr=[...selfMap.values()];
  for (let i=0;i<selfArr.length;i+=500){ const ch=selfArr.slice(i,i+500); const nf=[],co=[],iss=[],dt=[],yr=[],me=[],tk=[],tc=[];
    for(const p of ch){const theme=p.theme||null;
      nf.push(`${p.denom}. ${p.country}${p.issuer?" ("+p.issuer+")":""}${theme?" — "+theme:""}${p.year?" "+p.year:""}`.trim());
      co.push(p.country); iss.push(p.issuer||null); dt.push(`${p.denomValue||""} ${p.unit}`.trim()); yr.push(p.year||null); me.push(p.metal||null); tk.push(p.type_key); tc.push(theme||"");}
    await pool.query(`INSERT INTO coin_type (source,era,status,name_full,country,issuer,denomination_text,year,metal,type_key,theme_core)
      SELECT 'auction_foreign','foreign','confirmed',nf,co,iss,dt,yr,me,tk,tc FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::int[],$6::text[],$7::text[],$8::text[]) AS u(nf,co,iss,dt,yr,me,tk,tc)
      ON CONFLICT (era,type_key) WHERE era IS NOT NULL DO NOTHING`, [nf,co,iss,dt,yr,me,tk,tc]); }
  const sIdr=await pool.query("SELECT id, type_key FROM coin_type WHERE era='foreign' AND source='auction_foreign'");
  const sId4=new Map(sIdr.rows.map((r)=>[r.type_key,r.id]));
  for(const l of selfLots){ const tid=sId4.get("self|"+l.key); if(tid) linkArr.push({lot_id:l.id,type_id:tid,grade:l.grade}); self++; }
  for(let i=0;i<linkArr.length;i+=1000){ const ch=linkArr.slice(i,i+1000); const lot=[],typ=[],gr=[];
    for(const r of ch){lot.push(r.lot_id);typ.push(r.type_id);gr.push(r.grade);}
    await pool.query(`INSERT INTO lot_type_link (lot_id,type_id,grade,match_method) SELECT lot,typ,gr,'km' FROM unnest($1::int[],$2::int[],$3::text[]) AS u(lot,typ,gr) ON CONFLICT (lot_id) DO UPDATE SET type_id=EXCLUDED.type_id, grade=EXCLUDED.grade`,[lot,typ,gr]); }

  const kmc=(await pool.query("SELECT count(*) c FROM coin_type WHERE era='foreign' AND ref_source='scwc'")).rows[0].c;
  const kmWith=(await pool.query("SELECT count(DISTINCT type_id) c FROM lot_type_link l JOIN coin_type t ON t.id=l.type_id WHERE t.ref_source='scwc'")).rows[0].c;
  const both=(await pool.query("SELECT count(*) c FROM coin_type ct WHERE era='foreign' AND ref_issues IS NOT NULL AND EXISTS(SELECT 1 FROM lot_type_link l WHERE l.type_id=ct.id)")).rows[0].c;
  const sc=(await pool.query("SELECT count(*) c FROM coin_type WHERE era='foreign' AND source='auction_foreign'")).rows[0].c;
  console.log("======= ИНОСТРАННЫЕ KM#-спайн (англ. канон) =======");
  console.log(`лотов: ${lots.rows.length} | сматчено KM#: ${matched} | мульти: ${multi} | self: ${self} | пропущено: ${skipped}`);
  console.log(`KM#-типов: ${kmc} | с проходами: ${kmWith} | ОБЕ цены: ${both} | self-типов: ${sc}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
