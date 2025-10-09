const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkWeightFields() {
    try {
        // Проверяем все поля, связанные с весом
        const tableInfo = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'auction_lots' 
            AND (column_name ILIKE '%weight%' OR column_name ILIKE '%вес%' OR column_name ILIKE '%масса%')
            ORDER BY ordinal_position
        `);
        
        console.log('📋 Поля, связанные с весом в auction_lots:');
        if (tableInfo.rows.length === 0) {
            console.log('  - Поля с весом не найдены');
        } else {
            tableInfo.rows.forEach(row => {
                console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
            });
        }
        
        // Проверяем несколько записей с разными значениями weight
        const weightStats = await pool.query(`
            SELECT 
                COUNT(*) as total_lots,
                COUNT(weight) as lots_with_weight,
                COUNT(*) - COUNT(weight) as lots_without_weight
            FROM auction_lots
        `);
        
        console.log('\n📊 Статистика по весу:');
        console.log(`  - Всего лотов: ${weightStats.rows[0].total_lots}`);
        console.log(`  - С весом: ${weightStats.rows[0].lots_with_weight}`);
        console.log(`  - Без веса: ${weightStats.rows[0].lots_without_weight}`);
        
        // Проверяем примеры лотов с весом
        const lotsWithWeight = await pool.query(`
            SELECT id, lot_number, coin_description, weight, metal
            FROM auction_lots
            WHERE weight IS NOT NULL
            ORDER BY id DESC
            LIMIT 5
        `);
        
        console.log('\n📋 Примеры лотов С весом:');
        lotsWithWeight.rows.forEach((lot, index) => {
            console.log(`  ${index + 1}. Лот ${lot.lot_number}: вес ${lot.weight}г, металл ${lot.metal}`);
            console.log(`     Описание: ${lot.coin_description?.substring(0, 80)}...`);
        });
        
        // Проверяем примеры лотов без веса
        const lotsWithoutWeight = await pool.query(`
            SELECT id, lot_number, coin_description, weight, metal
            FROM auction_lots
            WHERE weight IS NULL
            ORDER BY id DESC
            LIMIT 5
        `);
        
        console.log('\n📋 Примеры лотов БЕЗ веса:');
        lotsWithoutWeight.rows.forEach((lot, index) => {
            console.log(`  ${index + 1}. Лот ${lot.lot_number}: вес ${lot.weight}, металл ${lot.metal}`);
            console.log(`     Описание: ${lot.coin_description?.substring(0, 80)}...`);
        });
        
        // Проверяем, есть ли вес в описании у лотов без веса
        console.log('\n🔍 Поиск веса в описаниях лотов без веса:');
        for (const lot of lotsWithoutWeight.rows.slice(0, 3)) {
            if (lot.coin_description) {
                const weightMatch = lot.coin_description.match(/(\d+(?:[.,]\d+)?)\s*(?:гр|г|gram|g)/i);
                if (weightMatch) {
                    console.log(`  ✅ Лот ${lot.lot_number}: найден вес "${weightMatch[0]}" в описании`);
                } else {
                    console.log(`  ❌ Лот ${lot.lot_number}: вес в описании не найден`);
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

checkWeightFields();
