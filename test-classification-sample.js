const { Pool } = require('pg');
const LotClassifier = require('./lot-classifier');
const config = require('./config');

async function testClassificationSample() {
    const pool = new Pool(config.dbConfig);
    const classifier = new LotClassifier();
    
    try {
        console.log('🧪 Тестируем классификацию на выборке лотов...');
        
        // Получаем случайную выборку лотов
        const sampleQuery = `
            SELECT id, coin_description, letters, metal, year, category, lot_type
            FROM auction_lots 
            WHERE coin_description IS NOT NULL 
            AND coin_description != ''
            ORDER BY RANDOM()
            LIMIT 20
        `;
        
        const sampleResult = await pool.query(sampleQuery);
        const lots = sampleResult.rows;
        
        console.log(`📊 Тестируем на ${lots.length} лотах:\n`);
        
        let classifiedCount = 0;
        const categoryStats = {};
        
        lots.forEach((lot, index) => {
            console.log(`--- Лот ${index + 1} (ID: ${lot.id}) ---`);
            console.log(`Описание: ${lot.coin_description}`);
            console.log(`Буквы: ${lot.letters || 'не указаны'}`);
            console.log(`Металл: ${lot.metal || 'не указан'}`);
            console.log(`Год: ${lot.year || 'не указан'}`);
            console.log(`Тип лота: ${lot.lot_type || 'не указан'}`);
            console.log(`Текущая категория: ${lot.category || 'не установлена'}`);
            
            // Классифицируем лот
            const classification = classifier.classify(lot);
            const detailed = classifier.classifyDetailed(lot);
            
            console.log(`🎯 Предложенная категория: ${classification || 'не определена'}`);
            console.log(`📊 Уверенность: ${(detailed.confidence * 100).toFixed(1)}%`);
            console.log(`📈 Максимальный счет: ${detailed.maxScore.toFixed(2)}`);
            
            if (classification) {
                classifiedCount++;
                categoryStats[classification] = (categoryStats[classification] || 0) + 1;
                
                // Показываем лучшие совпадения
                if (detailed.category) {
                    console.log(`🏆 Лучшие совпадения:`);
                    Object.entries(detailed.fieldAnalysis).forEach(([field, analysis]) => {
                        if (analysis.matches[detailed.category] && analysis.matches[detailed.category].length > 0) {
                            console.log(`  ${field}: ${analysis.matches[detailed.category].join(', ')}`);
                        }
                    });
                }
            }
            
            console.log('');
        });
        
        console.log('📊 Результаты тестирования:');
        console.log(`  Всего лотов: ${lots.length}`);
        console.log(`  Классифицировано: ${classifiedCount}`);
        console.log(`  Процент классификации: ${(classifiedCount / lots.length * 100).toFixed(1)}%`);
        
        if (Object.keys(categoryStats).length > 0) {
            console.log('\n📋 Распределение по категориям:');
            Object.entries(categoryStats)
                .sort(([,a], [,b]) => b - a)
                .forEach(([category, count]) => {
                    console.log(`  ${category}: ${count}`);
                });
        }
        
    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error);
    } finally {
        await pool.end();
    }
}

// Запускаем тест
testClassificationSample().catch(console.error);
