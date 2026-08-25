// Одноразовый триггер дофинализации ставок по списку завершённых аукционов.
// Fire-and-forget: запускает Temporal-воркфлоу и сразу выходит (воркфлоу живёт на воркере).
// Запуск: node temporal/trigger-bid-refresh.js [995 976 ...]   (без аргументов — дефолтный список)
'use strict';
const { startBidRefresh } = require('./client');

const DEFAULT = ['995', '976', '975', '977', '972', '980', '797', '790'];

(async () => {
    const args = process.argv.slice(2).filter((x) => /^\d+$/.test(x));
    const auctions = args.length ? args : DEFAULT;
    const r = await startBidRefresh(auctions);
    console.log('bid-refresh запущен:', JSON.stringify(r));
    console.log('аукционы (последовательно):', auctions.join(', '));
    process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
