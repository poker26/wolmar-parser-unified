/**
 * Лоты, помеченные монетой, у которых номинал не разобран вовсе.
 * Вопрос ровно один: это НЕ монеты (лупа, жетон, чек — их не считаем по правилу «работаем только
 * с монетами») или монеты, чей номинал написан словом без числа («Талер», «Соверен», «Денга»)?
 *
 *   node catalog/census-nodenom.js [выборка]
 */
const { pool } = require("./db");
const { parseTitle, enUnit } = require("./coin-matcher");

// Единичный номинал словом: у таких монет числа в заголовке может не быть вовсе.
const WORD_DENOM = /(?<![а-яё])(талер|соверен|дукат|гульден|экю|червонец|денга|денежка|полушка|полтина|гривна|гривенник|пятак|алтын|цехин|флорин|крейцер|грош|шиллинг|песо|реал|эскудо|драхм|динар|дирхам|солид|денарий|сестерций|обол|статер|тетрадрахм)/i;

(async () => {
  const N = +(process.argv[2] || 20000);
  const rows = (await pool.query(`
    SELECT a.coin_description cd FROM auction_lots a
      JOIN lot_kind k ON k.lot_id=a.id AND k.kind='coin'
      LEFT JOIN lot_type_link l ON l.lot_id=a.id
     WHERE l.lot_id IS NULL AND a.coin_description IS NOT NULL
     ORDER BY a.id % 83, a.id LIMIT $1`, [N])).rows;
  let noDenom = 0, wordDenom = 0, plain = 0;
  const exWord = [], exPlain = [];
  for (const { cd } of rows) {
    const p = parseTitle(cd);
    if (p.denom) continue;
    noDenom++;
    if (WORD_DENOM.test(cd) || enUnit(String(cd).split(/\s+/)[0].toLowerCase())) {
      wordDenom++;
      if (exWord.length < 8) exWord.push(cd.replace(/\s+/g, " ").slice(0, 74));
    } else {
      plain++;
      if (exPlain.length < 12) exPlain.push(cd.replace(/\s+/g, " ").slice(0, 74));
    }
  }
  console.log(`выборка ${rows.length}: без номинала ${noDenom}`);
  console.log(`  из них с номиналом-словом: ${wordDenom}`);
  exWord.forEach((e) => console.log("     ", e));
  console.log(`  из них без всякого признака монеты: ${plain}`);
  exPlain.forEach((e) => console.log("     ", e));
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
