// Запуск/прогресс/стоп харвеста meshok (Temporal, очередь wolmar-meshok).
//   node temporal/start-meshok-harvest.js               — обычный проход (свежие страницы, по расписанию)
//   node temporal/start-meshok-harvest.js backfill      — глубокий разовый проход до конца пагинации
//   node temporal/start-meshok-harvest.js progress [backfill]
//   node temporal/start-meshok-harvest.js stop [backfill]
'use strict';

const { Connection, Client } = require('@temporalio/client');
const { ADDRESS, NAMESPACE, MESHOK_TASK_QUEUE, MESHOK_PAGES_BEFORE_CONTINUE, meshokHarvestWorkflowId } = require('./shared');
const { meshokHarvestWorkflow } = require('./meshok-workflows');

// Категории meshok (из JSON-дерева сайта).
const CATS = [
    { label: 'modern',   cat: '14712' },   // Россия с 1997: памятные/погодовка (лучший выход по сделкам)
    { label: 'commemor', cat: '15401' },   // Юбилейные и памятные
    { label: 'invest',   cat: '16491' },   // Инвестиционные
    { label: 'euro',     cat: '16351' },   // Европейские
    { label: 'east',     cat: '16350' },   // Восточные
    { label: 'ussr',     cat: '1106'  },   // СССР
    { label: 'imperial', cat: '1105'  },   // Россия 1682-1917
    { label: 'rf1997',   cat: '1680'  },   // Россия с 1997 (шире)
];

// SOLD (opt=2, лоты со ставками) — состоявшиеся сделки, ради них всё и затевалось: история проходов
// и маркетплейс-медианы. ACTIVE (opt=1) — «доступно сейчас» и «Недооценённые». Сначала сделки.
// Замер 26.08 (страница на категорию): модерн 17 из 20 лотов со ставками, СССР 6 из 40,
// имперские 12 из 40 — выход разный, но сделки есть везде.
const buildTargets = (maxPages) => [
    ...CATS.map((c) => ({ label: `${c.label}-sold`, cat: c.cat, mode: 'sold', maxPages })),
    ...CATS.map((c) => ({ label: `${c.label}-active`, cat: c.cat, mode: 'active', maxPages })),
];

// Пагинация разобрана 26.08: pp=200 лотов на запрос, pN=смещение в лотах (см. ingest-meshok.js).
// Обычный проход берёт 2 страницы = 400 свежих лотов на цель (16 целей ≈ 1k кредитов),
// backfill идёт вглубь до конца выдачи (модерн-РФ ~2145 сделок = 11 страниц).
const SHALLOW_PAGES = parseInt(process.env.MESHOK_SHALLOW_PAGES, 10) || 2;
const DEEP_PAGES = parseInt(process.env.MESHOK_DEEP_PAGES, 10) || 60;

async function main() {
    const cmd = process.argv[2] || 'start';
    const deep = cmd === 'backfill' || process.argv[3] === 'backfill';
    const key = deep ? 'backfill' : 'all';
    const connection = await Connection.connect({ address: ADDRESS });
    const client = new Client({ connection, namespace: NAMESPACE });
    const workflowId = meshokHarvestWorkflowId(key);
    const handle = client.workflow.getHandle(workflowId);

    if (cmd === 'progress') {
        const desc = await handle.describe();
        let p = null;
        if (desc.status.name === 'RUNNING') { try { p = await handle.query('progress'); } catch (_) {} }
        console.log('status:', desc.status.name);
        console.log(JSON.stringify(p, null, 1));
    } else if (cmd === 'stop') {
        await handle.cancel();
        console.log('cancelled', workflowId);
    } else {
        // Запускается и по расписанию: если прошлый прогон ещё идёт, просто выходим без ошибки.
        let running = false;
        try { running = (await handle.describe()).status.name === 'RUNNING'; } catch (_) { /* воркфлоу нет — стартуем */ }
        if (running) {
            console.log('уже идёт', workflowId, '— повторный запуск не нужен');
        } else {
            const targets = buildTargets(deep ? DEEP_PAGES : SHALLOW_PAGES);
            const h = await client.workflow.start(meshokHarvestWorkflow, {
                taskQueue: MESHOK_TASK_QUEUE,
                workflowId,
                args: [{ targets, pagesBeforeContinue: MESHOK_PAGES_BEFORE_CONTINUE }],
            });
            console.log('started', h.workflowId, 'run', h.firstExecutionRunId,
                '| целей:', targets.length, '| страниц на цель:', deep ? DEEP_PAGES : SHALLOW_PAGES);
        }
    }
    await connection.close();
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
