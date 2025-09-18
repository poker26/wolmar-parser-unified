const { Client } = require('pg');

const dbConfig = {
    user: 'postgres.xkwgspqwebfeteoblayu',        
    host: 'aws-0-eu-north-1.pooler.supabase.com',
    database: 'postgres',   
    password: 'Gopapopa326+',    
    port: 6543,
    ssl: {
        rejectUnauthorized: false
    }
};

async function analyzeLotsForFiltering() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключение к базе данных успешно');
        
        console.log('\n📊 АНАЛИЗ ЛОТОВ ДЛЯ ФИЛЬТРАЦИИ:');
        console.log('='.repeat(60));
        
        // 1. Общая статистика
        const totalQuery = `
            SELECT COUNT(*) as total
            FROM auction_lots 
            WHERE source_url IS NOT NULL;
        `;
        const totalResult = await client.query(totalQuery);
        console.log(`📊 Всего лотов в базе: ${totalResult.rows[0].total}`);
        
        // 2. Анализ состояний с градациями (содержат цифры)
        const withGradesQuery = `
            SELECT COUNT(*) as count
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition ~ '[0-9]';
        `;
        const withGradesResult = await client.query(withGradesQuery);
        console.log(`✅ Лотов с градациями (содержат цифры): ${withGradesResult.rows[0].count}`);
        
        // 3. Анализ состояний без градаций (только буквы)
        const withoutGradesQuery = `
            SELECT COUNT(*) as count
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition !~ '[0-9]'
            AND condition IS NOT NULL
            AND condition != '';
        `;
        const withoutGradesResult = await client.query(withoutGradesQuery);
        console.log(`⚠️ Лотов без градаций (только буквы): ${withoutGradesResult.rows[0].count}`);
        
        // 4. Анализ пустых состояний
        const emptyQuery = `
            SELECT COUNT(*) as count
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND (condition IS NULL OR condition = '');
        `;
        const emptyResult = await client.query(emptyQuery);
        console.log(`❌ Лотов с пустыми состояниями: ${emptyResult.rows[0].count}`);
        
        // 5. Топ-20 состояний без градаций (кандидаты на обновление)
        const topWithoutGradesQuery = `
            SELECT condition, COUNT(*) as count
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition !~ '[0-9]'
            AND condition IS NOT NULL
            AND condition != ''
            GROUP BY condition
            ORDER BY count DESC
            LIMIT 20;
        `;
        const topWithoutGradesResult = await client.query(topWithoutGradesQuery);
        
        console.log('\n📋 ТОП-20 состояний БЕЗ градаций (кандидаты на обновление):');
        topWithoutGradesResult.rows.forEach((row, index) => {
            console.log(`${index + 1}. "${row.condition}": ${row.count} лотов`);
        });
        
        // 6. Топ-20 состояний с градациями (уже правильные)
        const topWithGradesQuery = `
            SELECT condition, COUNT(*) as count
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition ~ '[0-9]'
            GROUP BY condition
            ORDER BY count DESC
            LIMIT 20;
        `;
        const topWithGradesResult = await client.query(topWithGradesQuery);
        
        console.log('\n✅ ТОП-20 состояний С градациями (уже правильные):');
        topWithGradesResult.rows.forEach((row, index) => {
            console.log(`${index + 1}. "${row.condition}": ${row.count} лотов`);
        });
        
        // 7. Анализ по аукционам
        const byAuctionQuery = `
            SELECT 
                auction_number,
                COUNT(*) as total_lots,
                COUNT(CASE WHEN condition ~ '[0-9]' THEN 1 END) as with_grades,
                COUNT(CASE WHEN condition !~ '[0-9]' AND condition IS NOT NULL AND condition != '' THEN 1 END) as without_grades,
                COUNT(CASE WHEN condition IS NULL OR condition = '' THEN 1 END) as empty
            FROM auction_lots 
            WHERE source_url IS NOT NULL
            GROUP BY auction_number
            ORDER BY auction_number DESC
            LIMIT 10;
        `;
        const byAuctionResult = await client.query(byAuctionQuery);
        
        console.log('\n📊 АНАЛИЗ ПО АУКЦИОНАМ (последние 10):');
        console.log('Аукцион | Всего | С градациями | Без градаций | Пустые');
        console.log('-'.repeat(60));
        byAuctionResult.rows.forEach(row => {
            const withGrades = row.with_grades || 0;
            const withoutGrades = row.without_grades || 0;
            const empty = row.empty || 0;
            const total = row.total_lots;
            
            console.log(`${row.auction_number.padEnd(8)} | ${total.toString().padEnd(5)} | ${withGrades.toString().padEnd(12)} | ${withoutGrades.toString().padEnd(13)} | ${empty}`);
        });
        
        // 8. Расчет потенциальной экономии
        const needUpdate = withoutGradesResult.rows[0].count + emptyResult.rows[0].count;
        const total = totalResult.rows[0].total;
        const alreadyCorrect = withGradesResult.rows[0].count;
        
        console.log('\n🎯 ПОТЕНЦИАЛЬНАЯ ЭКОНОМИЯ:');
        console.log('='.repeat(40));
        console.log(`📊 Всего лотов: ${total}`);
        console.log(`✅ Уже правильные: ${alreadyCorrect} (${(alreadyCorrect/total*100).toFixed(1)}%)`);
        console.log(`⚠️ Нужно обновить: ${needUpdate} (${(needUpdate/total*100).toFixed(1)}%)`);
        console.log(`🚀 Экономия времени: ${(alreadyCorrect/total*100).toFixed(1)}%`);
        
        // 9. Создаем список лотов для обновления
        const lotsToUpdateQuery = `
            SELECT id, lot_number, auction_number, condition, source_url
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND (condition !~ '[0-9]' OR condition IS NULL OR condition = '')
            AND condition NOT IN ('AU/UNC', 'XF+/AU', 'VF/XF', 'UNC', 'AU', 'XF', 'VF', 'VF+', 'XF+', 'XF-', 'VF-')
            ORDER BY auction_number DESC, lot_number
            LIMIT 100;
        `;
        const lotsToUpdateResult = await client.query(lotsToUpdateQuery);
        
        console.log('\n📋 ПРИМЕРЫ ЛОТОВ ДЛЯ ОБНОВЛЕНИЯ (первые 20):');
        lotsToUpdateResult.rows.slice(0, 20).forEach((row, index) => {
            console.log(`${index + 1}. Аукцион ${row.auction_number}, Лот ${row.lot_number}: "${row.condition || 'NULL'}"`);
        });
        
        // 10. Сохраняем результаты анализа
        const analysisResults = {
            total: total,
            withGrades: alreadyCorrect,
            withoutGrades: withoutGradesResult.rows[0].count,
            empty: emptyResult.rows[0].count,
            needUpdate: needUpdate,
            savingsPercent: (alreadyCorrect/total*100).toFixed(1),
            topWithoutGrades: topWithoutGradesResult.rows,
            topWithGrades: topWithGradesResult.rows,
            byAuction: byAuctionResult.rows,
            lotsToUpdate: lotsToUpdateResult.rows
        };
        
        const fs = require('fs');
        fs.writeFileSync('filtering_analysis.json', JSON.stringify(analysisResults, null, 2));
        console.log('\n💾 Результаты анализа сохранены в файл: filtering_analysis.json');
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

analyzeLotsForFiltering();
