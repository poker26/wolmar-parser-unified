/**
 * Каталог монет — СКЕЛЕТ из ЦБ РФ (официальный источник, 1992-2026).
 * Фаза 1: листинг по годам (UniDbQuery, GET) -> cat_num'ы.
 * Фаза 2: статичная карточка ShowCoins -> офиц. имя + номинал + двор + металл/масса/тираж.
 * Заменяет fcoins-скелет. Запуск: node catalog/build-skeleton-cbr.js
 */
const { execSync } = require("child_process");
const { pool } = require("./db");
const N = require("./normalize");

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
const BASE = "https://www.cbr.ru/cash_circulation/memorable_coins/coins_base/";
const COMMON =
  "--data-urlencode UniDbQuery.Posted=True --data-urlencode UniDbQuery.nominal=-1 " +
  "--data-urlencode UniDbQuery.serie_id=0 --data-urlencode UniDbQuery.metal_id=0 " +
  "--data-urlencode UniDbQuery.tab=1 --data-urlencode UniDbQuery.page=1 " +
  "--data-urlencode UniDbQuery.sort=99 --data-urlencode UniDbQuery.sort_direction=down";

function curlGet(url) {
  return execSync(`curl -s -A "${UA}" "${url}"`, { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
}
function listYear(y) {
  const out = execSync(`curl -s -A "${UA}" -G "${BASE}" ${COMMON} --data-urlencode UniDbQuery.year=${y}`, { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  return [...new Set([...out.matchAll(/cat_num=([0-9-]+)/gi)].map((m) => m[1]))];
}
function sleep(ms) { try { execSync(`sleep ${ms / 1000}`); } catch (_) {} }
function clean(s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ").replace(/&#\d+;/g, " ").replace(/\s+/g, " ").trim();
}

function parseCard(html, catNum, year) {
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
  const name = title.replace(/\s*\|\s*Банк России.*$/i, "").trim();
  const fields = {};
  const re = /characteristic_denomenation[^>]*>([^<]*)<\/div>\s*<div class="characteristic_value[^>]*>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html))) fields[clean(m[1])] = clean(m[2]);
  const denomText = fields["Номинал"] || null;
  let mint = null;
  const cm = html.match(/Чеканка:[^.(]*\(([^)]+)\)/i);
  if (cm) mint = cm[1].trim();
  else { const a = html.match(/\b(СПМД|ММД|ЛМД)\b/); if (a) mint = a[1]; }
  const denom = N.denomination(denomText || name);
  const themeCore = N.core(name);
  const spec = N.specFlag(name) || /спец/i.test(fields["Качество"] || "");
  const mass = (String(fields["Масса общая, г"] || "").match(/[\d.,]+/) || [])[0];
  const dia = (String(fields["Диаметр, мм"] || "").match(/[\d.,]+/) || [])[0];
  const mintage = (String(fields["Тираж, шт."] || "").replace(/\s/g, "").match(/\d+/) || [])[0];
  return {
    cbr_cat_num: catNum,
    name_full: denomText ? `${denomText}. ${name}` : name,
    theme_core: themeCore,
    denomination_text: denomText,
    denomination_value: denom.value,
    year,
    mint,
    quality: fields["Качество"] || null,
    metal: fields["Металл, проба"] || null,
    mass: mass ? parseFloat(mass.replace(",", ".")) : null,
    diameter: dia ? parseFloat(dia.replace(",", ".")) : null,
    mintage: mintage ? parseInt(mintage, 10) : null,
    spec_flag: spec,
    type_key: N.typeKey({ denomValue: denom.value, year, mint, themeCore, spec }),
  };
}

async function ensureColumns() {
  await pool.query(`ALTER TABLE coin_type
    ADD COLUMN IF NOT EXISTS metal TEXT,
    ADD COLUMN IF NOT EXISTS mass NUMERIC,
    ADD COLUMN IF NOT EXISTS diameter NUMERIC,
    ADD COLUMN IF NOT EXISTS mintage BIGINT`);
}

async function upsert(t) {
  await pool.query(
    `INSERT INTO coin_type
      (source, cbr_cat_num, name_full, theme_core, denomination_text, denomination_value,
       year, mint, quality, spec_flag, type_key, metal, mass, diameter, mintage, status, updated_at)
     VALUES ('cbr',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'confirmed',now())
     ON CONFLICT (source, cbr_cat_num) WHERE cbr_cat_num IS NOT NULL
     DO UPDATE SET name_full=EXCLUDED.name_full, theme_core=EXCLUDED.theme_core,
       denomination_text=EXCLUDED.denomination_text, denomination_value=EXCLUDED.denomination_value,
       year=EXCLUDED.year, mint=EXCLUDED.mint, quality=EXCLUDED.quality,
       spec_flag=EXCLUDED.spec_flag, type_key=EXCLUDED.type_key, metal=EXCLUDED.metal,
       mass=EXCLUDED.mass, diameter=EXCLUDED.diameter, mintage=EXCLUDED.mintage, updated_at=now()`,
    [t.cbr_cat_num, t.name_full, t.theme_core, t.denomination_text, t.denomination_value,
     t.year, t.mint, t.quality, t.spec_flag, t.type_key, t.metal, t.mass, t.diameter, t.mintage]
  );
}

(async () => {
  // фаза 1: годы -> cat_num'ы
  const jobs = [];
  for (let y = 1992; y <= 2026; y++) {
    try { for (const c of listYear(y)) jobs.push({ cat: c, year: y }); } catch (e) { console.error("year", y, e.message); }
    sleep(120);
  }
  console.log(`фаза1: ${jobs.length} карточек к загрузке`);

  // Пересборки каталога здесь НЕТ и быть не должно: скрипт решает частную задачу - загрузить
  // карточки памятных монет ЦБ. Раньше он начинался с TRUNCATE coin_type ... CASCADE, оставшегося
  // с тех времён, когда каталог состоял из одного этого скелета. 29.08.2026 его запустили ради
  // обновления карточек и потеряли 99 483 типа и 462 тысячи связей. Запись идёт upsert-ом по
  // (source, cbr_cat_num), так что повторный запуск и так безопасен.
  await ensureColumns();

  // фаза 2: карточки
  let ok = 0, err = 0;
  for (let i = 0; i < jobs.length; i++) {
    const { cat, year } = jobs[i];
    try {
      const html = curlGet(`${BASE}ShowCoins/?cat_num=${encodeURIComponent(cat)}`);
      const t = parseCard(html, cat, year);
      if (!t.name_full || !t.theme_core) { err++; }
      else { await upsert(t); ok++; }
    } catch (e) { err++; }
    if (i % 100 === 0) process.stderr.write(`card ${i}/${jobs.length} ok=${ok} err=${err}\r`);
    sleep(120);
  }
  const c = await pool.query("SELECT count(*) c, count(DISTINCT year) y, min(year) mn, max(year) mx, count(*) FILTER (WHERE mint IS NULL) nomint FROM coin_type");
  console.log(`\nDONE cbr. coin_type=${c.rows[0].c}, years=${c.rows[0].y} (${c.rows[0].mn}..${c.rows[0].mx}), mint=null: ${c.rows[0].nomint}. ok=${ok} err=${err}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
