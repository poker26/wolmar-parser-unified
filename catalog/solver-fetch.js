/**
 * Scrapfly web-unblocker — проходит интерактивный Cloudflare (meshok.net) + прокси + JS-рендер.
 * Биллинг за УСПЕШНЫЙ запрос (простаивая, ничего не стоит). Ключ: env SCRAPFLY_KEY или файл catalog/.solver-key.
 *   const { fetchHtml } = require("./solver-fetch");
 *   const { content, status, cost } = await fetchHtml(url, { residential:true });
 */
const fs = require("fs");

function apiKey() {
  if (process.env.SCRAPFLY_KEY) return process.env.SCRAPFLY_KEY.trim();
  try { return fs.readFileSync(__dirname + "/.solver-key", "utf8").trim(); } catch (_) { return null; }
}

async function fetchHtml(url, { renderJs = true, asp = true, country = "ru", residential = false, waitMs = 0, waitForSelector = null, retries = 1 } = {}) {
  const k = apiKey();
  if (!k) throw new Error("нет SCRAPFLY_KEY (env SCRAPFLY_KEY или файл catalog/.solver-key)");
  const p = new URLSearchParams({ key: k, url, asp: String(asp), render_js: String(renderJs), country });
  if (residential) p.set("proxy_pool", "public_residential_pool");
  if (waitMs) p.set("rendering_wait", String(waitMs));
  if (waitForSelector) p.set("wait_for_selector", waitForSelector);
  let last = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(`https://api.scrapfly.io/scrape?${p.toString()}`, { signal: AbortSignal.timeout(150000) });
      const j = await r.json();
      const res = j.result || {};
      const cost = (j.context && j.context.cost && j.context.cost.total) || null;
      if (res.content && (res.status_code === 200 || (res.content.length > 5000 && !/just a moment/i.test(res.content)))) {
        return { content: res.content, status: res.status_code, cost };
      }
      last = { content: res.content || "", status: res.status_code || r.status, cost, error: (res.error && (res.error.message || res.error)) || j.message || "challenge/empty" };
    } catch (e) { last = { content: "", error: e.message }; }
  }
  return last || { content: "" };
}

module.exports = { fetchHtml, apiKey };
