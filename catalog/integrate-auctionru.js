/**
 * Совместимая точка запуска старой интеграции auction.ru.
 *
 * Раньше этот файл публиковал типы непосредственно в coin_type со статусом confirmed.
 * Теперь все сохранённые карточки, независимо от результата торгов, проходят общий матчер;
 * настоящий пробел попадает в закрытую очередь catalog_candidate с исходным lot_id.
 */
'use strict';

const { main } = require('./ingest-auctionru-active');

if (require.main === module) main().catch((error) => {
    console.error('FATAL', error.message);
    process.exit(1);
});

module.exports = { main };
