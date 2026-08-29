/**
 * Слияние иностранных типов, описывающих одну монету.
 *
 * Два разных класса дублей, и обходятся они по-разному.
 *
 * 1. ОДИН номер Краузе у одной страны. Пять томов разбирались по отдельности, и один и тот же тип
 *    попал в каталог дважды. Сливаем только при полном совпадении: страна, номер, номинал и годы —
 *    иначе схлопнутся записи, покрывающие разные периоды.
 * 2. Типы, собранные из ОПИСАНИЙ аукциона (source='auction_foreign'): у них нет номера Краузе, а
 *    имя взято из заголовка лота, поэтому одна монета лежит по нескольку раз с разной формой слова
 *    — «10 сен. JAPAN 1909» и «10 сенов. JAPAN 1909». Матчер их не различает и воздерживается.
 *
 * Справочники Calicó и Myntboken не трогаем: там разные записи на один номинал и год — это
 * настоящие разновидности, а не дубли.
 *
 *   node catalog/dedupe-foreign-types.js [--apply]
 */
const { pool } = require("./db");

const NOISE = /^(состоян|сохран|отличн|хорош|очень|почти|блеск|патин|слаб|ngs|ngc|pcgs|hgc|ннр|топ|грейд|редк|нечаст|оригинал|копия|краузе|krause)$/i;
const VARIETY = /(перечекан|новодел|пробн|proof|пруф|копия|реплик|муляж|подделк|essai|pattern|restrike|рестрайк)/i;

const sig = (name) => {
  const n = String(name || "").toLowerCase();
  const i = n.indexOf(". ");
  const tail = i < 0 ? "" : n.slice(i + 2);
  const words = (tail.match(/[а-яёa-z]{3,}/g) || []).filter((w) => !NOISE.test(w));
  return [...new Set(words)].sort().join(" ");
};

// Подпись страны в имени типа: «8 ESCUDOS. MENDOZA» → «mendoza». Провинции и колонии в справочнике
// нумеруются отдельно от метрополии, поэтому один номер у РАЗНЫХ подписей — это разные монеты.
// Сливаем, только если одна подпись является вариантом написания другой: «KOREA-NORTH» и
// «NORTH KOREA», «ANGOLA» и «ANGOLA (PORTUGUESE COLONY)».
const labelWords = (name) => {
  const n = String(name || "");
  const i = n.indexOf(". ");
  const tail = (i < 0 ? n : n.slice(i + 2)).split(" — ")[0];
  return new Set((tail.toLowerCase().match(/[a-zа-яё]{2,}/g) || []));
};
const labelFits = (a, b) => {
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  if (!s.size) return false;
  for (const w of s) if (!l.has(w)) return false;
  return true;
};

async function mergeGroups(groups, apply, label) {
  let merged = 0, moved = 0, skipped = 0;
  const ex = [];
  for (const g of groups) {
    g.sort((a, b) => b.links - a.links || String(a.name_full).length - String(b.name_full).length || a.id - b.id);
    const keep = g[0];
    if (label.startsWith("один")) {
      const anchor = labelWords(keep.name_full);
      const fit = g.filter((x, i) => i === 0 || labelFits(anchor, labelWords(x.name_full)));
      skipped += g.length - fit.length;
      if (fit.length < 2) continue;
      g.length = 0; g.push(...fit);
    }
    if (ex.length < 5) ex.push(`«${(keep.name_full || "").slice(0, 42)}» ← ${g.slice(1).map((x) => (x.name_full || "").slice(0, 30)).join(" · ")}`);
    for (const lose of g.slice(1)) {
      if (apply) {
        const r = await pool.query(
          `UPDATE lot_type_link l SET type_id=$2 WHERE l.type_id=$1
             AND NOT EXISTS (SELECT 1 FROM lot_type_link x WHERE x.lot_id=l.lot_id AND x.type_id=$2)`,
          [lose.id, keep.id]);
        moved += r.rowCount;
        await pool.query("DELETE FROM lot_type_link WHERE type_id=$1", [lose.id]);
        await pool.query(
          `UPDATE coin_type k SET
             image_url=COALESCE(k.image_url, l.image_url), image_url_rev=COALESCE(k.image_url_rev, l.image_url_rev),
             ref_prices=COALESCE(k.ref_prices, l.ref_prices), theme_ru=COALESCE(NULLIF(k.theme_ru,''), l.theme_ru),
             km_number=COALESCE(k.km_number, l.km_number), metal=COALESCE(k.metal, l.metal),
             mass=COALESCE(k.mass, l.mass), updated_at=now()
           FROM coin_type l WHERE k.id=$2 AND l.id=$1`, [lose.id, keep.id]);
        await pool.query("DELETE FROM coin_type WHERE id=$1", [lose.id]);
      } else moved += lose.links;
      merged++;
    }
  }
  console.log(`\n${label}: групп ${groups.length} · лишних типов ${merged} · связей ${apply ? "перенесено" : "затронуто"} ${moved}`);
  for (const e of ex) console.log("  ", e);
  return merged;
}

(async () => {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "(APPLY)" : "(сухой прогон)");

  // 1. одинаковый номер Краузе
  const km = (await pool.query(
    `SELECT id, name_full, country, km_number, denomination_text, year_start, year_end,
            (SELECT count(*)::int FROM lot_type_link l WHERE l.type_id=coin_type.id) links
       FROM coin_type WHERE era='foreign' AND km_number IS NOT NULL ORDER BY id`)).rows;
  const byKm = new Map();
  for (const r of km) {
    if (VARIETY.test(String(r.name_full || ""))) continue;
    const k = [r.country, r.km_number, r.denomination_text, r.year_start, r.year_end].join("|");
    if (!byKm.has(k)) byKm.set(k, []);
    byKm.get(k).push(r);
  }
  await mergeGroups([...byKm.values()].filter((g) => g.length > 1), apply, "один номер Краузе");

  // 2. типы из описаний аукциона
  const au = (await pool.query(
    `SELECT id, name_full, country, year, denomination_text,
            (SELECT count(*)::int FROM lot_type_link l WHERE l.type_id=coin_type.id) links
       FROM coin_type WHERE era='foreign' AND source='auction_foreign' AND year IS NOT NULL ORDER BY id`)).rows;
  const byAu = new Map();
  for (const r of au) {
    if (VARIETY.test(String(r.name_full || ""))) continue;
    const k = [r.country, r.year, sig(r.name_full)].join("|");
    if (!byAu.has(k)) byAu.set(k, []);
    byAu.get(k).push(r);
  }
  // Номинал сверяем отдельно: «10 сен» и «10 сенов» это одна монета, а «10 сен» и «20 сен» — нет.
  const groups = [];
  for (const g of byAu.values()) {
    if (g.length < 2) continue;
    const byNum = new Map();
    for (const r of g) {
      const n = (String(r.denomination_text || "").match(/[\d/.,]+/) || [""])[0];
      const unit = (String(r.denomination_text || "").match(/[а-яёa-z]{3,}/i) || [""])[0].toLowerCase().slice(0, 4);
      const k = n + "|" + unit;
      if (!byNum.has(k)) byNum.set(k, []);
      byNum.get(k).push(r);
    }
    for (const gg of byNum.values()) if (gg.length > 1) groups.push(gg);
  }
  await mergeGroups(groups, apply, "типы из описаний аукциона");
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
