const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

// Функция для извлечения веса из описания
function extractWeight(description, metal) {
    if (!description || !metal) return null;
    
    // Создаем регулярное выражение для поиска веса после металла
    // Поддерживаем форматы: Au 7,78, Au 7.78, Au 7,78г, Au 7,78 гр, Au 7,78гр
    const weightPatterns = [
        new RegExp(`${metal}\\s+(\\d+[,.]\\d+)\\s*(?:г|гр|грамм)?`, 'i'),
        new RegExp(`${metal}\\s+(\\d+[,.]\\d+)`, 'i')
    ];
    
    for (const pattern of weightPatterns) {
        const match = description.match(pattern);
        if (match) {
            // Заменяем запятую на точку для корректного парсинга
            const weightStr = match[1].replace(',', '.');
            const weight = parseFloat(weightStr);
            
            // Валидация: вес должен быть в разумных пределах для монет (0.1 - 1000 грамм)
            if (weight >= 0.1 && weight <= 1000) {
                return weight;
            }
        }
    }
    
    return null;
}

async function extractWeightsFromDescriptions() {
    try {
        console.log('🔄 Начинаем извлечение веса из описаний лотов...');
        
        // Получаем все лоты из драгоценных металлов без веса
        const query = `
            SELECT id, coin_description, metal, lot_number, auction_number
            FROM auction_lots 
            WHERE metal IN ('Au', 'Ag', 'Pt', 'Pd')
            AND (weight IS NULL OR weight = 0)
            AND coin_description IS NOT NULL
            ORDER BY id
        `;
        
        const result = await pool.query(query);
        console.log(`📊 Найдено ${result.rows.length} лотов из драгоценных металлов без веса`);
        
        let processedCount = 0;
        let updatedCount = 0;
        let errorCount = 0;
        
        for (const lot of result.rows) {
            try {
                const extractedWeight = extractWeight(lot.coin_description, lot.metal);
                
                if (extractedWeight) {
                    // Обновляем вес в базе данных
                    const updateQuery = `
                        UPDATE auction_lots 
                        SET weight = $1 
                        WHERE id = $2
                    `;
                    
                    await pool.query(updateQuery, [extractedWeight, lot.id]);
                    updatedCount++;
                    
                    console.log(`✅ Лот ${lot.lot_number} (Аукцион ${lot.auction_number}): ${lot.metal} ${extractedWeight}г`);
                } else {
                    console.log(`⚠️  Лот ${lot.lot_number} (Аукцион ${lot.auction_number}): вес не найден в описании`);
                }
                
                processedCount++;
                
                // Показываем прогресс каждые 50 лотов
                if (processedCount % 50 === 0) {
                    console.log(`📈 Обработано: ${processedCount}/${result.rows.length}, обновлено: ${updatedCount}`);
                }
                
            } catch (error) {
                console.error(`❌ Ошибка обработки лота ${lot.id}:`, error.message);
                errorCount++;
            }
        }
        
        console.log('\n🎉 Извлечение веса завершено!');
        console.log(`📊 Статистика:`);
        console.log(`   - Обработано лотов: ${processedCount}`);
        console.log(`   - Обновлено с весом: ${updatedCount}`);
        console.log(`   - Ошибок: ${errorCount}`);
        console.log(`   - Процент успеха: ${((updatedCount / processedCount) * 100).toFixed(1)}%`);
        
        // Показываем примеры обновленных лотов
        if (updatedCount > 0) {
            console.log('\n📋 Примеры обновленных лотов:');
            const examplesQuery = `
                SELECT lot_number, auction_number, metal, weight, 
                       SUBSTRING(coin_description, 1, 100) as description_preview
                FROM auction_lots 
                WHERE weight IS NOT NULL 
                AND metal IN ('Au', 'Ag', 'Pt', 'Pd')
                ORDER BY id DESC 
                LIMIT 5
            `;
            
            const examples = await pool.query(examplesQuery);
            examples.rows.forEach(lot => {
                console.log(`   Лот ${lot.lot_number} (Аукцион ${lot.auction_number}): ${lot.metal} ${lot.weight}г`);
                console.log(`   Описание: ${lot.description_preview}...`);
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка при извлечении веса:', error);
    } finally {
        await pool.end();
    }
}

// Запускаем извлечение
extractWeightsFromDescriptions();
