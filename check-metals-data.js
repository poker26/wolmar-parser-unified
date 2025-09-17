const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkMetalsData() {
    try {
        console.log('📊 Проверяем данные в таблице metals_prices...');
        
        const query = `
            SELECT 
                COUNT(*) as total_records,
                COUNT(gold_price) as gold_records,
                COUNT(silver_price) as silver_records,
                COUNT(platinum_price) as platinum_records,
                COUNT(palladium_price) as palladium_records,
                MIN(date) as earliest_date,
                MAX(date) as latest_date
            FROM metals_prices
        `;
        
        const result = await pool.query(query);
        const stats = result.rows[0];
        
        console.log('📈 Статистика:');
        console.log(`   - Всего записей: ${stats.total_records}`);
        console.log(`   - С ценой на золото: ${stats.gold_records}`);
        console.log(`   - С ценой на серебро: ${stats.silver_records}`);
        console.log(`   - С ценой на платину: ${stats.platinum_records}`);
        console.log(`   - С ценой на палладий: ${stats.palladium_records}`);
        console.log(`   - Период: ${stats.earliest_date} - ${stats.latest_date}`);
        
        // Показываем последние 5 записей
        const recentQuery = `
            SELECT date, usd_rate, gold_price, silver_price, platinum_price, palladium_price 
            FROM metals_prices 
            ORDER BY date DESC 
            LIMIT 5
        `;
        
        const recentResult = await pool.query(recentQuery);
        
        console.log('\n📋 Последние 5 записей:');
        recentResult.rows.forEach(row => {
            console.log(`   ${row.date}: USD=${row.usd_rate}, Au=${row.gold_price || 'N/A'}, Ag=${row.silver_price || 'N/A'}, Pt=${row.platinum_price || 'N/A'}, Pd=${row.palladium_price || 'N/A'}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

checkMetalsData();
