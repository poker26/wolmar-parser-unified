/**
 * Скрипт для проверки реальной структуры таблицы auction_lots в базе данных
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

async function checkRealTableStructure() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔍 Проверяем реальную структуру таблицы auction_lots...');
        
        // Получаем структуру таблицы
        const result = await db.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'auction_lots' 
            ORDER BY ordinal_position
        `);
        
        console.log('\n📋 Реальная структура таблицы auction_lots:');
        result.rows.forEach(row => {
            console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
        });
        
        // Проверяем, есть ли данные в таблице
        const countResult = await db.query('SELECT COUNT(*) as total FROM auction_lots');
        console.log(`\n📊 Всего записей в таблице: ${countResult.rows[0].total}`);
        
        // Если есть данные, показываем пример записи
        if (countResult.rows[0].total > 0) {
            const sampleResult = await db.query('SELECT * FROM auction_lots LIMIT 1');
            console.log('\n📝 Пример записи:');
            Object.keys(sampleResult.rows[0]).forEach(key => {
                console.log(`  ${key}: ${sampleResult.rows[0][key]}`);
            });
        }
        
        // Проверяем, какие поля используются в существующих скриптах анализа
        console.log('\n🔍 Поля, используемые в существующих скриптах анализа:');
        const analysisFields = [
            'winner_nick', 'seller_nick', 'final_price', 'starting_price', 
            'lot_description', 'lot_category', 'auction_id'
        ];
        
        analysisFields.forEach(field => {
            const exists = result.rows.find(row => row.column_name === field);
            if (exists) {
                console.log(`  ✅ ${field}: существует`);
            } else {
                console.log(`  ❌ ${field}: НЕ существует`);
            }
        });
        
        // Проверяем, какие поля есть в таблице, но не используются в анализе
        console.log('\n🔍 Поля в таблице, которые могут соответствовать полям анализа:');
        const possibleMappings = {
            'winner_nick': ['winner_login', 'winner'],
            'seller_nick': ['seller_login', 'seller'],
            'final_price': ['winning_bid', 'final_bid'],
            'starting_price': ['starting_bid', 'min_price'],
            'lot_description': ['coin_description', 'description'],
            'lot_category': ['category', 'lot_type'],
            'auction_id': ['auction_number', 'auction_id']
        };
        
        Object.entries(possibleMappings).forEach(([analysisField, possibleFields]) => {
            const found = possibleFields.find(field => 
                result.rows.find(row => row.column_name === field)
            );
            if (found) {
                console.log(`  ${analysisField} → ${found}`);
            } else {
                console.log(`  ${analysisField} → НЕ НАЙДЕНО`);
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await db.end();
    }
}

checkRealTableStructure();
