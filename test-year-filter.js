#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'wolmar',
    password: 'postgres',
    port: 5432,
});

async function testYearFilter() {
    console.log('🔍 Тестирование фильтра по годам...\n');
    
    try {
        // 1. Проверяем, есть ли данные с годами
        console.log('1. Проверяем наличие данных с годами:');
        const yearCheck = await pool.query(`
            SELECT 
                coin_year,
                COUNT(*) as count
            FROM coin_catalog 
            WHERE coin_year IS NOT NULL 
            GROUP BY coin_year 
            ORDER BY coin_year 
            LIMIT 10
        `);
        
        console.log('   Найденные годы:', yearCheck.rows);
        
        // 2. Тестируем фильтр по годам (например, 1900-1950)
        console.log('\n2. Тестируем фильтр 1900-1950:');
        const filteredData = await pool.query(`
            SELECT 
                id,
                coin_name,
                coin_year,
                coin_weight,
                fineness
            FROM coin_catalog 
            WHERE coin_year >= 1900 AND coin_year <= 1950
            ORDER BY coin_year
            LIMIT 5
        `);
        
        console.log('   Результат фильтра:', filteredData.rows);
        
        // 3. Проверяем общее количество записей
        console.log('\n3. Общая статистика:');
        const totalCount = await pool.query('SELECT COUNT(*) as total FROM coin_catalog');
        const withYearCount = await pool.query('SELECT COUNT(*) as with_year FROM coin_catalog WHERE coin_year IS NOT NULL');
        
        console.log(`   Всего записей: ${totalCount.rows[0].total}`);
        console.log(`   С годом: ${withYearCount.rows[0].with_year}`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

testYearFilter();






