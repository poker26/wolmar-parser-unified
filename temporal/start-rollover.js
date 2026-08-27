// Крон-точка входа для смены аукциона (очередь wolmar-parser).
//   node temporal/start-rollover.js                  — обычный ночной прогон
//   node temporal/start-rollover.js plan             — показать план и НИЧЕГО не запускать
//   node temporal/start-rollover.js progress|stop
//   node temporal/start-rollover.js --force          — перепарсить/пересчитать, даже если не нужно
//   node temporal/start-rollover.js --all --max-finalize=3
//                                                    — разобрать хвост старых незакрытых аукционов
//
// Идемпотентность: workflowId один на всю систему ('auction-rollover'). Если прогон
// уже идёт — пишем «уже идёт» и выходим с кодом 0, чтобы cron не плодил дубли.
'use strict';

const { startRollover, getRolloverProgress, stopRollover, listActive } = require('./client');

function intArg(name) {
    const a = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`));
    return a ? parseInt(a.split('=')[1], 10) : undefined;
}

(async () => {
    const args = process.argv.slice(2);
    const cmd = args.find((a) => ['plan', 'progress', 'stop'].includes(a)) || 'start';

    if (cmd === 'progress') {
        console.log(JSON.stringify(await getRolloverProgress(), null, 2));
        return;
    }
    if (cmd === 'stop') {
        console.log(JSON.stringify(await stopRollover()));
        return;
    }

    const options = {
        force: args.includes('--force'),
        finalizeAll: args.includes('--all'),
        maxFinalize: intArg('max-finalize'),
        finalizeMaxAgeDays: intArg('max-age'),
    };

    if (cmd === 'plan') {
        // Сухой прогон: план считает тот же код, что и воркфлоу, но шаги не запускаются.
        const { planRollover } = require('./rollover-activities');
        console.log(JSON.stringify(await planRollover(options), null, 2));
        return;
    }

    // Парсер-воркер владеет ОДНИМ headless-Chrome, а singleton-парсер пересоздаёт браузер
    // при смене номера аукциона. Если рядом уже идёт чей-то разбор (запустили руками из
    // админки), смена аукциона начала бы дёргать браузер туда-сюда на каждом чанке.
    // Поэтому просто уступаем и ждём следующего запуска по расписанию.
    try {
        const { tasks } = await listActive();
        const busy = tasks.filter((t) => t.type === 'parse' || t.type === 'bid-refresh');
        if (busy.length) {
            console.log('парсер занят другой задачей — пропускаем:', busy.map((t) => t.workflowId).join(', '));
            return;
        }
    } catch (e) {
        console.error('не удалось проверить активные задачи:', e.message);
    }

    try {
        const r = await startRollover(options);
        console.log('смена аукциона запущена:', JSON.stringify(r));
    } catch (e) {
        if (/already started|WorkflowExecutionAlreadyStarted/i.test(e.message)) {
            console.log('смена аукциона уже идёт — пропускаем');
            return;
        }
        throw e;
    }
})().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e.message); process.exit(1); });
