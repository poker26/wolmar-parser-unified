/**
 * CLI-обёртка live-поиска для спавна из API (изолированный процесс — браузер НЕ в API-сервере).
 * node catalog/live-search-cli.js "<query>"  → печатает JSON {auctionru:{found,offers}}
 */
const { searchAuctionRu } = require("./live-search");
const { close } = require("./browser-fetch");
(async () => {
  const q = process.argv[2] || "";
  let out = { auctionru: { found: 0, offers: [] } };
  try { out.auctionru = await searchAuctionRu(q, { max: 15 }); } catch (e) { out.error = e.message; }
  try { await close(); } catch (_) {}
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
})();
