const { Pool } = require('pg');
const config = require('./config');

async function testFiltersData() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Проверяем данные для фильтров...');
        
        // Проверяем общее количество лотов
        const totalLots = await pool.query('SELECT COUNT(*) FROM auction_lots');
        console.log(`📊 Всего лотов в базе: ${totalLots.rows[0].count}`);
        
        // Проверяем лоты с металлом
        const lotsWithMetal = await pool.query(`
            SELECT COUNT(*) FROM auction_lots 
            WHERE metal IS NOT NULL AND metal != ''
        `);
        console.log(`🥇 Лотов с указанным металлом: ${lotsWithMetal.rows[0].count}`);
        
        // Проверяем уникальные металлы
        const metals = await pool.query(`
            SELECT DISTINCT metal, COUNT(*) as count
            FROM auction_lots 
            WHERE metal IS NOT NULL AND metal != ''
            GROUP BY metal
            ORDER BY count DESC
        `);
        console.log('🥇 Уникальные металлы:');
        metals.rows.forEach(row => {
            console.log(`   ${row.metal}: ${row.count} лотов`);
        });
        
        // Проверяем уникальные состояния
        const conditions = await pool.query(`
            SELECT DISTINCT condition, COUNT(*) as count
            FROM auction_lots 
            WHERE condition IS NOT NULL AND condition != ''
            GROUP BY condition
            ORDER BY count DESC
        `);
        console.log('💎 Уникальные состояния:');
        conditions.rows.forEach(row => {
            console.log(`   ${row.condition}: ${row.count} лотов`);
        });
        
        // Проверяем последние аукционы
        const recentAuctions = await pool.query(`
            SELECT auction_number, COUNT(*) as lots_count
            FROM auction_lots 
            GROUP BY auction_number
            ORDER BY auction_number DESC
            LIMIT 5
        `);
        console.log('🏆 Последние 5 аукционов:');
        recentAuctions.rows.forEach(row => {
            console.log(`   Аукцион ${row.auction_number}: ${row.lots_count} лотов`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

testFiltersData();
