/**
 * Переиспользуемый браузерный фетч (puppeteer-extra + stealth) — проходит DDoS-Guard (auction.ru/meshok).
 * Синглтон-браузер + одна страница: JS-челлендж решается один раз, cookie __ddg греется для bulk.
 * Фото грузить НЕ отсюда (static.auction.ru = CDN без челленджа, обычным curl).
 */
const puppeteer = require("puppeteer-extra");
const Stealth = require("puppeteer-extra-plugin-stealth");
puppeteer.use(Stealth());

let browser = null, page = null;

async function init() {
  if (browser) return;
  browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled", "--disable-gpu", "--user-data-dir=/tmp/chrome-bf-" + process.pid],
  });
  page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0 Safari/537.36");
}

async function fetchHtml(url, { wait = 1200, timeout = 45000 } = {}) {
  await init();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    // ждём, пока anti-bot челлендж (Cloudflare «Just a moment» / DDoS-Guard) не уйдёт по смене title
    try {
      await page.waitForFunction(
        () => { const t = document.title || ""; return t && !/just a moment|ddos-guard|attention required|проверка|checking your browser/i.test(t); },
        { timeout: 22000, polling: 1000 });
    } catch (_) { /* челлендж не ушёл — вернём что есть */ }
    if (wait) await new Promise((r) => setTimeout(r, wait));
    return await page.content();
  } catch (e) { return ""; }
}

async function close() { if (browser) { try { await browser.close(); } catch (_) {} browser = null; page = null; } }

module.exports = { fetchHtml, close };
