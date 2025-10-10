const { Pool } = require('pg');
const config = require('./config');

// Функция для исправления номинала на основе полного описания
function fixDenomination(originalDescription, currentDenomination) {
    // Если номинал уже содержит валюту, не меняем
    if (currentDenomination.includes('рубль') || 
        currentDenomination.includes('копейка') || 
        currentDenomination.includes('доллар') ||
        currentDenomination.includes('евро') ||
        currentDenomination.includes('фунт') ||
        currentDenomination.includes('франк') ||
        currentDenomination.includes('марка') ||
        currentDenomination.includes('крона') ||
        currentDenomination.includes('цент')) {
        return currentDenomination;
    }
    
    // Ищем валюту в описании
    const description = originalDescription.toLowerCase();
    
    // Паттерны для поиска валюты
    const currencyPatterns = [
        { pattern: /(\d+(?:\.\d+)?)\s*рублей?/i, replacement: '$1 рубль' },
        { pattern: /(\d+(?:\.\d+)?)\s*копеек?/i, replacement: '$1 копейка' },
        { pattern: /(\d+(?:\.\d+)?)\s*долларов?/i, replacement: '$1 доллар' },
        { pattern: /(\d+(?:\.\d+)?)\s*евро/i, replacement: '$1 евро' },
        { pattern: /(\d+(?:\.\d+)?)\s*фунтов?/i, replacement: '$1 фунт' },
        { pattern: /(\d+(?:\.\d+)?)\s*франков?/i, replacement: '$1 франк' },
        { pattern: /(\d+(?:\.\d+)?)\s*марок?/i, replacement: '$1 марка' },
        { pattern: /(\d+(?:\.\d+)?)\s*крон?/i, replacement: '$1 крона' },
        { pattern: /(\d+(?:\.\d+)?)\s*центов?/i, replacement: '$1 цент' },
        { pattern: /(\d+(?:\.\d+)?)\s*йен/i, replacement: '$1 йена' },
        { pattern: /(\d+(?:\.\d+)?)\s*злотых?/i, replacement: '$1 злотый' },
        { pattern: /(\d+(?:\.\d+)?)\s*динар/i, replacement: '$1 динар' },
        { pattern: /(\d+(?:\.\d+)?)\s*драхм?/i, replacement: '$1 драхма' },
        { pattern: /(\d+(?:\.\d+)?)\s*гульден/i, replacement: '$1 гульден' },
        { pattern: /(\d+(?:\.\d+)?)\s*риал/i, replacement: '$1 риал' },
        { pattern: /(\d+(?:\.\d+)?)\s*бат/i, replacement: '$1 бат' },
        { pattern: /(\d+(?:\.\d+)?)\s*вон/i, replacement: '$1 вона' },
        { pattern: /(\d+(?:\.\d+)?)\s*гривень/i, replacement: '$1 гривна' },
        { pattern: /(\d+(?:\.\d+)?)\s*гуарани/i, replacement: '$1 гуарани' },
        { pattern: /(\d+(?:\.\d+)?)\s*дирхам/i, replacement: '$1 дирхам' },
        { pattern: /(\d+(?:\.\d+)?)\s*донгов?/i, replacement: '$1 донг' },
        { pattern: /(\d+(?:\.\d+)?)\s*драмов?/i, replacement: '$1 драм' },
        { pattern: /(\d+(?:\.\d+)?)\s*инти/i, replacement: '$1 инти' },
        { pattern: /(\d+(?:\.\d+)?)\s*кардоб/i, replacement: '$1 кардоба' },
        { pattern: /(\d+(?:\.\d+)?)\s*ариари/i, replacement: '$1 ариари' },
        { pattern: /(\d+(?:\.\d+)?)\s*заир/i, replacement: '$1 заир' }
    ];
    
    // Пробуем найти валюту в описании
    for (const { pattern, replacement } of currencyPatterns) {
        const match = originalDescription.match(pattern);
        if (match) {
            return replacement.replace('$1', match[1]);
        }
    }
    
    // Если не нашли валюту, возвращаем текущий номинал
    return currentDenomination;
}

async function fixDenominations() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔧 Исправляем номиналы в существующих записях...');
        
        // Получаем ВСЕ записи с числовыми номиналами и описанием
        const query = `
            SELECT id, denomination, original_description
            FROM coin_catalog 
            WHERE denomination ~ '^[0-9]+(\.[0-9]+)?$'
            AND original_description IS NOT NULL
            AND original_description != ''
            ORDER BY id
        `;
        
        const result = await pool.query(query);
        
        console.log(`📊 Найдено ${result.rows.length} записей с числовыми номиналами для проверки`);
        
        let updatedCount = 0;
        let processedCount = 0;
        
        for (const row of result.rows) {
            processedCount++;
            
            if (processedCount % 100 === 0) {
                console.log(`   Обработано: ${processedCount}/${result.rows.length}`);
            }
            
            const newDenomination = fixDenomination(row.original_description, row.denomination);
            
            if (newDenomination !== row.denomination) {
                // Обновляем запись
                const updateQuery = `
                    UPDATE coin_catalog 
                    SET denomination = $1
                    WHERE id = $2
                `;
                
                await pool.query(updateQuery, [newDenomination, row.id]);
                updatedCount++;
                
                if (updatedCount <= 10) { // Показываем первые 10 примеров
                    console.log(`   ID ${row.id}: "${row.denomination}" → "${newDenomination}"`);
                    console.log(`     Описание: "${row.original_description.substring(0, 100)}..."`);
                }
            }
        }
        
        console.log(`\n✅ Исправление завершено!`);
        console.log(`   Обработано записей: ${processedCount}`);
        console.log(`   Обновлено записей: ${updatedCount}`);
        
        // Проверим результат
        console.log('\n🔍 Проверяем результат...');
        
        const checkQuery = `
            SELECT 
                denomination,
                COUNT(*) as count
            FROM coin_catalog 
            WHERE denomination IS NOT NULL
            GROUP BY denomination
            ORDER BY count DESC
            LIMIT 15
        `;
        
        const checkResult = await pool.query(checkQuery);
        
        console.log('\n📊 Топ-15 номиналов после исправления:');
        checkResult.rows.forEach((row, index) => {
            console.log(`${index + 1}. "${row.denomination}": ${row.count} записей`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

fixDenominations();
