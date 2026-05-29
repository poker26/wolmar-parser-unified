/**
 * Догрузка цен на драгоценные металлы (ЦБ РФ) в таблицу metals_prices.
 *
 * Берёт последнюю дату в таблице и догружает всё, чего не хватает, по сегодня
 * включительно — одним диапазонным запросом к ЦБ (металлы + курс USD).
 * Подходит и для ежедневного крона, и для разового бэкфилла большой дыры.
 *
 * Запуск: node update-daily-metals.js
 * Код возврата != 0, если загрузка реально провалилась (для алертов крона).
 */

const MetalsPriceService = require('./metals-price-service');
const { Client } = require('pg');
const config = require('./config');

async function run() {
    const client = new Client(config.dbConfig);
    const service = new MetalsPriceService();

    await client.connect();

    const last = await client.query('SELECT MAX(date) AS mx FROM metals_prices');
    const lastDate = last.rows[0].mx ? new Date(last.rows[0].mx) : new Date('2025-01-01');

    const from = new Date(lastDate);
    from.setDate(from.getDate() + 1);
    const to = new Date();

    if (from > to) {
        console.log(`✅ metals_prices актуальны (последняя дата ${lastDate.toISOString().slice(0, 10)}), догружать нечего`);
        return;
    }

    const fromISO = from.toISOString().slice(0, 10);
    const toISO = to.toISOString().slice(0, 10);
    console.log(`📊 Догрузка цен металлов ЦБ РФ за период ${fromISO} .. ${toISO}`);

    const metals = await service.getMetalsPricesRange(from, to);
    if (!metals.length) {
        throw new Error(`ЦБ РФ вернул 0 строк по металлам за период ${fromISO}..${toISO} (возможно, изменилась вёрстка страницы)`);
    }

    const usdMap = await service.getUSDRatesRange(from, to);

    let saved = 0;
    for (const row of metals) {
        await client.query(`
            INSERT INTO metals_prices (date, usd_rate, gold_price, silver_price, platinum_price, palladium_price, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (date) DO UPDATE SET
                usd_rate = EXCLUDED.usd_rate,
                gold_price = EXCLUDED.gold_price,
                silver_price = EXCLUDED.silver_price,
                platinum_price = EXCLUDED.platinum_price,
                palladium_price = EXCLUDED.palladium_price,
                updated_at = NOW()
        `, [
            row.date,
            usdMap.has(row.date) ? usdMap.get(row.date) : null,
            row.gold,
            row.silver,
            row.platinum,
            row.palladium
        ]);
        saved++;
    }

    const newest = metals.reduce((a, b) => (a.date > b.date ? a : b));
    console.log(`✅ Сохранено/обновлено ${saved} дней. Свежая дата: ${newest.date} (Au=${newest.gold}, Ag=${newest.silver}, Pt=${newest.platinum}, Pd=${newest.palladium})`);
}

run()
    .catch(error => {
        console.error('❌ Ошибка догрузки цен металлов:', error.message);
        process.exitCode = 1;
    })
    .finally(() => {
        // Закрываем оба пула/клиента, чтобы процесс корректно завершился для крона.
        process.exit(process.exitCode || 0);
    });
