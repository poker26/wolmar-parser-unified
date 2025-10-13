/**
 * Скрипт для проверки структуры таблицы auction_lots
 */

const { Pool } = require('pg');

const dbConfig = {
    user: 'postgres.xkwgspqwebfeteoblayu',
    host: 'aws-0-eu-north-1.pooler.supabase.com',
    database: 'postgres',
    password: 'Gopapopa326+',
    port: 6543,
    ssl: { rejectUnauthorized: false }
};

async function checkTableStructure() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔍 Проверяем структуру таблицы auction_lots...');
        
        // Получаем структуру таблицы
        const result = await db.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'auction_lots' 
            ORDER BY ordinal_position
        `);
        
        console.log('\n📋 Структура таблицы auction_lots:');
        result.rows.forEach(row => {
            console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
        });
        
        // Проверяем, есть ли поле winner_login
        const winnerField = result.rows.find(row => 
            row.column_name === 'winner_login' || 
            row.column_name === 'winner_nick' ||
            row.column_name === 'winner'
        );
        
        if (winnerField) {
            console.log(`\n✅ Найдено поле для победителя: ${winnerField.column_name}`);
        } else {
            console.log('\n❌ Поле для победителя не найдено!');
        }
        
        // Проверяем количество записей
        const countResult = await db.query('SELECT COUNT(*) as total FROM auction_lots');
        console.log(`\n📊 Всего записей в таблице: ${countResult.rows[0].total}`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await db.end();
    }
}

checkTableStructure();