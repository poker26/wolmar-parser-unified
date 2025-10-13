#!/usr/bin/env node

/**
 * Тестовый скрипт для проверки системы анализа поведения
 * Проверяет работоспособность всех компонентов
 */

const AuctionBehaviorAnalyzer = require('./auction-behavior-analyzer');
const DetailedBehaviorInvestigator = require('./detailed-behavior-investigator');
const AntiManipulationStrategies = require('./anti-manipulation-strategies');

class BehaviorAnalysisTester {
    constructor() {
        this.dbConfig = {
            user: 'postgres.xkwgspqwebfeteoblayu',
            host: 'aws-0-eu-north-1.pooler.supabase.com',
            database: 'postgres',
            password: 'Gopapopa326+',
            port: 6543,
            ssl: { rejectUnauthorized: false }
        };
        
        this.testResults = {
            databaseConnection: false,
            behaviorAnalyzer: false,
            detailedInvestigator: false,
            antiManipulationStrategies: false,
            overallStatus: 'UNKNOWN'
        };
    }

    async runAllTests() {
        console.log('🧪 ЗАПУСК ТЕСТОВ СИСТЕМЫ АНАЛИЗА ПОВЕДЕНИЯ');
        console.log('==========================================\n');

        try {
            // Тест 1: Подключение к базе данных
            await this.testDatabaseConnection();
            
            // Тест 2: Основной анализатор поведения
            await this.testBehaviorAnalyzer();
            
            // Тест 3: Детальный исследователь
            await this.testDetailedInvestigator();
            
            // Тест 4: Стратегии противодействия
            await this.testAntiManipulationStrategies();
            
            // Тест 5: Интеграционные тесты
            await this.testIntegration();
            
            // Вывод результатов
            this.displayTestResults();
            
        } catch (error) {
            console.error('❌ Критическая ошибка тестирования:', error.message);
            this.testResults.overallStatus = 'FAILED';
        }
    }

    async testDatabaseConnection() {
        console.log('🔌 Тест 1: Подключение к базе данных');
        console.log('=====================================');
        
        try {
            const analyzer = new AuctionBehaviorAnalyzer(this.dbConfig);
            await analyzer.init();
            await analyzer.close();
            
            this.testResults.databaseConnection = true;
            console.log('✅ Подключение к базе данных: УСПЕШНО\n');
            
        } catch (error) {
            console.log('❌ Подключение к базе данных: ОШИБКА');
            console.log(`   Причина: ${error.message}\n`);
        }
    }

    async testBehaviorAnalyzer() {
        console.log('🔍 Тест 2: Основной анализатор поведения');
        console.log('=========================================');
        
        try {
            const analyzer = new AuctionBehaviorAnalyzer(this.dbConfig);
            await analyzer.init();
            
            // Тестируем каждый метод анализа
            console.log('   Тестирование анализа подозрительных продавцов...');
            const suspiciousSellers = await analyzer.analyzeSuspiciousSellers();
            console.log(`   ✅ Найдено ${suspiciousSellers.length} подозрительных продавцов`);
            
            console.log('   Тестирование анализа манипуляций с ценами...');
            const priceManipulation = await analyzer.analyzePriceManipulation();
            console.log(`   ✅ Найдено ${priceManipulation.length} случаев манипуляций с ценами`);
            
            console.log('   Тестирование анализа множественных аккаунтов...');
            const multipleAccounts = await analyzer.analyzeMultipleAccounts();
            console.log(`   ✅ Найдено ${multipleAccounts.length} подозрительных пар аккаунтов`);
            
            console.log('   Тестирование анализа тактики "приманки"...');
            const baitingTactics = await analyzer.analyzeBaitingTactics();
            console.log(`   ✅ Найдено ${baitingTactics.length} случаев тактики "приманки"`);
            
            console.log('   Тестирование анализа повторных покупок...');
            const repeatedPurchases = await analyzer.analyzeRepeatedPurchases();
            console.log(`   ✅ Найдено ${repeatedPurchases.length} случаев повторных покупок`);
            
            await analyzer.close();
            
            this.testResults.behaviorAnalyzer = true;
            console.log('✅ Основной анализатор поведения: УСПЕШНО\n');
            
        } catch (error) {
            console.log('❌ Основной анализатор поведения: ОШИБКА');
            console.log(`   Причина: ${error.message}\n`);
        }
    }

    async testDetailedInvestigator() {
        console.log('🔬 Тест 3: Детальный исследователь');
        console.log('===================================');
        
        try {
            const investigator = new DetailedBehaviorInvestigator(this.dbConfig);
            await investigator.init();
            
            console.log('   Тестирование поиска синхронных паттернов...');
            const syncPatterns = await investigator.findSynchronousBiddingPatterns();
            console.log(`   ✅ Найдено ${syncPatterns.length} синхронных паттернов`);
            
            console.log('   Тестирование анализа мертвых лотов...');
            const deadLots = await investigator.analyzeDeadLots();
            console.log(`   ✅ Найдено ${deadLots.length} продавцов с мертвыми лотами`);
            
            await investigator.close();
            
            this.testResults.detailedInvestigator = true;
            console.log('✅ Детальный исследователь: УСПЕШНО\n');
            
        } catch (error) {
            console.log('❌ Детальный исследователь: ОШИБКА');
            console.log(`   Причина: ${error.message}\n`);
        }
    }

    async testAntiManipulationStrategies() {
        console.log('🛡️ Тест 4: Стратегии противодействия');
        console.log('=====================================');
        
        try {
            const strategies = new AntiManipulationStrategies();
            
            console.log('   Тестирование генерации стратегий детекции...');
            strategies.generateDetectionStrategies();
            console.log(`   ✅ Сгенерировано ${strategies.strategies.detection.length} стратегий детекции`);
            
            console.log('   Тестирование генерации стратегий предотвращения...');
            strategies.generatePreventionStrategies();
            console.log(`   ✅ Сгенерировано ${strategies.strategies.prevention.length} стратегий предотвращения`);
            
            console.log('   Тестирование генерации стратегий принуждения...');
            strategies.generateEnforcementStrategies();
            console.log(`   ✅ Сгенерировано ${strategies.strategies.enforcement.length} стратегий принуждения`);
            
            console.log('   Тестирование генерации стратегий мониторинга...');
            strategies.generateMonitoringStrategies();
            console.log(`   ✅ Сгенерировано ${strategies.strategies.monitoring.length} стратегий мониторинга`);
            
            console.log('   Тестирование генерации полного плана...');
            const plan = await strategies.generateFullPlan();
            console.log(`   ✅ Сгенерирован полный план с ${plan.summary.totalStrategies} стратегиями`);
            
            this.testResults.antiManipulationStrategies = true;
            console.log('✅ Стратегии противодействия: УСПЕШНО\n');
            
        } catch (error) {
            console.log('❌ Стратегии противодействия: ОШИБКА');
            console.log(`   Причина: ${error.message}\n`);
        }
    }

    async testIntegration() {
        console.log('🔗 Тест 5: Интеграционные тесты');
        console.log('===============================');
        
        try {
            // Тест полного анализа
            console.log('   Тестирование полного анализа...');
            const analyzer = new AuctionBehaviorAnalyzer(this.dbConfig);
            await analyzer.init();
            const fullResults = await analyzer.generateComprehensiveReport();
            await analyzer.close();
            
            console.log(`   ✅ Полный анализ завершен: ${fullResults.summary.totalSuspiciousSellers} подозрительных продавцов`);
            
            // Тест генерации отчета
            console.log('   Тестирование генерации отчета...');
            const investigator = new DetailedBehaviorInvestigator(this.dbConfig);
            await investigator.init();
            
            // Если есть подозрительные продавцы, тестируем детальный анализ
            if (fullResults.suspiciousSellers.length > 0) {
                const testSeller = fullResults.suspiciousSellers[0].winner_nick;
                console.log(`   Тестирование детального анализа продавца: ${testSeller}`);
                const detailedReport = await investigator.generateDetailedReport(testSeller, 'seller');
                console.log(`   ✅ Детальный отчет сгенерирован для ${testSeller}`);
            }
            
            await investigator.close();
            
            console.log('✅ Интеграционные тесты: УСПЕШНО\n');
            
        } catch (error) {
            console.log('❌ Интеграционные тесты: ОШИБКА');
            console.log(`   Причина: ${error.message}\n`);
        }
    }

    displayTestResults() {
        console.log('📊 РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ');
        console.log('===========================');
        
        const tests = [
            { name: 'Подключение к базе данных', result: this.testResults.databaseConnection },
            { name: 'Основной анализатор поведения', result: this.testResults.behaviorAnalyzer },
            { name: 'Детальный исследователь', result: this.testResults.detailedInvestigator },
            { name: 'Стратегии противодействия', result: this.testResults.antiManipulationStrategies }
        ];
        
        let passedTests = 0;
        
        tests.forEach(test => {
            const status = test.result ? '✅ ПРОЙДЕН' : '❌ ПРОВАЛЕН';
            console.log(`${status} ${test.name}`);
            if (test.result) passedTests++;
        });
        
        console.log(`\n📈 ИТОГО: ${passedTests}/${tests.length} тестов пройдено`);
        
        if (passedTests === tests.length) {
            this.testResults.overallStatus = 'PASSED';
            console.log('🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!');
            console.log('✅ Система анализа поведения готова к использованию');
        } else {
            this.testResults.overallStatus = 'FAILED';
            console.log('⚠️ НЕКОТОРЫЕ ТЕСТЫ ПРОВАЛЕНЫ');
            console.log('❌ Требуется исправление ошибок перед использованием');
        }
        
        // Рекомендации
        console.log('\n💡 РЕКОМЕНДАЦИИ:');
        if (this.testResults.overallStatus === 'PASSED') {
            console.log('1. Система готова к интеграции в основной проект');
            console.log('2. Можно запускать полный анализ: node run-auction-analysis.js');
            console.log('3. Рекомендуется настроить мониторинг в реальном времени');
        } else {
            console.log('1. Проверьте подключение к базе данных');
            console.log('2. Убедитесь в корректности структуры таблицы auction_lots');
            console.log('3. Проверьте права доступа к базе данных');
        }
    }

    async runQuickTest() {
        console.log('⚡ БЫСТРЫЙ ТЕСТ СИСТЕМЫ');
        console.log('=======================\n');
        
        try {
            const analyzer = new AuctionBehaviorAnalyzer(this.dbConfig);
            await analyzer.init();
            
            console.log('🔍 Тестирование базового анализа...');
            const results = await analyzer.generateComprehensiveReport();
            
            console.log('\n📊 РЕЗУЛЬТАТЫ БЫСТРОГО ТЕСТА:');
            console.log('==============================');
            console.log(`✅ Подключение к БД: РАБОТАЕТ`);
            console.log(`✅ Анализ подозрительных продавцов: ${results.summary.totalSuspiciousSellers}`);
            console.log(`✅ Анализ манипуляций с ценами: ${results.summary.totalPriceManipulators}`);
            console.log(`✅ Анализ множественных аккаунтов: ${results.summary.totalMultipleAccounts}`);
            console.log(`✅ Анализ тактики "приманки": ${results.summary.totalBaitingCases}`);
            console.log(`✅ Анализ повторных покупок: ${results.summary.totalRepeatedPurchases}`);
            
            await analyzer.close();
            
            console.log('\n🎉 БЫСТРЫЙ ТЕСТ ПРОЙДЕН УСПЕШНО!');
            
        } catch (error) {
            console.log('❌ БЫСТРЫЙ ТЕСТ ПРОВАЛЕН');
            console.log(`Причина: ${error.message}`);
        }
    }
}

// CLI интерфейс
if (require.main === module) {
    const args = process.argv.slice(2);
    const tester = new BehaviorAnalysisTester();

    async function main() {
        if (args.includes('--quick') || args.includes('-q')) {
            await tester.runQuickTest();
        } else if (args.includes('--help') || args.includes('-h')) {
            console.log(`
🧪 Тестер системы анализа поведения

Использование:
  node test-behavior-analysis.js [опции]

Опции:
  --quick, -q     Быстрый тест (только основные компоненты)
  --full, -f      Полный тест (по умолчанию)
  --help, -h      Показать эту справку

Примеры:
  node test-behavior-analysis.js              # Полный тест
  node test-behavior-analysis.js --quick      # Быстрый тест
  node test-behavior-analysis.js --help       # Справка
            `);
        } else {
            await tester.runAllTests();
        }
    }

    main().catch(error => {
        console.error('❌ Критическая ошибка тестирования:', error.message);
        process.exit(1);
    });
}

module.exports = BehaviorAnalysisTester;
