#!/usr/bin/env node

/**
 * Главный скрипт для запуска полного анализа поведения на аукционе
 * Проверяет гипотезы Анатолия QGL и генерирует план противодействия
 */

const AuctionBehaviorAnalyzer = require('./auction-behavior-analyzer');
const DetailedBehaviorInvestigator = require('./detailed-behavior-investigator');
const AntiManipulationStrategies = require('./anti-manipulation-strategies');
const fs = require('fs').promises;

class AuctionAnalysisRunner {
    constructor() {
        this.dbConfig = {
            user: 'postgres.xkwgspqwebfeteoblayu',
            host: 'aws-0-eu-north-1.pooler.supabase.com',
            database: 'postgres',
            password: 'Gopapopa326+',
            port: 6543,
            ssl: { rejectUnauthorized: false }
        };
        
        this.results = {
            behaviorAnalysis: null,
            detailedInvestigation: null,
            antiManipulationPlan: null,
            summary: null
        };
    }

    async runFullAnalysis() {
        console.log('🚀 ЗАПУСК ПОЛНОГО АНАЛИЗА ПОВЕДЕНИЯ НА АУКЦИОНЕ');
        console.log('================================================');
        console.log('📋 Проверяем гипотезы Анатолия QGL о манипуляциях продавцов\n');

        try {
            // Этап 1: Основной анализ поведения
            console.log('🔍 ЭТАП 1: Анализ поведения на аукционе');
            console.log('=====================================');
            const analyzer = new AuctionBehaviorAnalyzer(this.dbConfig);
            await analyzer.init();
            this.results.behaviorAnalysis = await analyzer.generateComprehensiveReport();
            await analyzer.close();

            // Этап 2: Детальное расследование
            console.log('\n🔬 ЭТАП 2: Детальное расследование');
            console.log('=================================');
            const investigator = new DetailedBehaviorInvestigator(this.dbConfig);
            await investigator.init();
            
            // Анализ синхронных паттернов
            const syncPatterns = await investigator.findSynchronousBiddingPatterns();
            const deadLots = await investigator.analyzeDeadLots();
            
            this.results.detailedInvestigation = {
                synchronousPatterns: syncPatterns,
                deadLots: deadLots,
                timestamp: new Date().toISOString()
            };
            
            await investigator.close();

            // Этап 3: Генерация плана противодействия
            console.log('\n🛡️ ЭТАП 3: Генерация плана противодействия');
            console.log('=========================================');
            const strategies = new AntiManipulationStrategies();
            this.results.antiManipulationPlan = await strategies.generateFullPlan();

            // Этап 4: Создание итогового отчета
            await this.generateFinalReport();

            // Вывод результатов
            this.displayResults();

        } catch (error) {
            console.error('❌ Ошибка выполнения анализа:', error.message);
            console.error(error.stack);
        }
    }

    async generateFinalReport() {
        console.log('\n📋 Генерация итогового отчета...');
        
        const finalReport = {
            title: 'Анализ поведения на аукционе Wolmar - Проверка гипотез Анатолия QGL',
            generatedAt: new Date().toISOString(),
            hypotheses: {
                priceManipulation: {
                    status: this.results.behaviorAnalysis?.summary?.hypotheses?.priceManipulation || 'UNKNOWN',
                    evidence: this.results.behaviorAnalysis?.priceManipulation?.length || 0,
                    description: 'Продавцы разгоняют цены с помощью фейковых ставок'
                },
                multipleAccounts: {
                    status: this.results.behaviorAnalysis?.summary?.hypotheses?.multipleAccounts || 'UNKNOWN',
                    evidence: this.results.behaviorAnalysis?.multipleAccounts?.length || 0,
                    description: 'Один продавец использует несколько аккаунтов'
                },
                baitingTactics: {
                    status: this.results.behaviorAnalysis?.summary?.hypotheses?.baitingTactics || 'UNKNOWN',
                    evidence: this.results.behaviorAnalysis?.baitingTactics?.filter(b => b.baiting_level !== 'NORMAL').length || 0,
                    description: 'Продавцы держат покупателей на дешевых ставках, накручивая остальные'
                },
                repeatedPurchases: {
                    status: this.results.behaviorAnalysis?.summary?.hypotheses?.repeatedPurchases || 'UNKNOWN',
                    evidence: this.results.behaviorAnalysis?.repeatedPurchases?.filter(r => r.repetition_level !== 'NORMAL').length || 0,
                    description: 'Продавцы покупают одни и те же монеты многократно'
                }
            },
            keyFindings: this.generateKeyFindings(),
            recommendations: this.generateFinalRecommendations(),
            technicalImplementation: this.results.antiManipulationPlan?.implementationPlan || null,
            data: {
                behaviorAnalysis: this.results.behaviorAnalysis,
                detailedInvestigation: this.results.detailedInvestigation,
                antiManipulationPlan: this.results.antiManipulationPlan
            }
        };

        this.results.summary = finalReport;

        // Сохраняем итоговый отчет
        const filename = `final-auction-analysis-report-${new Date().toISOString().split('T')[0]}.json`;
        await fs.writeFile(filename, JSON.stringify(finalReport, null, 2));
        console.log(`💾 Итоговый отчет сохранен: ${filename}`);

        return finalReport;
    }

    generateKeyFindings() {
        const findings = [];
        
        if (this.results.behaviorAnalysis) {
            const summary = this.results.behaviorAnalysis.summary;
            
            if (summary.totalSuspiciousSellers > 0) {
                findings.push(`🔍 Найдено ${summary.totalSuspiciousSellers} подозрительных продавцов с аномальными паттернами поведения`);
            }
            
            if (summary.totalPriceManipulators > 0) {
                findings.push(`💰 Выявлено ${summary.totalPriceManipulators} случаев манипуляций с ценами`);
            }
            
            if (summary.totalMultipleAccounts > 0) {
                findings.push(`👥 Обнаружено ${summary.totalMultipleAccounts} подозрительных пар аккаунтов`);
            }
            
            if (summary.totalBaitingCases > 0) {
                findings.push(`🎣 Найдено ${summary.totalBaitingCases} случаев использования тактики "приманки"`);
            }
            
            if (summary.totalRepeatedPurchases > 0) {
                findings.push(`🔄 Выявлено ${summary.totalRepeatedPurchases} случаев повторных покупок одних и тех же лотов`);
            }
        }

        if (this.results.detailedInvestigation) {
            if (this.results.detailedInvestigation.synchronousPatterns.length > 0) {
                findings.push(`⏰ Обнаружено ${this.results.detailedInvestigation.synchronousPatterns.length} синхронных паттернов ставок`);
            }
            
            if (this.results.detailedInvestigation.deadLots.length > 0) {
                findings.push(`💀 Найдено ${this.results.detailedInvestigation.deadLots.length} продавцов с большим количеством "мертвых" лотов`);
            }
        }

        return findings;
    }

    generateFinalRecommendations() {
        const recommendations = {
            immediate: [
                'Внедрить систему мониторинга подозрительной активности в реальном времени',
                'Создать алгоритмы автоматической детекции фейковых ставок',
                'Настроить систему алертов для модераторов',
                'Внедрить базовую систему репутации пользователей'
            ],
            shortTerm: [
                'Разработать и внедрить ML-модели для детекции манипуляций',
                'Создать систему аналитических отчетов и дашбордов',
                'Внедрить автоматические штрафы и блокировки',
                'Настроить интеграцию с внешними системами безопасности'
            ],
            longTerm: [
                'Создать международную базу данных нарушителей',
                'Внедрить блокчейн-технологии для прозрачности торгов',
                'Разработать ИИ-систему для прогнозирования нарушений',
                'Создать образовательную программу для пользователей'
            ]
        };

        return recommendations;
    }

    displayResults() {
        console.log('\n🎯 ИТОГОВЫЕ РЕЗУЛЬТАТЫ АНАЛИЗА');
        console.log('===============================');
        
        if (this.results.summary) {
            console.log('\n📊 СТАТУС ГИПОТЕЗ АНАТОЛИЯ QGL:');
            console.log('================================');
            
            Object.entries(this.results.summary.hypotheses).forEach(([hypothesis, data]) => {
                const emoji = data.status === 'CONFIRMED' ? '✅' : data.status === 'NOT_CONFIRMED' ? '❌' : '❓';
                console.log(`${emoji} ${data.description}`);
                console.log(`   Статус: ${data.status}`);
                console.log(`   Найдено доказательств: ${data.evidence}`);
                console.log('');
            });

            console.log('\n🔍 КЛЮЧЕВЫЕ НАХОДКИ:');
            console.log('===================');
            this.results.summary.keyFindings.forEach((finding, index) => {
                console.log(`${index + 1}. ${finding}`);
            });

            console.log('\n🚨 КРИТИЧЕСКИЕ РЕКОМЕНДАЦИИ:');
            console.log('============================');
            this.results.summary.recommendations.immediate.forEach((rec, index) => {
                console.log(`${index + 1}. ${rec}`);
            });

            console.log('\n📈 ПЛАН ВНЕДРЕНИЯ:');
            console.log('=================');
            if (this.results.antiManipulationPlan?.implementationPlan) {
                const plan = this.results.antiManipulationPlan.implementationPlan;
                Object.entries(plan).forEach(([phase, details]) => {
                    console.log(`\n${phase.toUpperCase()}: ${details.name}`);
                    console.log(`Длительность: ${details.duration}`);
                    console.log('Задачи:');
                    details.tasks.forEach((task, index) => {
                        console.log(`  ${index + 1}. ${task}`);
                    });
                });
            }
        }

        console.log('\n✅ Анализ завершен! Проверьте сохраненные файлы для детальной информации.');
    }

    async runQuickAnalysis() {
        console.log('⚡ БЫСТРЫЙ АНАЛИЗ ПОВЕДЕНИЯ НА АУКЦИОНЕ');
        console.log('=====================================');
        
        try {
            const analyzer = new AuctionBehaviorAnalyzer(this.dbConfig);
            await analyzer.init();
            const results = await analyzer.generateComprehensiveReport();
            await analyzer.close();

            console.log('\n🎯 РЕЗУЛЬТАТЫ БЫСТРОГО АНАЛИЗА:');
            console.log('===============================');
            console.log(`📊 Подозрительных продавцов: ${results.summary.totalSuspiciousSellers}`);
            console.log(`💰 Манипуляторов ценами: ${results.summary.totalPriceManipulators}`);
            console.log(`👥 Множественных аккаунтов: ${results.summary.totalMultipleAccounts}`);
            console.log(`🎣 Случаев "приманки": ${results.summary.totalBaitingCases}`);
            console.log(`🔄 Повторных покупок: ${results.summary.totalRepeatedPurchases}`);

            return results;
        } catch (error) {
            console.error('❌ Ошибка быстрого анализа:', error.message);
            throw error;
        }
    }
}

// CLI интерфейс
if (require.main === module) {
    const args = process.argv.slice(2);
    const runner = new AuctionAnalysisRunner();

    async function main() {
        if (args.includes('--quick') || args.includes('-q')) {
            await runner.runQuickAnalysis();
        } else if (args.includes('--help') || args.includes('-h')) {
            console.log(`
🎯 Анализатор поведения на аукционе Wolmar

Использование:
  node run-auction-analysis.js [опции]

Опции:
  --quick, -q     Быстрый анализ (только основные метрики)
  --full, -f      Полный анализ (по умолчанию)
  --help, -h      Показать эту справку

Примеры:
  node run-auction-analysis.js              # Полный анализ
  node run-auction-analysis.js --quick      # Быстрый анализ
  node run-auction-analysis.js --help       # Справка
            `);
        } else {
            await runner.runFullAnalysis();
        }
    }

    main().catch(error => {
        console.error('❌ Критическая ошибка:', error.message);
        process.exit(1);
    });
}

module.exports = AuctionAnalysisRunner;
