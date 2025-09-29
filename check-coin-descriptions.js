#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'wolmar',
    password: 'postgres',
    port: 5432,
});

async function checkCoinDescriptions() {
    console.log('🔍 Анализируем описания монет...\n');
    
    try {
        // Получаем случайные описания
        console.log('1. Случайные описания монет:');
        const descriptions = await pool.query(`
            SELECT 
                id,
                denomination,
                coin_name,
                country,
                original_description
            FROM coin_catalog 
            ORDER BY RANDOM()
            LIMIT 20
        `);
        
        descriptions.rows.forEach((row, index) => {
            console.log(`${index + 1}. ID ${row.id}: "${row.original_description}"`);
            console.log(`   Номинал: ${row.denomination}, Страна: ${row.country || 'не указана'}`);
            console.log('');
        });
        
        // Ищем российские монеты по номиналу
        console.log('\n2. Поиск российских монет (рубли, копейки):');
        const russianCoins = await pool.query(`
            SELECT 
                id,
                denomination,
                country,
                original_description
            FROM coin_catalog 
            WHERE original_description ~* '\\b(рублей?|копеек?|руб\\.?|коп\\.?)\\b'
            LIMIT 10
        `);
        
        console.log(`   Найдено российских монет: ${russianCoins.rows.length}`);
        russianCoins.rows.forEach((row, index) => {
            console.log(`${index + 1}. ID ${row.id}: "${row.original_description}"`);
            console.log(`   Страна: ${row.country || 'не указана'}`);
            console.log('');
        });
        
        // Статистика по номиналам
        console.log('\n3. Статистика по номиналам:');
        const denominationStats = await pool.query(`
            SELECT 
                denomination,
                COUNT(*) as count,
                COUNT(CASE WHEN country IS NOT NULL THEN 1 END) as with_country
            FROM coin_catalog 
            GROUP BY denomination
            ORDER BY count DESC
            LIMIT 15
        `);
        
        denominationStats.rows.forEach(row => {
            const countryPercent = ((row.with_country / row.count) * 100).toFixed(1);
            console.log(`   ${row.denomination}: ${row.count} монет, ${row.with_country} со страной (${countryPercent}%)`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

checkCoinDescriptions();
