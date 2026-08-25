/**
 * Шаг 5: денойз памятных СССР. Грейд/финиш-токены (NGS/Топ грейд/в слабе/чеканный блеск/MS6x/PF6x)
 * утекли в идентичность типа → фантом-дубли. Снять токен, найти чистый близнец (номинал+год+тема),
 * перенести проходы (UPDATE type_id — unique по lot_id, конфликта нет), удалить фантом. Нет близнеца → чистим имя.
 * Новоделы НЕ трогаем (легитимны), битый год (>2024/<1921) → null. Re-runnable. node catalog/denoise-ussr.js
 */
const { pool } = require("./db");

const NOISE = [
  /[.,]?\s*NGS\s*русский/gi, /[.,]?\s*NGS/gi, /[.,]?\s*в\s+слабе[^.]*/gi,
  /[.,]?\s*Топ[\s-]?грейд/gi, /[.,]?\s*Чеканный блеск/gi, /[.,]?\s*Штемпельный блеск/gi,
  /[.,]?\s*Пруфлайк/gi, /[.,]?\s*Proof-?like/gi,
  /[.,]?\s*MS\s?6\d\+?/gi, /[.,]?\s*MS\s?70/gi, /[.,]?\s*PF\s?6\d/gi, /[.,]?\s*PF\s?70/gi,
];
const clean = (s) => { let r = String(s || ""); for (const re of NOISE) r = r.replace(re, ""); return r.replace(/\s*\.\s*\./g, ".").replace(/\s{2,}/g, " ").replace(/[\s.,]+$/, "").trim(); };
const NOISE_RE = "(NGS|топ[ -]?грейд|в слабе|чеканный блеск|штемпельный блеск|пруфлайк|proof-?like|MS ?6[0-9]|MS ?70|PF ?6[0-9]|PF ?70)";

(async () => {
  const by = await pool.query(`UPDATE coin_type SET year=NULL WHERE era='ussr' AND source<>'fcoins_ussr_circ' AND (year>2024 OR year<1921)`);
  console.log("обнулён битый год:", by.rowCount);

  const ph = await pool.query(`SELECT id, name_full, theme_core, denomination_value dv, year FROM coin_type WHERE era='ussr' AND source<>'fcoins_ussr_circ' AND name_full ~* '${NOISE_RE}'`);
  const all = await pool.query("SELECT id, name_full, theme_core, denomination_value dv, year FROM coin_type WHERE era='ussr'");
  const phIds = new Set(ph.rows.map((r) => r.id));
  const tkey = (r) => `${Number(r.dv)}|${r.year}|${clean(r.theme_core || r.name_full).toLowerCase()}`;
  const twinIdx = new Map();
  for (const r of all.rows) { if (phIds.has(r.id)) continue; const k = tkey(r); if (!twinIdx.has(k)) twinIdx.set(k, r.id); }

  let merged = 0, cleaned = 0;
  for (const p of ph.rows) {
    const twin = twinIdx.get(tkey(p));
    if (twin && twin !== p.id) {
      await pool.query("UPDATE lot_type_link SET type_id=$1 WHERE type_id=$2", [twin, p.id]);
      await pool.query("DELETE FROM coin_type WHERE id=$1", [p.id]);
      merged++;
    } else {
      await pool.query("UPDATE coin_type SET name_full=$1, theme_core=$2 WHERE id=$3", [clean(p.name_full), clean(p.theme_core), p.id]);
      cleaned++;
    }
  }
  console.log(`фантомов: ${ph.rows.length} | слито в близнеца: ${merged} | почищено имя (нет близнеца): ${cleaned}`);
  const tot = (await pool.query("SELECT count(*) c FROM coin_type WHERE era='ussr'")).rows[0].c;
  console.log("типов СССР после денойза:", tot);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
