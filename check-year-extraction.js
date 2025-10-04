#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'wolmar',
    password: 'postgres',
    port: 5432,
});

async function checkYearExtraction() {
    console.log('🔍 Проверяем извлечение годов из описаний...\n');
    
    try {
        // 1. Проверяем описания с годами
        console.log('1. Ищем описания с годами:');
        const yearDescriptions = await pool.query(`
            SELECT 
                id,
                original_description,
                coin_year
            FROM coin_catalog 
            WHERE original_description ~ '[0-9]{4}'
            LIMIT 10
        `);
        
        console.log('   Найденные описания с годами:');
        yearDescriptions.rows.forEach(row => {
            console.log(`   ID ${row.id}: "${row.original_description}" -> год: ${row.coin_year}`);
        });
        
        // 2. Проверяем, есть ли записи с извлеченными годами
        console.log('\n2. Записи с извлеченными годами:');
        const withYears = await pool.query(`
            SELECT 
                id,
                original_description,
                coin_year
            FROM coin_catalog 
            WHERE coin_year IS NOT NULL
            LIMIT 5
        `);
        
        console.log(`   Найдено записей с годами: ${withYears.rows.length}`);
        withYears.rows.forEach(row => {
            console.log(`   ID ${row.id}: "${row.original_description}" -> год: ${row.coin_year}`);
        });
        
        // 3. Статистика
        console.log('\n3. Статистика:');
        const totalCount = await pool.query('SELECT COUNT(*) as total FROM coin_catalog');
        const withYearCount = await pool.query('SELECT COUNT(*) as with_year FROM coin_catalog WHERE coin_year IS NOT NULL');
        const withYearInDesc = await pool.query(`SELECT COUNT(*) as with_year_in_desc FROM coin_catalog WHERE original_description ~ '[0-9]{4}'`);
        
        console.log(`   Всего записей: ${totalCount.rows[0].total}`);
        console.log(`   С извлеченным годом: ${withYearCount.rows[0].with_year}`);
        console.log(`   С годом в описании: ${withYearInDesc.rows[0].with_year_in_desc}`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

checkYearExtraction();




