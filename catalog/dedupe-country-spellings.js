/**
 * Дубли иностранных типов, разведённые разным написанием страны.
 *
 * Одна страна попала в каталог под двумя именами («China, People's Republic» и «China, Peoples
 * Republic», «Straits Settlement» и «Straits Settlements»), и в меньшем написании лежат те же
 * самые типы: тот же номер Краузе, тот же номинал, те же годы. Матчер видит только одно написание,
 * поэтому вторая половина недостижима, а проходы одной монеты рискуют разъехаться по двум
 * карточкам.
 *
 * Выживает тип с бОльшим числом привязанных лотов (при равенстве — меньший id): к нему
 * переставляются связи проигравшего и переносятся поля, которых у него нет. Дубль удаляется.
 * Пары без двойника НЕ трогаем: это не дубль, а тип, которому нужна своя страна.
 *
 *   node catalog/dedupe-country-spellings.js [--apply]
 */
const { pool } = require("./db");

// Ключ страны: набор слов без служебных, без окончаний множественного числа — тот же принцип,
// по которому матчер сводит написания.
// Слова об устройстве государства («republic», «democratic», «peoples», «federal») НЕ убираем:
// ими различаются разные государства — Тайвань и КНР, ФРГ и ГДР. Первая версия ключа их
// отбрасывала и предлагала слить ФРГ с ГДР, а Тайвань с материковым Китаем.
const cwords = (s) => [...new Set(String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
  .filter((w) => w && !/^(of|the|and)$/.test(w))
  .map((w) => w.replace(/s$/, "")).filter((w) => w.length > 1))].sort().join(" ");

(async () => {
  const apply = process.argv.includes("--apply");
  const countries = (await pool.query(
    `SELECT country, count(*)::int c FROM coin_type WHERE era='foreign' AND country IS NOT NULL GROUP BY 1`)).rows;
  const groups = new Map();
  for (const r of countries) {
    const k = cwords(r.country);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const pairs = [...groups.values()].filter((v) => v.length > 1)
    .map((v) => v.sort((a, b) => b.c - a.c));
  console.log(`групп с несколькими написаниями: ${pairs.length}${apply ? " (APPLY)" : " (сухой прогон)"}`);

  let moved = 0, dropped = 0, kept = 0;
  for (const grp of pairs) {
    const keep = grp[0].country;
    for (const loser of grp.slice(1)) {
      // Двойник — тот же номер Краузе и тот же номинал у канонической страны.
      const dupes = (await pool.query(
        `SELECT b.id lose_id, a.id keep_id,
                (SELECT count(*)::int FROM lot_type_link l WHERE l.type_id=b.id) lose_links
           FROM coin_type b JOIN coin_type a
             -- дубль — это ПОЛНОЕ совпадение: номер Краузе, номинал, название и годы. Сверять
             -- только номер нельзя: у разных стран нумерация Краузе своя, и KM#110 ФРГ не имеет
             -- отношения к KM#110 ГДР.
             ON a.country=$1 AND a.km_number = b.km_number AND a.denomination_text = b.denomination_text
            AND a.name_full IS NOT DISTINCT FROM b.name_full
            AND a.year_start IS NOT DISTINCT FROM b.year_start
            AND a.year_end IS NOT DISTINCT FROM b.year_end
          WHERE b.country=$2 AND b.km_number IS NOT NULL`, [keep, loser.country])).rows;
      const solo = loser.c - new Set(dupes.map((d) => d.lose_id)).size;
      console.log(`  ${keep} ← ${loser.country}: типов ${loser.c}, из них дублей ${new Set(dupes.map((d) => d.lose_id)).size}, своих ${solo}`);
      kept += solo;
      const seen = new Set();
      for (const d of dupes) {
        if (seen.has(d.lose_id)) continue;
        seen.add(d.lose_id);
        if (!apply) { dropped++; moved += d.lose_links; continue; }
        if (d.lose_links) {
          // Связи проигравшего переносим, а не теряем: ON CONFLICT на случай, если лот уже
          // привязан к выжившему.
          const r = await pool.query(
            `UPDATE lot_type_link SET type_id=$2 WHERE type_id=$1
               AND NOT EXISTS (SELECT 1 FROM lot_type_link x WHERE x.lot_id=lot_type_link.lot_id AND x.type_id=$2)`,
            [d.lose_id, d.keep_id]);
          moved += r.rowCount;
          await pool.query("DELETE FROM lot_type_link WHERE type_id=$1", [d.lose_id]);
        }
        await pool.query(
          `UPDATE coin_type k SET
             ref_prices = COALESCE(k.ref_prices, l.ref_prices), image_url = COALESCE(k.image_url, l.image_url),
             image_url_rev = COALESCE(k.image_url_rev, l.image_url_rev), mintage = COALESCE(k.mintage, l.mintage),
             composition = COALESCE(k.composition, l.composition), theme_ru = COALESCE(k.theme_ru, l.theme_ru),
             updated_at = now()
           FROM coin_type l WHERE k.id=$2 AND l.id=$1`, [d.lose_id, d.keep_id]);
        await pool.query("DELETE FROM coin_type WHERE id=$1", [d.lose_id]);
        dropped++;
      }
    }
  }
  console.log(`${apply ? "СДЕЛАНО" : "К ИСПОЛНЕНИЮ"}: дублей удалено ${dropped} · связей перенесено ${moved} · типов без двойника оставлено ${kept}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
