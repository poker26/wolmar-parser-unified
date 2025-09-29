const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkWeightLotsProcessed() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Проверка лотов с весом, которые были обработаны...\n');
        
        // Ищем лоты с весом, которые были обработаны
        const query = `
            SELECT cc.lot_id, cc.coin_name, cc.metal, cc.coin_weight, cc.fineness, cc.pure_metal_weight,
                   al.coin_description
            FROM coin_catalog cc
            JOIN auction_lots al ON cc.lot_id = al.id
            WHERE al.id >= 1391 AND al.id <= 1404
            ORDER BY cc.lot_id;
        `;
        
        const result = await client.query(query);
        
        console.log(`📊 Найдено обработанных лотов с весом: ${result.rows.length}\n`);
        
        for (const [index, row] of result.rows.entries()) {
            console.log(`--- Лот ${index + 1} ---`);
            console.log(`ID: ${row.lot_id}, Название: ${row.coin_name}, Металл: ${row.metal}`);
            console.log(`Вес: ${row.coin_weight}г, Проба: ${row.fineness}, Чистый: ${row.pure_metal_weight}г`);
            console.log(`Описание: ${row.coin_description.substring(0, 100)}...`);
            
            // Проверяем, есть ли в описании упоминания веса
            const weightMentions = row.coin_description.match(/\b(нормативный\s+вес|средний\s+вес|вес|гр|oz)\b/gi);
            if (weightMentions) {
                console.log(`🎯 Найденные упоминания веса: ${weightMentions.join(', ')}`);
            } else {
                console.log(`❌ Упоминания веса не найдены`);
            }
            console.log('');
        }
        
    } catch (error) {
        console.error('❌ Ошибка при проверке лотов с весом:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

checkWeightLotsProcessed();
