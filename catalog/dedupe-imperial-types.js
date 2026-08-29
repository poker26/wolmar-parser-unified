/**
 * Слияние имперских типов, которые описывают ОДНУ монету.
 *
 * Имена имперских типов собраны из описаний wolmar вместе с состоянием, поэтому одна монета лежит
 * в каталоге по нескольку раз:
 *
 *   20 копеек 1915 ВС · 20 копеек. NGS русский 1915 ВС · 20 копеек. Штемпельный блеск 1915 ВС ·
 *   20 копеек. Чеканный блеск. Легкая патина 1915 ВС · 20 копеек 1915 ВС R · …
 *
 * Матчер такие типы различить не может и честно воздерживается — из-за этого висят 23 тысячи
 * имперских лотов. А проходы одной монеты раскиданы по восьми карточкам, и медиана считается по
 * каждой отдельно.
 *
 * Сливаем ТОЛЬКО те, чьё различие сводится к состоянию, грейду и ссылкам на справочники.
 * Настоящие разновидности (перечекан, новодел, гладкий гурт, пробные, Осака, соосность) остаются
 * отдельными типами: это разные монеты по цене.
 *
 *   node catalog/dedupe-imperial-types.js [--apply]
 */
const { pool } = require("./db");

// Слова, которые НЕ делают монету другой: состояние, грейд, ссылки на каталоги, оценка редкости.
const NOISE = /^(чеканн|штемпельн|блеск|легк|лёгк|патин|прекрасн|отличн|хорош|очень|почти|сохран|состоян|краснов|коричнев|полированн|зеркальн|штемпел|ngs|ngc|pcgs|hgc|ннр|слаб|топ|грейд|русский|редк|нечаст|оригинал|петров|ильин|биткин|уздеников|северин|severin|казаков|дьяков|конрос|гиль|брекке|тираж|монетн|двор|рубл|копе|денг|полушк|полтин|гривенник|пятак|алтын)/i;
// Слова, которые ДЕЛАЮТ монету другой — такие типы не сливаем ни с чем.
const VARIETY = /(копия|копии|реплик|муляж|подделк|перечекан|новодел|пробн|гладк|соосност|инкуз|осака|брак|надчекан|вензел|орнамент|плакиров|односторон|двойн)/i;

const sig = (name) => {
  const n = String(name || "").toLowerCase();
  const i = n.indexOf(". ");
  const tail = i < 0 ? "" : n.slice(i + 2);
  const words = (tail.match(/[а-яёa-z]{3,}/g) || []).filter((w) => !NOISE.test(w));
  return [...new Set(words)].sort().join(" ");
};

(async () => {
  const apply = process.argv.includes("--apply");
  const rows = (await pool.query(
    `SELECT id, name_full, denomination_value::float8 dv, year, coalesce(mint,'') mint,
            (SELECT count(*)::int FROM lot_type_link l WHERE l.type_id = coin_type.id) links
       FROM coin_type WHERE era='imperial' AND denomination_value IS NOT NULL AND year IS NOT NULL
       ORDER BY id`)).rows;

  const groups = new Map();
  for (const r of rows) {
    if (VARIETY.test(String(r.name_full || ""))) continue;      // настоящая разновидность — не трогаем
    const k = `${r.dv}|${r.year}|${r.mint}|${sig(r.name_full)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const dupes = [...groups.values()].filter((g) => g.length > 1);
  const total = dupes.reduce((a, g) => a + g.length - 1, 0);
  console.log(`групп-дублей: ${dupes.length} · лишних типов: ${total}${apply ? " (APPLY)" : " (сухой прогон)"}`);

  let merged = 0, moved = 0;
  const ex = [];
  for (const g of dupes) {
    // канонический — с наибольшим числом проходов, при равенстве с самым коротким именем
    g.sort((a, b) => b.links - a.links || String(a.name_full).length - String(b.name_full).length || a.id - b.id);
    const keep = g[0];
    if (ex.length < 6) ex.push(`«${(keep.name_full || "").slice(0, 40)}» ← ${g.length - 1}: ${g.slice(1).map((x) => (x.name_full || "").slice(0, 34)).join(" · ")}`);
    for (const lose of g.slice(1)) {
      if (apply) {
        const r = await pool.query(
          `UPDATE lot_type_link l SET type_id=$2 WHERE l.type_id=$1
             AND NOT EXISTS (SELECT 1 FROM lot_type_link x WHERE x.lot_id=l.lot_id AND x.type_id=$2)`,
          [lose.id, keep.id]);
        moved += r.rowCount;
        await pool.query("DELETE FROM lot_type_link WHERE type_id=$1", [lose.id]);
        // переносим то, чего у канонического нет: фото, цены, номера справочников
        await pool.query(
          `UPDATE coin_type k SET
             image_url=COALESCE(k.image_url, l.image_url), image_url_rev=COALESCE(k.image_url_rev, l.image_url_rev),
             bitkin_number=COALESCE(k.bitkin_number, l.bitkin_number), ref_prices=COALESCE(k.ref_prices, l.ref_prices),
             metal=COALESCE(k.metal, l.metal), mass=COALESCE(k.mass, l.mass), rarity=COALESCE(k.rarity, l.rarity),
             updated_at=now()
           FROM coin_type l WHERE k.id=$2 AND l.id=$1`, [lose.id, keep.id]);
        await pool.query("DELETE FROM coin_type WHERE id=$1", [lose.id]);
      } else moved += lose.links;
      merged++;
    }
  }
  for (const e of ex) console.log("  ", e);
  console.log(`${apply ? "СЛИТО" : "К СЛИЯНИЮ"}: типов ${merged} · связей перенесено ${moved}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
