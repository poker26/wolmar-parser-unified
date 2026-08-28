/**
 * Рублёвое значение для типов со словесным номиналом (имперская эра).
 *
 * У «Полуполтинника» значение проставлено лишь у 49 типов из 142, у «Гривенника» — ни у одного,
 * а имперская ветка матчера ищет строго по denomination_value. Из-за этого лот определялся в
 * лучшем случае в тот единственный тип, где значение случайно оказалось заполнено.
 * Заполняем ТОЛЬКО пустые: имеющиеся значения не трогаем.
 *
 *   node catalog/backfill-named-denoms.js [--apply]
 */
const { pool } = require("./db");

const NAMED = [
  ["полушка", 0.0025], ["денга", 0.005], ["деньга", 0.005], ["алтын", 0.03], ["пятак", 0.05],
  ["гривенник", 0.1], ["пятиалтынный", 0.15], ["двугривенный", 0.2],
  ["полуполтинник", 0.25], ["полтина", 0.5], ["полтинник", 0.5],
];

(async () => {
  const apply = process.argv.includes("--apply");
  let total = 0;
  for (const [word, value] of NAMED) {
    const where = `era='imperial' AND denomination_value IS NULL
                   AND (denomination_text ILIKE $1 OR name_full ILIKE $1)`;
    const n = (await pool.query(`SELECT count(*)::int c FROM coin_type WHERE ${where}`, [word + "%"])).rows[0].c;
    if (!n) continue;
    if (apply) {
      await pool.query(
        `UPDATE coin_type SET denomination_value=CAST($2 AS numeric), updated_at=now() WHERE ${where}`,
        [word + "%", value.toFixed(6)]);
    }
    console.log(`  ${word.padEnd(15)} → ${String(value).padEnd(7)} · типов ${n}`);
    total += n;
  }
  console.log(`${apply ? "ЗАПИСАНО" : "К ЗАПИСИ"}: ${total}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
