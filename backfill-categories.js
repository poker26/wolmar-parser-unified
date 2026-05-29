/**
 * Безопасная добивка КАТЕГОРИЙ по листинг-страницам Wolmar.
 *
 * Зачем: исходный парсер категории не собирал; чекбокс «парсить только категории»
 * добавлен позже и прогнан не по всем старым аукционам. Здесь добиваем NULL-категории
 * у конкретных аукционов, НЕ трогая ничего больше.
 *
 * Как: своим браузером (puppeteer-utils, та же конфигурация что у боевого парсера)
 * скрейпим ТОЛЬКО страницы категорий (списки лотов), берём lotId из ссылки и ставим
 * category таргетным UPDATE с жёстким условием (category IS NULL OR category=''),
 * сопоставляя по auction_lots.source_url. НИКОГДА не пишем weight/fineness/даты/ставки.
 * Не используем WolmarCategoryParser.init() — он делает CREATE TABLE, на что у роли
 * нет прав (permission denied for schema public).
 *
 *   node backfill-categories.js --dry-run                # посчитать совпадения, без записи
 *   node backfill-categories.js                          # запись (фоновый прогон)
 *   node backfill-categories.js --auctions 954           # ограничить список аукционов
 */
const { Client } = require('pg');
const config = require('./config');
const { launchPuppeteer, createPage } = require('./puppeteer-utils');

const DRY = process.argv.includes('--dry-run');
const aIdx = process.argv.indexOf('--auctions');
const DEFAULT_TARGETS = [789, 790, 954, 955, 956, 957, 958, 959, 960, 961, 962, 963, 964, 970];
const TARGETS = aIdx !== -1 && process.argv[aIdx + 1]
    ? process.argv[aIdx + 1].split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean)
    : DEFAULT_TARGETS;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const lotIdFromUrl = (u) => { const m = String(u).match(/\/auction\/\d+\/(\d+)/); return m ? m[1] : null; };

/** Сбор ссылок на лоты со страницы категории (с пагинацией). Только чтение. */
async function getCategoryLotUrls(page, categoryUrl) {
    const all = new Set();
    try {
        await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(1500);
    } catch (e) { return []; }

    let maxPage = 1;
    try {
        maxPage = await page.evaluate(() => {
            let mp = 1;
            document.querySelectorAll('.paginator li a').forEach(a => {
                const n = parseInt(a.textContent); if (n && n > mp) mp = n;
            });
            return mp;
        });
    } catch (_) {}

    for (let p = 1; p <= maxPage; p++) {
        const pageUrl = p === 1 ? categoryUrl : `${categoryUrl}${categoryUrl.includes('?') ? '&' : '?'}page=${p}`;
        try { await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }); await sleep(900); }
        catch (e) { continue; }
        let urls = [];
        try {
            urls = await page.evaluate(() => {
                const out = [];
                document.querySelectorAll('a.title.lot[href*="/auction/"]').forEach(a => { if (a.href) out.push(a.href); });
                return out;
            });
        } catch (_) { continue; }
        urls.forEach(u => all.add(u));
        await sleep(400);
    }
    return [...all];
}

async function run() {
    const db = new Client(config.dbConfig);
    await db.connect();
    console.log('✅ Подключено к базе данных');

    const categories = (await db.query(
        `SELECT name, url_template FROM wolmar_categories WHERE url_template IS NOT NULL ORDER BY name`)).rows;
    const browser = await launchPuppeteer();
    const page = await createPage(browser);
    console.log(`✅ Браузер запущен. Категорий: ${categories.length}; аукционов: ${TARGETS.length}; режим=${DRY ? 'DRY-RUN' : 'WRITE'}\n`);

    let grandUpdated = 0;
    for (const auction of TARGETS) {
        const pnRow = (await db.query(
            `SELECT parsing_number FROM auction_lots
             WHERE auction_number = $1 AND parsing_number IS NOT NULL LIMIT 1`, [auction])).rows[0];
        if (!pnRow) { console.log(`[ауктион ${auction}] нет parsing_number в БД — пропуск`); continue; }
        const pn = pnRow.parsing_number;

        let remaining = parseInt((await db.query(
            `SELECT count(*) n FROM auction_lots
             WHERE auction_number = $1 AND (category IS NULL OR category = '')`, [auction])).rows[0].n, 10);
        console.log(`========== Аукцион ${auction} (Wolmar ID ${pn}); NULL-кат: ${remaining} ==========`);
        if (remaining === 0) { console.log('  уже заполнено — пропуск\n'); continue; }

        let aucUpdated = 0;
        for (const cat of categories) {
            const url = cat.url_template.replace('{AUCTION_NUMBER}', pn);
            let urls = [];
            try { urls = await getCategoryLotUrls(page, url); }
            catch (e) { console.log(`  ⚠️ ${cat.name}: ошибка сбора (${e.message})`); continue; }
            const lotIds = [...new Set(urls.map(lotIdFromUrl).filter(Boolean))];
            if (!lotIds.length) { await sleep(300); continue; }

            if (DRY) {
                const n = parseInt((await db.query(
                    `SELECT count(*) n FROM auction_lots
                     WHERE auction_number = $1 AND (category IS NULL OR category = '')
                       AND split_part(split_part(source_url, '?', 1), '/', 6) = ANY($2)`,
                    [auction, lotIds])).rows[0].n, 10);
                if (n > 0) console.log(`  [DRY] ${cat.name.padEnd(34)} ссылок ${lotIds.length} → заполнило бы ${n}`);
                aucUpdated += n;
            } else {
                const r = await db.query(
                    `UPDATE auction_lots
                       SET category = $1, source_category = $1, parsing_method = 'category_parser'
                     WHERE auction_number = $2 AND (category IS NULL OR category = '')
                       AND split_part(split_part(source_url, '?', 1), '/', 6) = ANY($3)`,
                    [cat.name, auction, lotIds]);
                if (r.rowCount > 0) {
                    console.log(`  ✓ ${cat.name.padEnd(34)} ссылок ${lotIds.length} → обновлено ${r.rowCount}`);
                    aucUpdated += r.rowCount;
                    remaining -= r.rowCount;
                }
                if (remaining <= 0) { console.log('  все NULL-кат заполнены — дальше категории не обходим'); break; }
            }
            await sleep(800); // вежливость к сайту
        }
        grandUpdated += aucUpdated;
        console.log(`---- Аукцион ${auction}: ${DRY ? 'заполнило бы' : 'обновлено'} ${aucUpdated}; осталось NULL-кат ~${Math.max(0, remaining)} ----\n`);
        await sleep(2000);
    }

    console.log(`==== ИТОГО: ${DRY ? 'заполнило бы' : 'обновлено'} ${grandUpdated} лотов ====`);
    try { await browser.close(); } catch (_) {}
    try { await db.end(); } catch (_) {}
    process.exit(0);
}
run().catch(e => { console.error('❌', e.message, '\n', e.stack); process.exit(1); });
