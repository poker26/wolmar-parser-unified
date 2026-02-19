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

async function analyzeUltraOptimized() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключение к базе данных успешно');
        
        console.log('\n🎯 АНАЛИЗ УЛЬТРА-ОПТИМИЗИРОВАННОЙ СТРАТЕГИИ:');
        console.log('='.repeat(60));
        
        // 1. Общая статистика
        const totalQuery = `
            SELECT COUNT(*) as total
            FROM auction_lots 
            WHERE source_url IS NOT NULL;
        `;
        const totalResult = await client.query(totalQuery);
        console.log(`📊 Всего лотов в базе: ${totalResult.rows[0].total}`);
        
        // 2. Критичные состояния для обновления (MS, PF, UNC, PL, PR, F, Proof, Gem, XX)
        const criticalQuery = `
            SELECT COUNT(*) as count
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition IN ('MS', 'PF', 'UNC', 'PL', 'PR', 'F', 'Proof', 'Gem', 'XX');
        `;
        const criticalResult = await client.query(criticalQuery);
        console.log(`🎯 Лотов с критичными состояниями (для обновления): ${criticalResult.rows[0].count}`);
        
        // 3. Состояния, которые пропускаем (VF, XF, AU и их вариации)
        const skipQuery = `
            SELECT COUNT(*) as count
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND (condition LIKE 'VF%' OR condition LIKE 'XF%' OR condition LIKE 'AU%' 
                 OR condition IN ('VF', 'XF', 'AU', 'VF+', 'XF+', 'VF-', 'XF-', 'VF/XF', 'XF+/AU', 'AU/UNC'));
        `;
        const skipResult = await client.query(skipQuery);
        console.log(`⏭️ Лотов с пропускаемыми состояниями: ${skipResult.rows[0].count}`);
        
        // 4. Уже правильные состояния (с градациями)
        const correctQuery = `
            SELECT COUNT(*) as count
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition ~ '[0-9]';
        `;
        const correctResult = await client.query(correctQuery);
        console.log(`✅ Уже правильные состояния (с градациями): ${correctResult.rows[0].count}`);
        
        // 5. Детализация критичных состояний
        const criticalDetailsQuery = `
            SELECT condition, COUNT(*) as count
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition IN ('MS', 'PF', 'UNC', 'PL', 'PR', 'F', 'Proof', 'Gem', 'XX')
            GROUP BY condition
            ORDER BY count DESC;
        `;
        const criticalDetailsResult = await client.query(criticalDetailsQuery);
        
        console.log('\n📋 ДЕТАЛИЗАЦИЯ КРИТИЧНЫХ СОСТОЯНИЙ:');
        criticalDetailsResult.rows.forEach((row, index) => {
            console.log(`${index + 1}. "${row.condition}": ${row.count} лотов`);
        });
        
        // 6. Детализация пропускаемых состояний
        const skipDetailsQuery = `
            SELECT condition, COUNT(*) as count
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND (condition LIKE 'VF%' OR condition LIKE 'XF%' OR condition LIKE 'AU%' 
                 OR condition IN ('VF', 'XF', 'AU', 'VF+', 'XF+', 'VF-', 'XF-', 'VF/XF', 'XF+/AU', 'AU/UNC'))
            GROUP BY condition
            ORDER BY count DESC
            LIMIT 15;
        `;
        const skipDetailsResult = await client.query(skipDetailsQuery);
        
        console.log('\n⏭️ ДЕТАЛИЗАЦИЯ ПРОПУСКАЕМЫХ СОСТОЯНИЙ (топ-15):');
        skipDetailsResult.rows.forEach((row, index) => {
            console.log(`${index + 1}. "${row.condition}": ${row.count} лотов`);
        });
        
        // 7. Расчет экономии
        const total = totalResult.rows[0].total;
        const critical = criticalResult.rows[0].count;
        const skip = skipResult.rows[0].count;
        const correct = correctResult.rows[0].count;
        
        const savingsPercent = ((total - critical) / total * 100).toFixed(1);
        
        console.log('\n🎯 РЕЗУЛЬТАТЫ УЛЬТРА-ОПТИМИЗАЦИИ:');
        console.log('='.repeat(50));
        console.log(`📊 Всего лотов: ${total}`);
        console.log(`🎯 Критичные для обновления: ${critical} (${(critical/total*100).toFixed(1)}%)`);
        console.log(`⏭️ Пропускаем (VF/XF/AU): ${skip} (${(skip/total*100).toFixed(1)}%)`);
        console.log(`✅ Уже правильные: ${correct} (${(correct/total*100).toFixed(1)}%)`);
        console.log(`🚀 Экономия времени: ${savingsPercent}%`);
        
        // 8. Примеры лотов для обновления
        const examplesQuery = `
            SELECT id, lot_number, auction_number, condition, source_url
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition IN ('MS', 'PF', 'UNC', 'PL', 'PR', 'F', 'Proof', 'Gem', 'XX')
            ORDER BY auction_number DESC, lot_number
            LIMIT 20;
        `;
        const examplesResult = await client.query(examplesQuery);
        
        console.log('\n📋 ПРИМЕРЫ ЛОТОВ ДЛЯ ОБНОВЛЕНИЯ (первые 20):');
        examplesResult.rows.forEach((row, index) => {
            console.log(`${index + 1}. Аукцион ${row.auction_number}, Лот ${row.lot_number}: "${row.condition}"`);
        });
        
        // 9. Сохраняем результаты
        const analysisResults = {
            total: total,
            critical: critical,
            skip: skip,
            correct: correct,
            savingsPercent: savingsPercent,
            criticalDetails: criticalDetailsResult.rows,
            skipDetails: skipDetailsResult.rows,
            examples: examplesResult.rows
        };
        
        const fs = require('fs');
        fs.writeFileSync('ultra_optimized_analysis.json', JSON.stringify(analysisResults, null, 2));
        console.log('\n💾 Результаты ультра-оптимизации сохранены в файл: ultra_optimized_analysis.json');
        
        // 10. Создаем оптимизированный SQL
        const optimizedSQL = `
            -- Ультра-оптимизированный запрос для получения лотов для обновления
            -- Обновляем только критичные состояния: MS, PF, UNC, PL, PR, F, Proof, Gem, XX
            -- Пропускаем VF, XF, AU - для них градации менее важны
            SELECT id, lot_number, auction_number, condition, source_url
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition IN ('MS', 'PF', 'UNC', 'PL', 'PR', 'F', 'Proof', 'Gem', 'XX')
            ORDER BY auction_number DESC, lot_number;
        `;
        
        fs.writeFileSync('ultra_optimized_query.sql', optimizedSQL);
        console.log('💾 Ультра-оптимизированный SQL запрос сохранен в файл: ultra_optimized_query.sql');
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

analyzeUltraOptimized();
