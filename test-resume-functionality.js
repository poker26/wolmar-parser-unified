const WolmarCategoryParser = require('./wolmar-category-parser');
const config = require('./config');
const fs = require('fs');
const path = require('path');

async function testResumeFunctionality() {
    console.log('🧪 ТЕСТИРОВАНИЕ ФУНКЦИИ ВОЗОБНОВЛЕНИЯ');
    console.log('=====================================');
    
    const auctionNumber = 2012; // Используем текущий аукцион
    const parser = new WolmarCategoryParser(config.dbConfig, 'resume', auctionNumber);
    
    try {
        console.log('\n1️⃣ Инициализируем парсер...');
        await parser.init();
        
        console.log('\n2️⃣ Проверяем файл прогресса...');
        const progressFile = path.join(__dirname, 'logs', 'category-parser-progress.json');
        console.log(`📁 Файл прогресса: ${progressFile}`);
        
        if (fs.existsSync(progressFile)) {
            const progressContent = fs.readFileSync(progressFile, 'utf8');
            const progress = JSON.parse(progressContent);
            console.log('📊 Текущий прогресс:');
            console.log(`   Обработано: ${progress.processed || 0}`);
            console.log(`   Ошибок: ${progress.errors || 0}`);
            console.log(`   Пропущено: ${progress.skipped || 0}`);
            console.log(`   Последний лот: ${progress.lastProcessedLot || 'не указан'}`);
            console.log(`   Последняя категория: ${progress.lastProcessedCategory || 'не указана'}`);
            console.log(`   Индекс категории: ${progress.lastProcessedCategoryIndex || 0}`);
            
            if (progress.categoryProgress) {
                console.log('📋 Прогресс по категориям:');
                Object.entries(progress.categoryProgress).forEach(([category, data]) => {
                    console.log(`   ${category}: ${data.processed || 0}/${data.total || 0} лотов`);
                });
            }
        } else {
            console.log('❌ Файл прогресса не найден');
        }
        
        console.log('\n3️⃣ Тестируем загрузку прогресса...');
        const loadedProgress = parser.loadProgress();
        if (loadedProgress) {
            console.log('✅ Прогресс загружен успешно');
            console.log(`   lastProcessedLot: ${parser.lastProcessedLot}`);
            console.log(`   lastProcessedCategory: ${parser.lastProcessedCategory}`);
            console.log(`   lastProcessedCategoryIndex: ${parser.lastProcessedCategoryIndex}`);
        } else {
            console.log('⚠️ Прогресс не загружен');
        }
        
        console.log('\n4️⃣ Тестируем возобновление парсинга...');
        console.log('🔄 Запускаем resume с resumeFromLastLot: true');
        
        // Тестируем возобновление с загрузкой последнего лота
        await parser.parseSpecificAuction(auctionNumber, 1, {
            skipExisting: true,
            delayBetweenLots: 1000,
            includeBids: false,
            resumeFromLastLot: true,
            maxLots: 5 // Ограничиваем для теста
        });
        
        console.log('\n✅ Тест возобновления завершен');
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error.message);
        console.error('❌ Стек ошибки:', error.stack);
    } finally {
        if (parser.browser) {
            await parser.browser.close();
        }
        if (parser.dbClient) {
            await parser.dbClient.end();
        }
    }
}

if (require.main === module) {
    testResumeFunctionality();
}
