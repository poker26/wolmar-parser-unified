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

async function fixAnalysisAndFilter() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключение к базе данных успешно');
        
        console.log('\n🔧 ИСПРАВЛЕНИЕ АНАЛИЗА И СОЗДАНИЕ ТОЧНОЙ ФИЛЬТРАЦИИ:');
        console.log('='.repeat(60));
        
        // 1. Общая статистика
        const totalQuery = `
            SELECT COUNT(*) as total
            FROM auction_lots 
            WHERE source_url IS NOT NULL;
        `;
        const totalResult = await client.query(totalQuery);
        console.log(`📊 Всего лотов в базе: ${totalResult.rows[0].total}`);
        
        // 2. Лоты с градациями (содержат цифры)
        const withGradesQuery = `
            SELECT COUNT(*) as count
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition ~ '[0-9]';
        `;
        const withGradesResult = await client.query(withGradesQuery);
        console.log(`✅ Лотов с градациями: ${withGradesResult.rows[0].count}`);
        
        // 3. Лоты без градаций (только буквы, но не пустые)
        const withoutGradesQuery = `
            SELECT COUNT(*) as count
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition !~ '[0-9]'
            AND condition IS NOT NULL
            AND condition != '';
        `;
        const withoutGradesResult = await client.query(withoutGradesQuery);
        console.log(`⚠️ Лотов без градаций: ${withoutGradesResult.rows[0].count}`);
        
        // 4. Пустые состояния
        const emptyQuery = `
            SELECT COUNT(*) as count
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND (condition IS NULL OR condition = '');
        `;
        const emptyResult = await client.query(emptyQuery);
        console.log(`❌ Лотов с пустыми состояниями: ${emptyResult.rows[0].count}`);
        
        // 5. Создаем точную фильтрацию для обновления
        // Обновляем только лоты с простыми состояниями типа "MS", "AU", "XF", "VF", "PF"
        const simpleStatesQuery = `
            SELECT COUNT(*) as count
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition IN ('MS', 'AU', 'XF', 'VF', 'PF', 'UNC', 'PL', 'PR', 'F', 'Proof', 'Gem', 'XX');
        `;
        const simpleStatesResult = await client.query(simpleStatesQuery);
        console.log(`🎯 Лотов с простыми состояниями (кандидаты на обновление): ${simpleStatesResult.rows[0].count}`);
        
        // 6. Показываем примеры простых состояний
        const examplesQuery = `
            SELECT condition, COUNT(*) as count
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition IN ('MS', 'AU', 'XF', 'VF', 'PF', 'UNC', 'PL', 'PR', 'F', 'Proof', 'Gem', 'XX')
            GROUP BY condition
            ORDER BY count DESC;
        `;
        const examplesResult = await client.query(examplesQuery);
        
        console.log('\n📋 ПРОСТЫЕ СОСТОЯНИЯ ДЛЯ ОБНОВЛЕНИЯ:');
        examplesResult.rows.forEach((row, index) => {
            console.log(`${index + 1}. "${row.condition}": ${row.count} лотов`);
        });
        
        // 7. Создаем оптимизированный запрос для обновления
        const optimizedQuery = `
            SELECT id, lot_number, auction_number, condition, source_url
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition IN ('MS', 'AU', 'XF', 'VF', 'PF', 'UNC', 'PL', 'PR', 'F', 'Proof', 'Gem', 'XX')
            ORDER BY auction_number DESC, lot_number
            LIMIT 1000;
        `;
        const optimizedResult = await client.query(optimizedQuery);
        
        console.log(`\n📊 ПРИМЕРЫ ЛОТОВ ДЛЯ ОБНОВЛЕНИЯ (первые 20):`);
        optimizedResult.rows.slice(0, 20).forEach((row, index) => {
            console.log(`${index + 1}. Аукцион ${row.auction_number}, Лот ${row.lot_number}: "${row.condition}"`);
        });
        
        // 8. Сохраняем исправленные результаты
        const correctedAnalysis = {
            total: totalResult.rows[0].total,
            withGrades: withGradesResult.rows[0].count,
            withoutGrades: withoutGradesResult.rows[0].count,
            empty: emptyResult.rows[0].count,
            simpleStates: simpleStatesResult.rows[0].count,
            needUpdate: simpleStatesResult.rows[0].count,
            savingsPercent: ((totalResult.rows[0].total - simpleStatesResult.rows[0].count) / totalResult.rows[0].total * 100).toFixed(1),
            examples: examplesResult.rows,
            lotsToUpdate: optimizedResult.rows
        };
        
        const fs = require('fs');
        fs.writeFileSync('corrected_analysis.json', JSON.stringify(correctedAnalysis, null, 2));
        console.log('\n💾 Исправленные результаты сохранены в файл: corrected_analysis.json');
        
        console.log('\n🎯 ИСПРАВЛЕННАЯ СТАТИСТИКА:');
        console.log('='.repeat(40));
        console.log(`📊 Всего лотов: ${correctedAnalysis.total}`);
        console.log(`✅ Уже правильные: ${correctedAnalysis.withGrades + correctedAnalysis.withoutGrades - correctedAnalysis.simpleStates}`);
        console.log(`🎯 Нужно обновить: ${correctedAnalysis.needUpdate}`);
        console.log(`🚀 Экономия времени: ${correctedAnalysis.savingsPercent}%`);
        
        // 9. Создаем оптимизированный SQL для массового обновления
        const optimizedSQL = `
            -- Оптимизированный запрос для получения лотов для обновления
            SELECT id, lot_number, auction_number, condition, source_url
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition IN ('MS', 'AU', 'XF', 'VF', 'PF', 'UNC', 'PL', 'PR', 'F', 'Proof', 'Gem', 'XX')
            ORDER BY auction_number DESC, lot_number;
        `;
        
        fs.writeFileSync('optimized_query.sql', optimizedSQL);
        console.log('💾 Оптимизированный SQL запрос сохранен в файл: optimized_query.sql');
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

fixAnalysisAndFilter();
