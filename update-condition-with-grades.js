const { Client } = require('pg');

const dbConfig = {
    user: 'postgres.xkwgspqwebfeteoblayu',        
    host: 'sup.begemot26.ru',
    database: 'postgres',   
    password: 'Gopapopa326+',    
    port: 6543,
    ssl: {
        rejectUnauthorized: false
    }
};

// Функция для извлечения и объединения состояния с градацией
function extractConditionWithGrade(conditionText) {
    if (!conditionText) return null;
    
    // Убираем лишние пробелы
    const cleanText = conditionText.trim();
    
    // Если уже есть градация в формате "MS61", "XF45" - возвращаем как есть
    if (/^[A-Z]{2,3}[0-9]{2,3}$/.test(cleanText)) {
        return cleanText;
    }
    
    // Ищем паттерн "MS 61", "XF 45" и т.д.
    const spaceMatch = cleanText.match(/^([A-Z]{2,3})\s+([0-9]{2,3})$/);
    if (spaceMatch) {
        return spaceMatch[1] + spaceMatch[2]; // "MS 61" -> "MS61"
    }
    
    // Ищем паттерн с дополнительными символами "MS61RB", "MS64BN"
    const complexMatch = cleanText.match(/^([A-Z]{2,3})([0-9]{2,3})([A-Z]*)$/);
    if (complexMatch) {
        return complexMatch[1] + complexMatch[2] + complexMatch[3]; // "MS61RB" -> "MS61RB"
    }
    
    // Если это просто градация без состояния "61", "65" - оставляем как есть
    if (/^[0-9]{2,3}$/.test(cleanText)) {
        return cleanText;
    }
    
    // Для всех остальных случаев (UNC, PF, XF, MS, AU, VF и т.д.) - возвращаем как есть
    return cleanText;
}

async function updateConditionWithGrades() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключение к базе данных успешно');
        
        // Получаем все записи с condition
        console.log('\n📊 Получаем записи для обновления...');
        const selectQuery = `
            SELECT id, condition 
            FROM auction_lots 
            WHERE condition IS NOT NULL 
            ORDER BY id;
        `;
        const result = await client.query(selectQuery);
        console.log(`📋 Найдено ${result.rows.length} записей для обработки`);
        
        let updated = 0;
        let unchanged = 0;
        let errors = 0;
        
        console.log('\n🔄 Начинаем обновление...');
        
        for (const row of result.rows) {
            try {
                const originalCondition = row.condition;
                const newCondition = extractConditionWithGrade(originalCondition);
                
                // Обновляем только если значение изменилось
                if (newCondition !== originalCondition) {
                    const updateQuery = `
                        UPDATE auction_lots 
                        SET condition = $1 
                        WHERE id = $2;
                    `;
                    await client.query(updateQuery, [newCondition, row.id]);
                    updated++;
                    
                    if (updated % 1000 === 0) {
                        console.log(`✅ Обновлено ${updated} записей...`);
                    }
                } else {
                    unchanged++;
                }
                
            } catch (error) {
                console.error(`❌ Ошибка при обновлении записи ${row.id}:`, error.message);
                errors++;
            }
        }
        
        console.log('\n📈 Результаты обновления:');
        console.log(`✅ Обновлено записей: ${updated}`);
        console.log(`⏭️  Без изменений: ${unchanged}`);
        console.log(`❌ Ошибок: ${errors}`);
        
        // Проверяем результат
        console.log('\n🔍 Проверяем результат...');
        const checkQuery = `
            SELECT condition, COUNT(*) as count
            FROM auction_lots 
            WHERE condition ~ '[0-9]{2,3}' 
            GROUP BY condition 
            ORDER BY count DESC
            LIMIT 10;
        `;
        const checkResult = await client.query(checkQuery);
        console.log('📊 Топ-10 записей с градациями после обновления:');
        console.table(checkResult.rows);
        
    } catch (error) {
        console.error('❌ Ошибка при обновлении данных:', error);
    } finally {
        await client.end();
        console.log('\n✅ Обновление завершено');
    }
}

// Функция для тестирования на небольшом количестве записей
async function testUpdate() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('🧪 Тестируем обновление на 10 записях...');
        
        const testQuery = `
            SELECT id, condition 
            FROM auction_lots 
            WHERE condition IS NOT NULL 
            ORDER BY RANDOM() 
            LIMIT 10;
        `;
        const result = await client.query(testQuery);
        
        console.log('\n📋 Тестовые записи:');
        for (const row of result.rows) {
            const newCondition = extractConditionWithGrade(row.condition);
            console.log(`ID: ${row.id}, Было: "${row.condition}" -> Станет: "${newCondition}"`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error);
    } finally {
        await client.end();
    }
}

// Запускаем тест или полное обновление
const args = process.argv.slice(2);
if (args.includes('--test')) {
    testUpdate();
} else {
    updateConditionWithGrades();
}
