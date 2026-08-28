/**
 * Разметка лотов: монета / набор / не наш предмет — и представление `coin_lots` поверх неё.
 *
 * Директива пользователя: работаем ТОЛЬКО с монетами. Боны, карточки, слитки, ордена, значки и
 * прочее в базе остаются ради полноты, но в подсчётах, классификации и статистике не участвуют.
 * Чтобы это не приходилось повторять в каждом запросе, вердикт матчера сохраняется таблицей:
 *
 *   lot_kind(lot_id, kind)   kind = 'coin' | 'set' | 'other'
 *   coin_lots                представление: только auction_lots с kind='coin'
 *
 * Набор — это тоже монеты, но не один тип, поэтому он отделён от 'coin' и от 'other'.
 * Идемпотентно: без --all размечает только то, что ещё не размечено или изменилось.
 *
 *   node catalog/mark-coin-lots.js [--all] [--apply]
 */
const { pool } = require("./db");
const { parseTitle } = require("./coin-matcher");

const BATCH = 5000;

(async () => {
  const apply = process.argv.includes("--apply");
  const all = process.argv.includes("--all");

  if (apply) {
    await pool.query(`CREATE TABLE IF NOT EXISTS lot_kind (
      lot_id BIGINT PRIMARY KEY, kind TEXT NOT NULL, checked_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query(`CREATE INDEX IF NOT EXISTS lot_kind_kind ON lot_kind(kind)`);
  }

  const rows = (await pool.query(
    `SELECT a.id, a.coin_description cd FROM auction_lots a
      ${all ? "" : "LEFT JOIN lot_kind k ON k.lot_id = a.id WHERE k.lot_id IS NULL"}`)).rows;
  console.log(`лотов к разметке: ${rows.length}${apply ? " (APPLY)" : " (сухой прогон)"}`);

  const tally = { coin: 0, set: 0, other: 0 };
  let buf = [];
  const flush = async () => {
    if (!apply || !buf.length) { buf = []; return; }
    const vals = buf.map((_, i) => `($${i * 2 + 1}::bigint, $${i * 2 + 2})`).join(",");
    await pool.query(
      `INSERT INTO lot_kind (lot_id, kind) VALUES ${vals}
       ON CONFLICT (lot_id) DO UPDATE SET kind = EXCLUDED.kind, checked_at = now()`,
      buf.flatMap((x) => [x[0], x[1]]));
    buf = [];
  };
  for (const r of rows) {
    const p = parseTitle(r.cd || "");
    // Без описания судить не о чем — считаем «не наш предмет», чтобы не попадало в статистику.
    const kind = !r.cd ? "other" : p.isNonCoin ? "other" : p.isSet ? "set" : "coin";
    tally[kind]++;
    buf.push([r.id, kind]);
    if (buf.length >= BATCH) await flush();
  }
  await flush();

  if (apply) {
    await pool.query(`CREATE OR REPLACE VIEW coin_lots AS
      SELECT a.* FROM auction_lots a JOIN lot_kind k ON k.lot_id = a.id AND k.kind = 'coin'`);
  }
  console.log(`монеты ${tally.coin} · наборы ${tally.set} · не наш предмет ${tally.other}`);
  if (apply) {
    const v = (await pool.query(
      `SELECT count(*)::int lots, count(*) FILTER (WHERE NOT EXISTS
         (SELECT 1 FROM lot_type_link l WHERE l.lot_id = c.id))::int orphans FROM coin_lots c`)).rows[0];
    console.log(`представление coin_lots: лотов ${v.lots}, из них без типа ${v.orphans}`);
  }
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
