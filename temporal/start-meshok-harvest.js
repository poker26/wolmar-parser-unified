// Запуск/прогресс/стоп харвеста meshok (Temporal, очередь wolmar-meshok).
//   node temporal/start-meshok-harvest.js          — старт (или присоединиться к идущему)
//   node temporal/start-meshok-harvest.js progress  — прогресс
//   node temporal/start-meshok-harvest.js stop      — отменить
'use strict';

const { Connection, Client } = require('@temporalio/client');
const { ADDRESS, NAMESPACE, MESHOK_TASK_QUEUE, MESHOK_PAGES_BEFORE_CONTINUE, meshokHarvestWorkflowId } = require('./shared');
const { meshokHarvestWorkflow } = require('./meshok-workflows');

// Цели по убыванию ценности (из калибровки: модерн sold-выход ~35%, СССР ~7.5%, имперские ~0%).
// SOLD (opt=2) первыми — приоритет прогнозирования; затем ACTIVE (opt=1) для «Недооценённых».
// Воркфлоу пагинирует каждую категорию до пустой страницы. Порядок = приоритет при раннем стопе.
// ТОЛЬКО active (opt=1) — для «доступно сейчас»/deals. sold-харвест признан низко-рентабельным
// (большинство meshok-finished без ставок) + жёг кредиты на зацикливании. Терминация теперь по «0 новых».
const TARGETS = [
    { label: 'modern-active',   cat: '14712', opt: '1' },   // Россия с 1997 (памятные/погодовка)
    { label: 'commemor-active', cat: '15401', opt: '1' },   // Юбилейные и памятные
    { label: 'invest-active',   cat: '16491', opt: '1' },   // Инвестиционные
    { label: 'euro-active',     cat: '16351', opt: '1' },   // Европейские
    { label: 'east-active',     cat: '16350', opt: '1' },   // Восточные
    { label: 'ussr-active',     cat: '1106',  opt: '1' },   // СССР
    { label: 'imperial-active', cat: '1105',  opt: '1' },   // Россия 1682-1917
    { label: 'rf1997-active',   cat: '1680',  opt: '1' },   // Россия с 1997 (шире)
];

async function main() {
    const cmd = process.argv[2] || 'start';
    const connection = await Connection.connect({ address: ADDRESS });
    const client = new Client({ connection, namespace: NAMESPACE });
    const workflowId = meshokHarvestWorkflowId('all');
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
            const h = await client.workflow.start(meshokHarvestWorkflow, {
                taskQueue: MESHOK_TASK_QUEUE,
                workflowId,
                args: [{ targets: TARGETS, pagesBeforeContinue: MESHOK_PAGES_BEFORE_CONTINUE }],
            });
            console.log('started', h.workflowId, 'run', h.firstExecutionRunId, '| целей:', TARGETS.length);
        }
    }
    await connection.close();
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
