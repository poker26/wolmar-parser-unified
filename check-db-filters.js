#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'wolmar',
    password: 'postgres',
    port: 5432,
});

async function checkDbFilters() {
    console.log('🔍 Проверяем данные в базе...\n');
    
    try {
        // Проверяем countries
        console.log('1. Countries:');
        const countriesResult = await pool.query(`
            SELECT country, COUNT(*) as count 
            FROM coin_catalog 
            WHERE country IS NOT NULL AND country != ''
            GROUP BY country 
            ORDER BY count DESC
            LIMIT 10
        `);
        console.log('   Найдено записей:', countriesResult.rows.length);
        countriesResult.rows.forEach(row => {
            console.log(`   "${row.country}": ${row.count}`);
        });
        
        // Проверяем rarities
        console.log('\n2. Rarities:');
        const raritiesResult = await pool.query(`
            SELECT rarity, COUNT(*) as count 
            FROM coin_catalog 
            WHERE rarity IS NOT NULL AND rarity != ''
            GROUP BY rarity 
            ORDER BY count DESC
            LIMIT 10
        `);
        console.log('   Найдено записей:', raritiesResult.rows.length);
        raritiesResult.rows.forEach(row => {
            console.log(`   "${row.rarity}": ${row.count}`);
        });
        
        // Проверяем общую статистику
        console.log('\n3. Общая статистика:');
        const totalResult = await pool.query('SELECT COUNT(*) as total FROM coin_catalog');
        const withCountryResult = await pool.query('SELECT COUNT(*) as with_country FROM coin_catalog WHERE country IS NOT NULL AND country != \'\'');
        const withRarityResult = await pool.query('SELECT COUNT(*) as with_rarity FROM coin_catalog WHERE rarity IS NOT NULL AND rarity != \'\'');
        
        console.log(`   Всего записей: ${totalResult.rows[0].total}`);
        console.log(`   С страной: ${withCountryResult.rows[0].with_country}`);
        console.log(`   С редкостью: ${withRarityResult.rows[0].with_rarity}`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

checkDbFilters();




