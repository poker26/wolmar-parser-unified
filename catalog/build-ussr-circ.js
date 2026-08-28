/**
 * Каталог СССР — ХОДЯЧКА (тиражные монеты РСФСР/СССР 1921-1991), спайн из fcoins catalogussr.
 * Карточка = погодовка (номинал+год+разновидность) + Каталожный номер Федорина + гурт.
 * fcoins используется только как справочник типов; цены берём из реальных проходов.
 * Resume-safe (source_card_id). Запуск: node catalog/build-ussr-circ.js
 */
const { execSync } = require("child_process");
const { pool } = require("./db");
const N = require("./normalize");

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
const curl = (url) => execSync(`curl -s -A "${UA}" "${url}" | iconv -f CP1251 -t UTF-8//TRANSLIT 2>/dev/null`, { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
const sleep = (ms) => { try { execSync(`sleep ${ms / 1000}`); } catch (_) {} };
const strip = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

(async () => {
  await pool.query(`ALTER TABLE coin_type ADD COLUMN IF NOT EXISTS fedorin_number TEXT, ADD COLUMN IF NOT EXISTS edge TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS coin_type_era_key ON coin_type(era, type_key) WHERE era IS NOT NULL`);

  const listing = curl("https://www.fcoins.ru/catalogussr.asp?pagenom=1");
  const ids = [...new Set([...listing.matchAll(/catalogussr(\d+)\.asp/gi)].map((m) => m[1]))];
  console.log("карточек в листинге:", ids.length);

  const have = new Set((await pool.query("SELECT source_card_id FROM coin_type WHERE source='fcoins_ussr_circ' AND source_card_id IS NOT NULL")).rows.map((r) => r.source_card_id));
  let ok = 0, skip = 0, bad = 0;
  for (const id of ids) {
    if (have.has(id)) { skip++; continue; }
    let html;
    try { html = curl(`https://www.fcoins.ru/catalog/catalogussr/catalogussr${id}.asp`); } catch (e) { bad++; continue; }
    const h1 = strip((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "").replace(/^Описание и стоимость монеты\s*/i, "");
    if (!h1) { bad++; continue; }
    const ym = h1.match(/\b(19\d{2})\s*г/);
    const year = ym ? parseInt(ym[1], 10) : null;
    const denom = N.denomination(h1);
    if (denom.value == null || !year) { bad++; continue; }
    const variety = ym ? h1.slice(h1.indexOf(ym[0]) + ym[0].length).replace(/^\.?\s*/, "").trim() : "";
    const txt = strip(html);
    const fm = txt.match(/Каталожный номер:\s*Федорин[-\s]?([0-9]+[А-Яа-яA-Za-z]?)/i);
    const fed = fm ? ("Федорин-" + fm[1]) : null;
    const em = txt.match(/Гурт\s+(гладкий|рубчатый|шнуровидный|надпись[^.]{0,40}|с надписью[^.]{0,40})/i);
    const edge = em ? em[1].trim() : null;
    const core = N.core(N.stripNominal(h1.replace(/\b19\d{2}\s*г\.?/, "")));
    const tk = `ussrcirc|${denom.value}|${year}|${id}`;
    const nf = `${denom.text} ${year}${variety ? ". " + variety : ""}`;
    await pool.query(
      `INSERT INTO coin_type (source,era,status,name_full,theme_core,denomination_text,denomination_value,year,type_key,country,fedorin_number,edge,source_card_id)
       VALUES ('fcoins_ussr_circ','ussr','catalog',$1,$2,$3,$4,$5,$6,'SU',$7,$8,$9)
       ON CONFLICT (era,type_key) WHERE era IS NOT NULL
       DO UPDATE SET fedorin_number=EXCLUDED.fedorin_number, edge=EXCLUDED.edge, name_full=EXCLUDED.name_full`,
      [nf, core, denom.text, denom.value, year, tk, fed, edge, id]);
    ok++;
    if (ok % 25 === 0) process.stderr.write(`  ok=${ok}\r`);
    sleep(140);
  }
  console.log(`\nСССР-ходячка fcoins: вставлено/обновлено ${ok} | пропущено(было) ${skip} | битых ${bad}`);
  const c = await pool.query("SELECT count(*) c, count(fedorin_number) f FROM coin_type WHERE source='fcoins_ussr_circ'");
  console.log(`итого fcoins_ussr_circ: ${c.rows[0].c} типов | с Федорин# ${c.rows[0].f}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
