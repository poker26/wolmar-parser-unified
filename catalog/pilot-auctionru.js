/**
 * ПИЛОТ auction.ru — foreign-монеты 2019+ с ценой + фото. Enumeration через sitemap (robots-clean),
 * парс slug+og:title, цена из JSON "price", статус «Завершён», фото offer_images. Печатает выборку.
 * Ничего не пишет в БД (пилот). node catalog/pilot-auctionru.js
 */
const { execSync } = require("child_process");
const fs = require("fs");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
const get = (url) => { try { return execSync(`curl -s -A "${UA}" --max-time 30 "${url}"`, { maxBuffer: 128 * 1024 * 1024 }).toString("utf8"); } catch (e) { return ""; } };
const sleep = (ms) => { try { execSync(`sleep ${ms / 1000}`); } catch (_) {} };

const slugDenom = (slug) => {
  const m = slug.match(/^(\d+(?:_\d+)?)_([a-z]+)/);  // 1_dollar / 1_2_krony / 1_24_talera
  if (!m) return null;
  const num = m[1].includes("_") ? (() => { const [a, b] = m[1].split("_"); return b ? +a / +b : +a; })() : +m[1];
  return { num, unit: m[2] };
};

(async () => {
  const idx = get("https://auction.ru/sitemap.xml");
  const maps = [...idx.matchAll(/<loc>(https:\/\/auction\.ru\/sitemaps\/sitemap_\d+\.xml)<\/loc>/g)].map((m) => m[1]);
  console.log("под-сайтмапов:", maps.length);

  const cands = [];
  for (const sm of maps) {
    if (cands.length >= 80) break;
    const xml = get(sm); sleep(300);
    for (const m of xml.matchAll(/<loc>(https:\/\/auction\.ru\/offer\/([a-z0-9_-]+)-i\d+\.html)<\/loc>/g)) {
      const url = m[1], slug = m[2];
      if (!/_(2019|202[0-6])_goda_/.test(slug)) continue;          // 2019+
      if (/_(sssr|rsfsr)/.test(slug)) continue;
      const d0 = slugDenom(slug);
      if (!d0) continue;                                            // похоже на монету
      if (/^(rubl|kopej|kopee|kopei|pk|monet|nabor|zheton|sht|lot|gramm|chervon|uncij)/.test(d0.unit)) continue; // НЕ РФ/мусор → foreign-валюта
      cands.push({ url, slug });
      if (cands.length >= 80) break;
    }
  }
  console.log("кандидатов foreign-2019+ найдено:", cands.length, "(беру выборку 40)");

  const out = [];
  for (const c of cands.slice(0, 40)) {
    const html = get(c.url); sleep(250);
    if (!html) continue;
    const title = (html.match(/og:title"\s+content="([^"]+)"/) || [])[1] || "";
    const price = (html.match(/"price"\s*:\s*"?(\d+)"?/) || [])[1] || null;
    const ended = /Завершен|Завершён|Лот продан|Продан/i.test(html);
    const ogimg = (html.match(/og:image"\s+content="([^"]+)"/) || [])[1] || null;
    const photos = [...new Set([...html.matchAll(/https:\/\/static\.auction\.ru\/offer_images\/[^\s"'\\]+?\.jpe?g/g)].map((m) => m[0]))];
    const ym = c.slug.match(/_((?:2019|202[0-6]))_goda_/);
    const country = (c.slug.match(/_goda_([a-z]+)/) || [])[1] || "";
    const d = slugDenom(c.slug);
    out.push({ year: ym ? +ym[1] : null, country, denom: d ? `${d.num} ${d.unit}` : "", title,
      price: price ? +price : null, ended, photos: photos.length, ogimg, url: c.url });
  }

  console.log("\n=== ВЫБОРКА (страна | год | номинал | цена | завершён | фото) ===");
  for (const r of out) console.log(`  ${r.country.padEnd(14)} ${r.year} | ${r.denom.padEnd(12)} | ${r.price ? r.price + "₽" : "—"} | ${r.ended ? "завершён" : "актив"} | фото:${r.photos} | ${r.title.slice(0, 50)}`);
  const sold = out.filter((r) => r.ended && r.price), withPh = out.filter((r) => r.photos > 0);
  console.log(`\nИТОГО выборки: ${out.length} | завершённых-с-ценой: ${sold.length} | с фото: ${withPh.length} | стран: ${new Set(out.map((r) => r.country)).size}`);
  fs.writeFileSync("/tmp/auctionru_pilot.json", JSON.stringify(out, null, 2));
  console.log("сэмпл сохранён в /tmp/auctionru_pilot.json");
})();
