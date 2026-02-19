/**
 * Главный скрипт для запуска сбора истории ставок
 * Поддерживает два режима: для новых лотов и для существующих
 */

const BiddingHistoryRetroactiveCollector = require('./add-bidding-history-to-existing-lots');
const NumismatParserWithBidding = require('./numismat-parser-with-bidding');

class BiddingHistoryManager {
    constructor(dbConfig) {
        this.dbConfig = dbConfig;
    }

    /**
     * Режим 1: Сбор истории ставок для существующих лотов
     */
    async collectForExistingLots(options = {}) {
        console.log('🔧 РЕЖИМ 1: Сбор истории ставок для существующих лотов');
        console.log('='.repeat(60));
        
        const collector = new BiddingHistoryRetroactiveCollector(this.dbConfig);
        
        try {
            await collector.init();
            
            const batchSize = options.batchSize || 50;
            const maxLots = options.maxLots || 1000;
            
            console.log(`📊 Параметры: batchSize=${batchSize}, maxLots=${maxLots}`);
            
            // Показываем текущую статистику
            const currentStats = await collector.getCollectionStatistics();
            console.log('\n📊 Текущая статистика:');
            console.log(`   Всего лотов: ${currentStats.lots.total_lots}`);
            console.log(`   С историей ставок: ${currentStats.lots.with_bidding_history}`);
            console.log(`   Без истории ставок: ${currentStats.lots.without_bidding_history}`);
            
            if (currentStats.lots.without_bidding_history === 0) {
                console.log('✅ Все лоты уже имеют историю ставок!');
                return;
            }
            
            // Запускаем сбор
            const results = await collector.collectBiddingHistoryForExistingLots(batchSize, maxLots);
            
            // Показываем результаты
            console.log('\n🎯 РЕЗУЛЬТАТЫ СБОРА:');
            console.log(`   Обработано лотов: ${results.processed}`);
            console.log(`   Собрано историй ставок: ${results.biddingHistoryCollected}`);
            console.log(`   Пропущено: ${results.skipped}`);
            console.log(`   Ошибок: ${results.errors}`);
            
            return results;
            
        } catch (error) {
            console.error('❌ Ошибка сбора истории ставок:', error.message);
            throw error;
        } finally {
            await collector.close();
        }
    }

    /**
     * Режим 2: Парсинг новых лотов с историей ставок
     */
    async parseNewLotsWithBidding(auctionNumber) {
        console.log('🔧 РЕЖИМ 2: Парсинг новых лотов с историей ставок');
        console.log('='.repeat(60));
        
        const parser = new NumismatParserWithBidding(this.dbConfig, auctionNumber);
        
        try {
            await parser.init();
            const results = await parser.parseAuctionWithBiddingHistory();
            
            console.log('\n🎯 РЕЗУЛЬТАТЫ ПАРСИНГА:');
            console.log(`   Аукцион: ${results.auctionNumber}`);
            console.log(`   Всего лотов: ${results.totalLots}`);
            console.log(`   Обработано: ${results.processed}`);
            console.log(`   Собрано историй ставок: ${results.biddingHistoryCollected}`);
            console.log(`   Ошибок: ${results.errors}`);
            
            return results;
            
        } catch (error) {
            console.error('❌ Ошибка парсинга новых лотов:', error.message);
            throw error;
        } finally {
            await parser.close();
        }
    }

    /**
     * Комплексный режим: оба варианта
     */
    async runComprehensiveCollection(options = {}) {
        console.log('🚀 КОМПЛЕКСНЫЙ РЕЖИМ: Сбор истории ставок');
        console.log('='.repeat(60));
        
        const results = {
            existingLots: null,
            newLots: null,
            summary: {}
        };

        try {
            // 1. Сбор для существующих лотов
            if (options.collectExisting !== false) {
                console.log('\n📦 ЭТАП 1: Сбор для существующих лотов');
                results.existingLots = await this.collectForExistingLots({
                    batchSize: options.batchSize || 50,
                    maxLots: options.maxLots || 1000
                });
            }

            // 2. Парсинг новых лотов (если указан номер аукциона)
            if (options.auctionNumber) {
                console.log('\n📦 ЭТАП 2: Парсинг новых лотов');
                results.newLots = await this.parseNewLotsWithBidding(options.auctionNumber);
            }

            // Создаем сводку
            results.summary = {
                timestamp: new Date().toISOString(),
                existingLotsProcessed: results.existingLots?.processed || 0,
                existingLotsBiddingCollected: results.existingLots?.biddingHistoryCollected || 0,
                newLotsProcessed: results.newLots?.processed || 0,
                newLotsBiddingCollected: results.newLots?.biddingHistoryCollected || 0,
                totalErrors: (results.existingLots?.errors || 0) + (results.newLots?.errors || 0)
            };

            console.log('\n🎉 КОМПЛЕКСНЫЙ СБОР ЗАВЕРШЕН!');
            console.log('='.repeat(60));
            console.log(`📊 СВОДКА:`);
            console.log(`   Обработано существующих лотов: ${results.summary.existingLotsProcessed}`);
            console.log(`   Собрано историй для существующих: ${results.summary.existingLotsBiddingCollected}`);
            console.log(`   Обработано новых лотов: ${results.summary.newLotsProcessed}`);
            console.log(`   Собрано историй для новых: ${results.summary.newLotsBiddingCollected}`);
            console.log(`   Всего ошибок: ${results.summary.totalErrors}`);

            console.log('\n🔍 Следующий шаг: запуск анализа поведения');
            console.log('node enhanced-behavior-analyzer.js');

            return results;

        } catch (error) {
            console.error('❌ Ошибка комплексного сбора:', error.message);
            throw error;
        }
    }

    /**
     * Показать статистику по истории ставок
     */
    async showStatistics() {
        console.log('📊 СТАТИСТИКА ПО ИСТОРИИ СТАВОК');
        console.log('='.repeat(60));
        
        const collector = new BiddingHistoryRetroactiveCollector(this.dbConfig);
        
        try {
            await collector.init();
            const stats = await collector.getCollectionStatistics();
            
            console.log('\n📋 ОСНОВНАЯ СТАТИСТИКА:');
            console.log(`   Всего лотов: ${stats.lots.total_lots}`);
            console.log(`   С историей ставок: ${stats.lots.with_bidding_history}`);
            console.log(`   Без истории ставок: ${stats.lots.without_bidding_history}`);
            
            const percentage = stats.lots.total_lots > 0 ? 
                (stats.lots.with_bidding_history / stats.lots.total_lots * 100).toFixed(1) : 0;
            console.log(`   Процент покрытия: ${percentage}%`);
            
            console.log('\n📈 СТАТИСТИКА СБОРА:');
            console.log(`   Всего попыток: ${stats.progress.total_attempts}`);
            console.log(`   Успешных попыток: ${stats.progress.successful_attempts}`);
            console.log(`   Неудачных попыток: ${stats.progress.failed_attempts}`);
            console.log(`   Среднее количество ставок на лот: ${stats.progress.avg_bids_per_lot || 0}`);
            
            if (stats.lots.without_bidding_history > 0) {
                console.log('\n💡 РЕКОМЕНДАЦИИ:');
                console.log('   Для полного анализа поведения рекомендуется собрать историю ставок для всех лотов.');
                console.log('   Запустите: node run-bidding-history-collection.js --existing');
            } else {
                console.log('\n✅ Все лоты имеют историю ставок!');
                console.log('   Можно запускать полный анализ поведения.');
            }
            
        } catch (error) {
            console.error('❌ Ошибка получения статистики:', error.message);
        } finally {
            await collector.close();
        }
    }
}

// CLI интерфейс
if (require.main === module) {
    const dbConfig = {
        user: 'postgres.xkwgspqwebfeteoblayu',
        host: 'sup.begemot26.ru',
        database: 'postgres',
        password: 'Gopapopa326+',
        port: 6543,
        ssl: { rejectUnauthorized: false }
    };

    async function main() {
        const manager = new BiddingHistoryManager(dbConfig);
        const args = process.argv.slice(2);
        
        try {
            if (args.includes('--stats') || args.includes('-s')) {
                // Показать статистику
                await manager.showStatistics();
                
            } else if (args.includes('--existing') || args.includes('-e')) {
                // Сбор для существующих лотов
                const batchSize = parseInt(args.find(arg => arg.startsWith('--batch='))?.split('=')[1]) || 50;
                const maxLots = parseInt(args.find(arg => arg.startsWith('--max='))?.split('=')[1]) || 1000;
                
                await manager.collectForExistingLots({ batchSize, maxLots });
                
            } else if (args.includes('--new') || args.includes('-n')) {
                // Парсинг новых лотов
                const auctionNumber = args.find(arg => arg.startsWith('--auction='))?.split('=')[1] || '2133';
                await manager.parseNewLotsWithBidding(auctionNumber);
                
            } else if (args.includes('--comprehensive') || args.includes('-c')) {
                // Комплексный режим
                const batchSize = parseInt(args.find(arg => arg.startsWith('--batch='))?.split('=')[1]) || 50;
                const maxLots = parseInt(args.find(arg => arg.startsWith('--max='))?.split('=')[1]) || 1000;
                const auctionNumber = args.find(arg => arg.startsWith('--auction='))?.split('=')[1];
                
                await manager.runComprehensiveCollection({ 
                    batchSize, 
                    maxLots, 
                    auctionNumber,
                    collectExisting: !args.includes('--skip-existing')
                });
                
            } else {
                // Показать справку
                console.log('🔧 МЕНЕДЖЕР СБОРА ИСТОРИИ СТАВОК');
                console.log('='.repeat(60));
                console.log('\n📋 ДОСТУПНЫЕ КОМАНДЫ:');
                console.log('   --stats, -s                    Показать статистику');
                console.log('   --existing, -e                 Сбор для существующих лотов');
                console.log('   --new, -n                      Парсинг новых лотов');
                console.log('   --comprehensive, -c            Комплексный режим');
                console.log('\n📊 ПАРАМЕТРЫ:');
                console.log('   --batch=N                      Размер батча (по умолчанию: 50)');
                console.log('   --max=N                        Максимум лотов (по умолчанию: 1000)');
                console.log('   --auction=N                    Номер аукциона для новых лотов');
                console.log('   --skip-existing                Пропустить сбор для существующих');
                console.log('\n💡 ПРИМЕРЫ:');
                console.log('   node run-bidding-history-collection.js --stats');
                console.log('   node run-bidding-history-collection.js --existing --batch=100');
                console.log('   node run-bidding-history-collection.js --new --auction=2134');
                console.log('   node run-bidding-history-collection.js --comprehensive --auction=2134');
            }
            
        } catch (error) {
            console.error('❌ Ошибка выполнения:', error.message);
            process.exit(1);
        }
    }

    main();
}

module.exports = BiddingHistoryManager;
