// Разведка ЦБ coins_base: какой РЕАЛЬНЫЙ запрос фильтрует/листает. Логируем навигации + сериализуем форму.
const puppeteer = require("/var/www/wolmar-parser/node_modules/puppeteer");

(async () => {
  const b = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
  const pg = await b.newPage();
  await pg.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36");
  await pg.setRequestInterception(true);
  const navs = [];
  pg.on("request", (r) => {
    const t = r.resourceType();
    if (t === "document") navs.push(r.method() + " " + r.url());
    if (["image", "stylesheet", "font", "media", "websocket", "manifest"].includes(t)) return r.abort();
    r.continue();
  });

  const base = "https://www.cbr.ru/cash_circulation/memorable_coins/coins_base/";
  try { await pg.goto(base, { waitUntil: "domcontentloaded", timeout: 35000 }); } catch (e) { console.error("goto1", e.message); }
  await new Promise((r) => setTimeout(r, 7000)); // дать auto-submit отработать

  // сериализуем форму UniDbQuery
  const formInfo = await pg.evaluate(() => {
    const out = { forms: [], controls: [] };
    for (const f of document.querySelectorAll("form")) {
      out.forms.push({ method: f.method, action: f.getAttribute("action") });
    }
    // все именованные контролы
    for (const el of document.querySelectorAll("input[name],select[name],button[name]")) {
      let v = el.value;
      if (el.tagName === "SELECT") { const o = el.options[el.selectedIndex]; v = (o ? o.value : "") + " («" + (o ? o.text : "") + "»)"; }
      out.controls.push(`${el.tagName}[${el.type || ""}] ${el.name} = ${String(v).slice(0, 40)}`);
    }
    out.href = location.href;
    return out;
  }).catch((e) => ({ err: e.message }));

  console.log("=== NAVIGATIONS (document) ===");
  console.log([...new Set(navs)].join("\n"));
  console.log("\n=== FORM / CONTROLS ===");
  console.log(JSON.stringify(formInfo, null, 1));
  await b.close();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
