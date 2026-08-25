/**
 * Live-search микросервис (НЕ в pm2-кластере API). Держит браузер тёплым (browser-fetch singleton),
 * отвечает на GET /search?q= → JSON {found, offers}. API-сервер ходит сюда по HTTP вместо spawn.
 * Запуск на проде: pm2 start catalog/live-search-server.js --name live-search --no-autorestart=false
 */
const http = require("http");
const { searchAuctionRu, searchMeshok } = require("./live-search");

const PORT = parseInt(process.env.LIVE_SEARCH_PORT || "3005", 10);
let busy = false;     // auction.ru: браузер один — сериализуем
let mBusy = false;    // meshok: Scrapfly (отдельный канал, не трогает браузер)

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (u.pathname === "/health") { res.end('{"ok":true}'); return; }
  const q = (u.searchParams.get("q") || "").trim();
  if (u.pathname === "/msearch") {                       // meshok (Scrapfly, платно)
    if (q.length < 2) { res.end('{"found":0,"offers":[]}'); return; }
    if (mBusy) { res.statusCode = 503; res.end('{"error":"busy"}'); return; }
    mBusy = true;
    try { res.end(JSON.stringify(await searchMeshok(q, { max: 24 }))); }
    catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    finally { mBusy = false; }
    return;
  }
  if (u.pathname !== "/search") { res.statusCode = 404; res.end('{"error":"not found"}'); return; }
  if (q.length < 2) { res.end('{"found":0,"offers":[]}'); return; }
  if (busy) { res.statusCode = 503; res.end('{"error":"busy"}'); return; }
  busy = true;
  try {
    const r = await searchAuctionRu(q, { max: 15 });
    res.end(JSON.stringify(r));
  } catch (e) {
    res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
  } finally { busy = false; }
});

server.listen(PORT, "127.0.0.1", () => console.log("live-search-server слушает 127.0.0.1:" + PORT));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
