/**
 * Проба meshok.net через Scrapfly (solver-fetch). Валидирует, что Cloudflare пробит, и разведывает
 * структуру: листинг монет (активные/завершённые), лоты, цены, фото, sold-статус. node catalog/meshok-probe.js
 */
const { fetchHtml } = require("./solver-fetch");

const m = (h, re) => (h.match(re) || [])[1] || "";

(async () => {
  // 1) листинг монет
  for (const url of ["https://meshok.net/good/252", "https://meshok.net/listing/coins"]) {
    console.log("\n===== " + url + " =====");
    const { content: h, status, cost } = await fetchHtml(url, { residential: true, waitMs: 4000 });
    console.log(`status=${status} cost=${cost} len=${h.length} challenge=${/just a moment|cf_chl/i.test(h)}`);
    if (!h || h.length < 3000) { console.log("  пусто/блок — пропуск"); continue; }
    console.log("title:", m(h, /<title>([^<]*)<\/title>/).slice(0, 80));
    const items = [...new Set([...h.matchAll(/\/item\/(\d+)/g)].map((x) => x[1]))];
    console.log("лотов /item/:", items.length, "примеры:", items.slice(0, 4).join(","));
    console.log("маркеры активн/заверш:", [...new Set((h.match(/(продан|завершен[аоые]*|идут торги|до окончания|ставк[а-я]*|активн|лот закрыт|выиграл)/gi) || []))].slice(0, 8).join(", "));
    console.log("ссылки фильтра (finished/active/state):", [...new Set((h.match(/good\/252[^"' ]{0,40}/g) || []))].slice(0, 6).join(" | "));
    // 2) если есть лот — открыть карточку
    if (items.length) {
      const iurl = `https://meshok.net/item/${items[0]}`;
      console.log("\n----- карточка " + iurl + " -----");
      const { content: c, status: s2, cost: c2 } = await fetchHtml(iurl, { residential: true, waitMs: 4000 });
      console.log(`status=${s2} cost=${c2} len=${c.length}`);
      console.log("title:", m(c, /<title>([^<]*)<\/title>/).slice(0, 80));
      console.log("цена/ставки:", (c.match(/(\d[\d  ]{2,})\s*(руб|₽)|ставк[а-я]*[: ]*\d+|текущая цена|блиц/gi) || []).slice(0, 5).join(" | "));
      console.log("статус:", [...new Set((c.match(/(лот закрыт|продан|завершен[аоые]*|идут торги|до окончания|снят с торгов)/gi) || []))].join(", "));
      const ph = [...new Set([...c.matchAll(/https?:\/\/[a-z0-9.-]*meshok[^\s"'<>]*\.(jpe?g|png|webp)/gi)].map((x) => x[0]))];
      console.log("фото:", ph.length, ph.slice(0, 2).join(" "));
      console.log("год/номинал в заголовке?:", m(c, /<h1[^>]*>([^<]*)<\/h1>/).slice(0, 70));
    }
    break;
  }
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
