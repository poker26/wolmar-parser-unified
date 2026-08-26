// Запуск/прогресс/стоп харвеста meshok (Temporal, очередь wolmar-meshok).
//   node temporal/start-meshok-harvest.js               — обычный проход (свежие страницы, по расписанию)
//   node temporal/start-meshok-harvest.js backfill      — глубокий разовый проход до конца пагинации
//   node temporal/start-meshok-harvest.js progress [backfill]
//   node temporal/start-meshok-harvest.js stop [backfill]
'use strict';

const { Connection, Client } = require('@temporalio/client');
const { ADDRESS, NAMESPACE, MESHOK_TASK_QUEUE, MESHOK_PAGES_BEFORE_CONTINUE, meshokHarvestWorkflowId } = require('./shared');
const { meshokHarvestWorkflow } = require('./meshok-workflows');

// Категории meshok (сверено с деревом сайта 26.08; в скобках — сколько всего лотов в разделе).
// Родительский раздел включает подразделы, поэтому берём верхний уровень, а не каждую страну.
// ЗАРУБЕЖКА ИДЁТ ПЕРВОЙ: у нас 57.7k иностранных типов почти без цен — это главный пробел
// каталога, а на мешке только по Европе около 49.8k состоявшихся сделок.
const CATS = [
    { label: 'europe',    cat: '1256'  },   // Европа (459 798)
    { label: 'america',   cat: '1679'  },   // Америка (165 242)
    { label: 'asia',      cat: '1592'  },   // Азия (158 149)
    { label: 'africa',    cat: '1591'  },   // Африка (94 314)
    { label: 'eurozone',  cat: '13309' },   // Евро (65 711)
    { label: 'australia', cat: '1605'  },   // Австралия и Океания (49 594)
    { label: 'uk',        cat: '2140'  },   // Великобритания (45 376)
    { label: 'mideast',   cat: '2160'  },   // Ближний Восток (44 551)
    { label: 'antique',   cat: '1832'  },   // Античные (21 914)
    { label: 'horde',     cat: '2178'  },   // Золотая Орда (11 135)
    // Отечественное
    { label: 'ussr',      cat: '1106'  },   // СССР 1917-1991 (330 045)
    { label: 'imperial',  cat: '1105'  },   // Россия 1682-1917 (272 105)
    { label: 'commemor',  cat: '15401' },   // Юбилейные и памятные (160 337)
    { label: 'rf1997',    cat: '1680'  },   // Россия с 1997 (79 804)
    { label: 'pre1699',   cat: '1800'  },   // Россия до 1699 (27 986)
    { label: 'rf1991',    cat: '14702' },   // Россия 1991-1996 (17 779)
    // Узкие разделы. 16350/16351 — это подразделы СРЕДНЕВЕКОВЬЯ, а не «зарубежные монеты»:
    // в старом конфиге они были подписаны неверно и создавали иллюзию покрытия зарубежки.
    { label: 'medieval-east', cat: '16350' },   // Средневековье → Восточные (7 641)
    { label: 'medieval-euro', cat: '16351' },   // Средневековье → Европейские (4 949)
    { label: 'invest',        cat: '16491' },   // Инвестиционные (886)
];

// SOLD (opt=2, лоты со ставками) — состоявшиеся сделки, ради них всё и затевалось: история проходов
// и маркетплейс-медианы. ACTIVE (opt=1) — «доступно сейчас» и «Недооценённые». Сначала сделки.
// Замер 26.08 (страница на категорию): модерн 17 из 20 лотов со ставками, СССР 6 из 40,
// имперские 12 из 40 — выход разный, но сделки есть везде.
// Вглубь имеет смысл идти только по сделкам: это история, она конечна и накапливается.
// Активные лоты — срез «прямо сейчас», их берём верхушкой (400 свежих на раздел) в любом режиме:
// выкачивать все 460k открытых лотов Европы бессмысленно и стоило бы 69k кредитов.
const ACTIVE_PAGES = 2;
const buildTargets = (soldPages) => [
    ...CATS.map((c) => ({ label: `${c.label}-sold`, cat: c.cat, mode: 'sold', maxPages: soldPages })),
    ...CATS.map((c) => ({ label: `${c.label}-active`, cat: c.cat, mode: 'active', maxPages: ACTIVE_PAGES })),
];

// Пагинация разобрана 26.08: pp=200 лотов на запрос, pN=смещение в лотах (см. ingest-meshok.js).
// Обычный проход — 2 страницы (400 свежих лотов) на цель. Глубокий добор истории идёт до конца
// выдачи: замеры показывают СССР 40-60k сделок, имперские 40k+, Европа ~49.8k → 300 страниц
// (60k лотов) хватает с запасом на самые толстые разделы.
const SHALLOW_PAGES = parseInt(process.env.MESHOK_SHALLOW_PAGES, 10) || 2;
const DEEP_PAGES = parseInt(process.env.MESHOK_DEEP_PAGES, 10) || 300;

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
