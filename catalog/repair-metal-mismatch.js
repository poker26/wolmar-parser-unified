/**
 * Точечная починка связей, противоречащих НАЗВАННОМУ В ЛОТЕ МЕТАЛЛУ.
 *
 * По хендоффу задачи оценки: у ЦБ один и тот же сюжет выпускают и серебром, и золотом под одним
 * названием, годом и номиналом («100 рублей. Белка обыкновенная 2023» — серебряная 5117-0067 и
 * золотая 5217-0049). Металл в этом случае единственное, что их различает, а признак работал
 * только в иностранной ветке — поэтому все золотые «Белки» висели на серебряном типе, а у
 * золотого не было ни одного прохода. Причина устранена в матчере; здесь чинятся накопленные связи.
 *
 * Правило намеренно узкое: берём связь, только если в лоте металл НАЗВАН, у типа он ЗАПОЛНЕН и
 * они противоречат друг другу. Связь ПЕРЕСТАВЛЯЕТСЯ, если матчер предлагает другой тип; если он
 * воздерживается — связь остаётся, а случай попадает в отчёт. Удалять здесь нечего: спор о
 * металле решается выбором другой карточки, а не отказом от привязки.
 *
 *   node catalog/repair-metal-mismatch.js [--apply] [--limit N]
 */
const { pool } = require("./db");
const { DIAG, parseTitle, matchType } = require("./coin-matcher");

// ⚠️ «AU» бывает грейдом (AU50…AU58), а не золотом: без оговорки монета «в слабе AU58» считалась
// золотой. Вес золота пишут дробью («Au 15,55»), поэтому число с запятой грейдом не считаем.
// Вторая регулярка проверяет металл ТИПА и обязана знать сокращение: у типов из описаний
// аукциона металл записан как «Ag»/«Au». Без этого тип с «Ag» не проходил проверку на серебро,
// и 63 серебряных австралийских лота остались на медно-никелевом типе.
const LOT_M = [
  [/золот|(?<![а-яёa-z])au(?!\s*5[0358](?![.,\d]))(?![а-яёa-z])/i, /золот|gold|(?<![a-zа-яё])au(?![a-zа-яё])/i],
  [/сереб|(?<![а-яёa-z])ag(?![а-яёa-z])/i, /сереб|silver|(?<![a-zа-яё])ag(?![a-zа-яё])/i],
  [/платин|(?<![а-яёa-z])pt(?![а-яёa-z])/i, /платин|platin|(?<![a-zа-яё])pt(?![a-zа-яё])/i],
  [/паллад|(?<![а-яёa-z])pd(?![а-яёa-z])/i, /паллад|palladium|(?<![a-zа-яё])pd(?![a-zа-яё])/i],
];

(async () => {
  const apply = process.argv.includes("--apply");
  const li = process.argv.indexOf("--limit");
  const limit = li > -1 ? parseInt(process.argv[li + 1], 10) : 0;
  DIAG.on = true;

  const rows = (await pool.query(
    `SELECT l.id link_id, l.type_id, a.id lot_id, a.coin_description cd,
            c.metal, left(c.name_full, 44) nm, c.cbr_cat_num
       FROM lot_type_link l JOIN auction_lots a ON a.id = l.lot_id
       JOIN coin_type c ON c.id = l.type_id
       JOIN lot_kind k ON k.lot_id = l.lot_id AND k.kind = 'coin'
      WHERE c.metal IS NOT NULL AND btrim(c.metal) <> '' AND a.coin_description IS NOT NULL
      ORDER BY l.id ${limit ? "LIMIT " + limit : ""}`)).rows;
  console.log(`связей с заполненным металлом типа: ${rows.length}${apply ? " (APPLY)" : " (сухой прогон)"}`);

  const move = [], stay = [];
  let done = 0;
  for (const r of rows) {
    // Металл, названный в лоте, и его требование к типу.
    const hit = LOT_M.find(([inLot]) => inLot.test(r.cd));
    if (!hit || hit[1].test(String(r.metal))) continue;           // не назван или согласуется
    let m = null;
    try { m = await matchType(pool, parseTitle(r.cd)); } catch (_) {}
    // Переставляем ТОЛЬКО когда цель согласуется с названным металлом. Иначе перестановку двигало
    // бы что-то другое (номинал, сюжет), а это уже не наша группа: у пары «1 полторак» → «1 орт»
    // оба типа серебряные, и спор там не о металле.
    let ok = false;
    if (m && m.id !== r.type_id) {
      const dst = (await pool.query("SELECT metal FROM coin_type WHERE id=$1", [m.id])).rows[0];
      ok = !!dst && hit[1].test(String(dst.metal || ""));
    }
    if (ok) move.push({ ...r, to: m });
    else stay.push(r);
    if (++done % 25000 === 0) console.log(`  ${done}/${rows.length} · переставить ${move.length} · оставить ${stay.length}`);
  }
  console.log(`\nпротиворечий металла: ${move.length + stay.length} · переставить ${move.length} · матчер не выбрал ${stay.length}`);
  const byPair = new Map();
  for (const b of move) {
    const k = `${b.type_id} «${b.nm}» → ${b.to.id}`;
    byPair.set(k, (byPair.get(k) || 0) + 1);
  }
  for (const [k, v] of [...byPair.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20))
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  if (stay.length) {
    console.log("\nостаются (матчер воздержался) — для отчёта:");
    stay.slice(0, 8).forEach((b) => console.log(`  лот ${b.lot_id} на типе ${b.type_id} «${b.nm}» (${b.metal}) · ${String(b.cd).replace(/\s+/g, " ").slice(0, 54)}`));
  }

  if (apply && move.length) {
    for (const b of move) {
      await pool.query(
        "UPDATE lot_type_link SET type_id=$2, match_method='metal-fix', match_confidence=$3 WHERE id=$1",
        [b.link_id, b.to.id, b.to.conf]);
    }
    console.log(`ПЕРЕСТАВЛЕНО: ${move.length}`);
  }
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
