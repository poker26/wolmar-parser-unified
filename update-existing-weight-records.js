const { Pool } = require('pg');
const config = require('./config');
const CatalogParser = require('./catalog-parser.js');

const pool = new Pool(config.dbConfig);

async function updateExistingWeightRecords() {
    const parser = new CatalogParser();
    
    try {
        await parser.init();
        
        const client = await pool.connect();
        
        console.log('🔄 Обновление существующих записей с полями веса...\n');
        
        // Находим записи с упоминанием веса в описании, но без заполненных полей веса
        const query = `
            SELECT id, coin_name, metal, original_description
            FROM coin_catalog 
            WHERE (original_description ILIKE '%Au %' OR original_description ILIKE '%Ag %' OR original_description ILIKE '%Pt %' OR original_description ILIKE '%Pd %')
            AND (coin_weight IS NULL OR fineness IS NULL OR pure_metal_weight IS NULL)
            LIMIT 10
        `;
        
        const result = await client.query(query);
        console.log(`📊 Найдено записей для обновления: ${result.rows.length}\n`);
        
        for (const [index, row] of result.rows.entries()) {
            console.log(`--- Обновление ${index + 1}/${result.rows.length} ---`);
            console.log(`ID: ${row.id}, Название: ${row.coin_name}`);
            console.log(`Описание: ${row.original_description.substring(0, 100)}...`);
            
            // Парсим описание заново
            const parsedData = parser.parseLotDescription(row.original_description);
            
            console.log(`Извлеченные данные:`);
            console.log(`  - Вес: ${parsedData.coin_weight || 'не найден'}г`);
            console.log(`  - Проба: ${parsedData.fineness || 'не найдена'}`);
            console.log(`  - Чистый металл: ${parsedData.pure_metal_weight || 'не найден'}г`);
            
            // Обновляем запись, если есть данные о весе
            if (parsedData.coin_weight || parsedData.fineness || parsedData.pure_metal_weight) {
                const updateQuery = `
                    UPDATE coin_catalog 
                    SET coin_weight = $1,
                        fineness = $2,
                        pure_metal_weight = $3,
                        weight_oz = $4,
                        parsed_at = NOW()
                    WHERE id = $5
                `;
                
                await client.query(updateQuery, [
                    parsedData.coin_weight,
                    parsedData.fineness,
                    parsedData.pure_metal_weight,
                    parsedData.weight_oz,
                    row.id
                ]);
                
                console.log(`✅ Запись ${row.id} обновлена!`);
            } else {
                console.log(`⚠️ Данные о весе не найдены для записи ${row.id}`);
            }
            
            console.log('');
        }
        
        console.log('🎉 Обновление завершено!');
        
    } catch (error) {
        console.error('❌ Ошибка при обновлении записей:', error);
    } finally {
        client.release();
        await pool.end();
        await parser.close();
    }
}

updateExistingWeightRecords();
