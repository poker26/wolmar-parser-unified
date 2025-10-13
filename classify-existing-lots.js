const { Pool } = require('pg');
const LotClassifier = require('./lot-classifier');

// Импортируем конфигурацию
const config = require('./config');

// Конфигурация базы данных Supabase
const dbConfig = config.dbConfig;

class LotClassificationService {
    constructor() {
        this.classifier = new LotClassifier();
        this.pool = new Pool(dbConfig);
        this.batchSize = 1000; // Обрабатываем по 1000 записей за раз
    }

    /**
     * Классифицирует все лоты в базе данных
     */
    async classifyAllLots() {
        try {
            console.log('🚀 Начинаем классификацию всех лотов...');
            
            // Получаем общее количество лотов
            const totalQuery = 'SELECT COUNT(*) as total FROM auction_lots';
            const totalResult = await this.pool.query(totalQuery);
            const totalLots = parseInt(totalResult.rows[0].total);
            
            console.log(`📊 Всего лотов для классификации: ${totalLots}`);
            
            let processedCount = 0;
            let classifiedCount = 0;
            let skippedCount = 0;
            const categoryStats = {};
            
            // Обрабатываем лоты батчами
            for (let offset = 0; offset < totalLots; offset += this.batchSize) {
                console.log(`\n🔄 Обрабатываем батч ${Math.floor(offset / this.batchSize) + 1} (${offset + 1}-${Math.min(offset + this.batchSize, totalLots)})...`);
                
                // Получаем батч лотов
                const batchQuery = `
                    SELECT id, coin_description, letters, metal, year, category, lot_type
                    FROM auction_lots 
                    ORDER BY id 
                    LIMIT $1 OFFSET $2
                `;
                
                const batchResult = await this.pool.query(batchQuery, [this.batchSize, offset]);
                const lots = batchResult.rows;
                
                if (lots.length === 0) break;
                
                // Классифицируем каждый лот в батче
                for (const lot of lots) {
                    processedCount++;
                    
                    // Пропускаем лоты, которые уже имеют категорию
                    if (lot.category) {
                        skippedCount++;
                        continue;
                    }
                    
                    // Классифицируем лот
                    const classification = this.classifier.classify(lot);
                    
                    if (classification) {
                        // Обновляем категорию в базе данных
                        const updateQuery = `
                            UPDATE auction_lots 
                            SET category = $1 
                            WHERE id = $2
                        `;
                        
                        await this.pool.query(updateQuery, [classification, lot.id]);
                        classifiedCount++;
                        
                        // Обновляем статистику
                        categoryStats[classification] = (categoryStats[classification] || 0) + 1;
                        
                        if (processedCount % 100 === 0) {
                            console.log(`  ✅ Обработано: ${processedCount}/${totalLots}, классифицировано: ${classifiedCount}, пропущено: ${skippedCount}`);
                        }
                    }
                }
                
                // Показываем прогресс
                const progress = ((offset + lots.length) / totalLots * 100).toFixed(1);
                console.log(`📈 Прогресс: ${progress}% (${offset + lots.length}/${totalLots})`);
            }
            
            // Выводим итоговую статистику
            console.log('\n🎉 Классификация завершена!');
            console.log(`📊 Итоговая статистика:`);
            console.log(`  Всего обработано: ${processedCount}`);
            console.log(`  Классифицировано: ${classifiedCount}`);
            console.log(`  Пропущено (уже имели категорию): ${skippedCount}`);
            console.log(`  Не удалось классифицировать: ${processedCount - classifiedCount - skippedCount}`);
            
            console.log('\n📋 Распределение по категориям:');
            Object.entries(categoryStats)
                .sort(([,a], [,b]) => b - a)
                .forEach(([category, count]) => {
                    const percentage = (count / classifiedCount * 100).toFixed(1);
                    console.log(`  ${category}: ${count} (${percentage}%)`);
                });
            
        } catch (error) {
            console.error('❌ Ошибка при классификации лотов:', error);
            throw error;
        }
    }

    /**
     * Классифицирует лоты с низкой уверенностью для повторного анализа
     */
    async reclassifyLowConfidenceLots(minConfidence = 0.3) {
        try {
            console.log(`🔍 Повторная классификация лотов с уверенностью < ${minConfidence}...`);
            
            // Получаем лоты без категории
            const unclassifiedQuery = `
                SELECT id, coin_description, letters, denomination, metal, year
                FROM auction_lots 
                WHERE category IS NULL
                ORDER BY id
            `;
            
            const unclassifiedResult = await this.pool.query(unclassifiedQuery);
            const unclassifiedLots = unclassifiedResult.rows;
            
            console.log(`📊 Найдено ${unclassifiedLots.length} лотов без категории`);
            
            let reclassifiedCount = 0;
            const categoryStats = {};
            
            for (const lot of unclassifiedLots) {
                // Получаем детальную классификацию
                const detailedClassification = this.classifier.classifyDetailed(lot);
                
                if (detailedClassification.category && detailedClassification.confidence >= minConfidence) {
                    // Обновляем категорию
                    const updateQuery = `
                        UPDATE auction_lots 
                        SET category = $1 
                        WHERE id = $2
                    `;
                    
                    await this.pool.query(updateQuery, [detailedClassification.category, lot.id]);
                    reclassifiedCount++;
                    
                    // Обновляем статистику
                    categoryStats[detailedClassification.category] = (categoryStats[detailedClassification.category] || 0) + 1;
                }
            }
            
            console.log(`✅ Повторно классифицировано: ${reclassifiedCount} лотов`);
            
            if (Object.keys(categoryStats).length > 0) {
                console.log('\n📋 Распределение по категориям (повторная классификация):');
                Object.entries(categoryStats)
                    .sort(([,a], [,b]) => b - a)
                    .forEach(([category, count]) => {
                        console.log(`  ${category}: ${count}`);
                    });
            }
            
        } catch (error) {
            console.error('❌ Ошибка при повторной классификации:', error);
            throw error;
        }
    }

    /**
     * Анализирует качество классификации
     */
    async analyzeClassificationQuality() {
        try {
            console.log('📊 Анализ качества классификации...');
            
            // Статистика по категориям
            const categoryStatsQuery = `
                SELECT category, COUNT(*) as count
                FROM auction_lots 
                WHERE category IS NOT NULL
                GROUP BY category
                ORDER BY count DESC
            `;
            
            const categoryStatsResult = await this.pool.query(categoryStatsQuery);
            
            console.log('\n📋 Статистика по категориям:');
            categoryStatsResult.rows.forEach(row => {
                console.log(`  ${row.category}: ${row.count} лотов`);
            });
            
            // Процент классифицированных лотов
            const totalQuery = 'SELECT COUNT(*) as total FROM auction_lots';
            const classifiedQuery = 'SELECT COUNT(*) as classified FROM auction_lots WHERE category IS NOT NULL';
            
            const [totalResult, classifiedResult] = await Promise.all([
                this.pool.query(totalQuery),
                this.pool.query(classifiedQuery)
            ]);
            
            const total = parseInt(totalResult.rows[0].total);
            const classified = parseInt(classifiedResult.rows[0].classified);
            const percentage = (classified / total * 100).toFixed(1);
            
            console.log(`\n📈 Общая статистика:`);
            console.log(`  Всего лотов: ${total}`);
            console.log(`  Классифицировано: ${classified}`);
            console.log(`  Процент классификации: ${percentage}%`);
            
        } catch (error) {
            console.error('❌ Ошибка при анализе качества:', error);
            throw error;
        }
    }

    async close() {
        await this.pool.end();
    }
}

// Основная функция
async function main() {
    const service = new LotClassificationService();
    
    try {
        // Добавляем поле category если его нет
        console.log('🔧 Проверяем наличие поля category...');
        const checkFieldQuery = `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'auction_lots' 
            AND column_name = 'category'
        `;
        
        const checkResult = await service.pool.query(checkFieldQuery);
        
        if (checkResult.rows.length === 0) {
            console.log('❌ Поле category не найдено. Сначала запустите add-category-field-to-auction-lots.js');
            return;
        }
        
        console.log('✅ Поле category найдено');
        
        // Классифицируем все лоты
        await service.classifyAllLots();
        
        // Анализируем качество
        await service.analyzeClassificationQuality();
        
        // Повторная классификация с низкой уверенностью
        await service.reclassifyLowConfidenceLots(0.2);
        
        // Финальный анализ
        await service.analyzeClassificationQuality();
        
    } catch (error) {
        console.error('❌ Ошибка в main:', error);
    } finally {
        await service.close();
    }
}

// Запускаем скрипт
if (require.main === module) {
    main().catch(console.error);
}

module.exports = LotClassificationService;
