const WolmarCategoryParser = require('./wolmar-category-parser');
const config = require('./config');
const { Pool } = require('pg');

async function debugDatabaseSave() {
    console.log('🔍 ДИАГНОСТИКА СОХРАНЕНИЯ В БД');
    console.log('================================');
    
    const pool = new Pool(config.dbConfig);
    const parser = new WolmarCategoryParser(config.dbConfig, 'debug', 2070);
    
    try {
        console.log('\n1️⃣ Инициализируем парсер...');
        await parser.init();
        
        console.log('\n2️⃣ Проверяем количество лотов в категории "Боны" для аукциона 2070...');
        const result = await pool.query(`
            SELECT COUNT(*) as count 
            FROM auction_lots 
            WHERE auction_number = '2070' AND category = 'Боны'
        `);
        console.log(`📊 Лотов в БД для аукциона 2070, категория "Боны": ${result.rows[0].count}`);
        
        console.log('\n3️⃣ Проверяем последние добавленные лоты...');
        const recentLots = await pool.query(`
            SELECT lot_number, category, coin_description, created_at
            FROM auction_lots 
            WHERE auction_number = '2070'
            ORDER BY created_at DESC 
            LIMIT 10
        `);
        console.log('📋 Последние 10 лотов в БД:');
        recentLots.rows.forEach((lot, index) => {
            console.log(`   ${index + 1}. Лот ${lot.lot_number} | ${lot.category} | ${lot.coin_description?.substring(0, 50)}...`);
        });
        
        console.log('\n4️⃣ Проверяем все категории для аукциона 2070...');
        const categories = await pool.query(`
            SELECT category, COUNT(*) as count
            FROM auction_lots 
            WHERE auction_number = '2070'
            GROUP BY category
            ORDER BY count DESC
        `);
        console.log('📊 Категории в БД для аукциона 2070:');
        categories.rows.forEach(cat => {
            console.log(`   ${cat.category}: ${cat.count} лотов`);
        });
        
        console.log('\n5️⃣ Тестируем сохранение тестового лота...');
        const testLotData = {
            auctionNumber: '2070',
            lotNumber: 'TEST_DEBUG',
            coinDescription: 'Тестовый лот для диагностики',
            images: ['https://example.com/test.jpg'],
            winningBid: '1000',
            winnerLogin: 'test_user',
            bidsCount: '1',
            lotStatus: 'closed',
            year: '2025',
            letters: 'ТЕСТ',
            metal: 'Au',
            condition: 'UNC',
            sourceUrl: 'https://test.com',
            sourceCategory: 'Боны',
            parsingMethod: 'debug_test',
            aversImageUrl: 'https://example.com/test.jpg',
            reversImageUrl: 'https://example.com/test2.jpg',
            category: 'Боны',
            categoryConfidence: 1
        };
        
        console.log('💾 Пытаемся сохранить тестовый лот...');
        try {
            await parser.saveLotToDatabase(testLotData);
            console.log('✅ Тестовый лот сохранен успешно');
            
            // Проверяем, что лот действительно сохранился
            const testResult = await pool.query(`
                SELECT * FROM auction_lots 
                WHERE auction_number = '2070' AND lot_number = 'TEST_DEBUG'
            `);
            
            if (testResult.rows.length > 0) {
                console.log('✅ Тестовый лот найден в БД');
                console.log(`   Категория: ${testResult.rows[0].category}`);
                console.log(`   Описание: ${testResult.rows[0].coin_description}`);
            } else {
                console.log('❌ Тестовый лот НЕ найден в БД');
            }
            
            // Удаляем тестовый лот
            await pool.query(`
                DELETE FROM auction_lots 
                WHERE auction_number = '2070' AND lot_number = 'TEST_DEBUG'
            `);
            console.log('🗑️ Тестовый лот удален');
            
        } catch (saveError) {
            console.error('❌ Ошибка сохранения тестового лота:', saveError.message);
            console.error('❌ Стек ошибки:', saveError.stack);
        }
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error.message);
        console.error('❌ Стек ошибки:', error.stack);
    } finally {
        if (parser.browser) {
            await parser.browser.close();
        }
        if (parser.dbClient) {
            await parser.dbClient.end();
        }
        await pool.end();
    }
}

if (require.main === module) {
    debugDatabaseSave();
}
