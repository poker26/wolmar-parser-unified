/**
 * Каталог монет — скрейпер СКЕЛЕТА из fcoins catalogub (памятные/юбилейные).
 * Источник официальных имён ЦБ + номеров ЦБ. Проходы НЕ берём (они наши).
 * Запуск: node catalog/build-skeleton.js [maxPages]
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { pool } = require("./db");
const N = require("./normalize");

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36";

function fetchPage(n) {
  const url = `https://www.fcoins.ru/catalogub.asp?pagenom=${n}`;
  return execSync(`curl -s -A "${UA}" "${url}" | iconv -f CP1251 -t UTF-8//TRANSLIT 2>/dev/null`, {
    maxBuffer: 64 * 1024 * 1024,
  }).toString("utf8");
}
function sleep(ms) { try { execSync(`sleep ${ms / 1000}`); } catch (_) {} }

// Парс строки листинга: имя cat_num дата двор качество проходы цена.
// Маркер @@CARDnnnnn@@ внедряем ДО strip-тегов, чтобы сохранить id карточки.
function parseRows(html) {
  const text = html
    .replace(/catalogcb(\d+)\.asp/gi, " @@CARD$1@@ ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ");
  const re = /(\d{4}-\d{4}(?:-\d+)?)\s+(\d{2})\.(\d{2})\.(\d{4})\s+([А-ЯЁA-Z]{2,6})\s+(\S+)\s+(\d+)\s+(\d+)/g;
  const out = [];
  let m, lastEnd = 0;
  while ((m = re.exec(text))) {
    const gap = text.slice(lastEnd, m.index);
    lastEnd = re.lastIndex;
    const cardId = (gap.match(/@@CARD(\d+)@@/) || [])[1] || null;
    const nm = gap.match(/\d+\s*(?:рубл|копе)[а-яё]*\.?.*$/i);
    let name = (nm ? nm[0] : gap)
      .replace(/@@CARD\d+@@/g, " ")
      .replace(/сери[а-яё]*\s*:.*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!/^\d+\s*(рубл|копе)/i.test(name)) continue;
    if (N.isExcluded(name)) continue;
    const denom = N.denomination(name);
    const theme = N.stripNominal(name);
    const themeCore = N.core(theme);
    if (!themeCore) continue;
    const spec = N.specFlag(name);
    out.push({
      source_card_id: cardId,
      cbr_cat_num: m[1],
      issue_date: `${m[4]}-${m[3]}-${m[2]}`,
      year: parseInt(m[4], 10),
      mint: m[5],
      quality: m[6],
      fcoins_passes: parseInt(m[7], 10),
      fcoins_price: parseInt(m[8], 10),
      name_full: name,
      denomination_text: denom.text,
      denomination_value: denom.value,
      theme_core: themeCore,
      spec_flag: spec,
      type_key: N.typeKey({ denomValue: denom.value, year: parseInt(m[4], 10), mint: m[5], themeCore, spec }),
    });
  }
  return out;
}

async function ensureSchema() {
  const ddl = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(ddl);
}

async function upsert(t) {
  await pool.query(
    `INSERT INTO coin_type
      (source, source_card_id, cbr_cat_num, name_full, theme_core, denomination_text,
       denomination_value, year, issue_date, mint, quality, spec_flag, type_key,
       fcoins_passes, fcoins_price, status, updated_at)
     VALUES ('fcoins',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',now())
     ON CONFLICT (source, cbr_cat_num) WHERE cbr_cat_num IS NOT NULL
     DO UPDATE SET name_full=EXCLUDED.name_full, theme_core=EXCLUDED.theme_core,
       denomination_text=EXCLUDED.denomination_text, denomination_value=EXCLUDED.denomination_value,
       year=EXCLUDED.year, issue_date=EXCLUDED.issue_date, mint=EXCLUDED.mint,
       quality=EXCLUDED.quality, spec_flag=EXCLUDED.spec_flag, type_key=EXCLUDED.type_key,
       fcoins_passes=EXCLUDED.fcoins_passes, fcoins_price=EXCLUDED.fcoins_price,
       source_card_id=EXCLUDED.source_card_id, updated_at=now()`,
    [t.source_card_id, t.cbr_cat_num, t.name_full, t.theme_core, t.denomination_text,
     t.denomination_value, t.year, t.issue_date, t.mint, t.quality, t.spec_flag, t.type_key,
     t.fcoins_passes, t.fcoins_price]
  );
}

(async () => {
  const maxPages = parseInt(process.argv[2], 10) || 60;
  await ensureSchema();
  console.log("schema ok");
  let total = 0, empty = 0;
  for (let n = 1; n <= maxPages; n++) {
    let rows = [];
    try { rows = parseRows(fetchPage(n)); } catch (e) { console.error("page", n, "ERR", e.message); }
    if (rows.length === 0) { if (++empty >= 2) break; } else empty = 0;
    for (const r of rows) { try { await upsert(r); total++; } catch (e) { console.error("upsert", r.cbr_cat_num, e.message); } }
    process.stderr.write(`page ${n}: ${rows.length} (upserted total ${total})\r`);
    sleep(250);
  }
  const c = await pool.query("SELECT count(*) c, count(DISTINCT year) yrs, min(year) miny, max(year) maxy FROM coin_type");
  console.log(`\nDONE. coin_type rows=${c.rows[0].c}, years=${c.rows[0].yrs} (${c.rows[0].miny}..${c.rows[0].maxy})`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
