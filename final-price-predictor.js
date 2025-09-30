/**
 * Финальная система прогнозирования цен лотов
 * Калибровка на основе реальных исторических данных
 */

const { Client } = require('pg');
const config = require('./config');

class FinalPricePredictor {
    constructor() {
        this.dbConfig = config.dbConfig;
        this.dbClient = new Client(this.dbConfig);
    }

    async init() {
        await this.dbClient.connect();
        console.log('🔗 Подключение к базе данных установлено');
    }

    // Калибровка модели на исторических данных
    async calibrateModel() {
        console.log('\n🔧 КАЛИБРОВКА МОДЕЛИ НА ИСТОРИЧЕСКИХ ДАННЫХ:');
        
        // Получаем статистику по состояниям и металлам
        const calibrationData = await this.dbClient.query(`
            SELECT 
                condition,
                metal,
                COUNT(*) as sample_size,
                AVG(winning_bid) as avg_price,
                AVG(weight) as avg_weight,
                MIN(winning_bid) as min_price,
                MAX(winning_bid) as max_price,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY winning_bid) as median_price
            FROM auction_lots 
            WHERE winning_bid IS NOT NULL 
                AND winning_bid > 0
                AND condition IS NOT NULL
                AND metal IS NOT NULL
            GROUP BY condition, metal
            HAVING COUNT(*) >= 5
            ORDER BY avg_price DESC;
        `);
        
        console.log(`📊 Получено ${calibrationData.rows.length} комбинаций для калибровки`);
        
        // Создаем калибровочную таблицу
        this.calibrationTable = {};
        
        for (const row of calibrationData.rows) {
            const key = `${row.condition}_${row.metal}`;
            this.calibrationTable[key] = {
                avgPrice: row.avg_price,
                medianPrice: row.median_price,
                sampleSize: row.sample_size,
                avgWeight: row.avg_weight,
                minPrice: row.min_price,
                maxPrice: row.max_price
            };
        }
        
        // Показываем топ-10 комбинаций
        console.log('\n📋 Топ-10 комбинаций состояние+металл:');
        calibrationData.rows.slice(0, 10).forEach((row, index) => {
            console.log(`  ${index + 1}. ${row.condition} + ${row.metal}: ${row.sample_size} лотов, средняя цена: ${Math.round(row.avg_price).toLocaleString()}₽`);
        });
        
        return this.calibrationTable;
    }

    // Основная функция прогнозирования с калибровкой
    async predictPrice(lot) {
        const { metal, weight, condition, year, letters, coin_description } = lot;
        
        // 1. Ищем точную калибровку
        const calibrationKey = `${condition}_${metal}`;
        const calibration = this.calibrationTable[calibrationKey];
        
        if (calibration && calibration.sampleSize >= 5) {
            // Используем калиброванные данные
            let predictedPrice = calibration.medianPrice; // Используем медиану как более стабильную
            
            // Корректировка на вес (если есть)
            if (weight && calibration.avgWeight && calibration.avgWeight > 0) {
                const weightRatio = weight / calibration.avgWeight;
                predictedPrice *= weightRatio;
            }
            
            // Корректировка на год
            if (year && !isNaN(year)) {
                const yearNum = parseInt(year);
                if (yearNum < 1800) {
                    predictedPrice *= 1.3; // +30% за очень старые
                } else if (yearNum < 1900) {
                    predictedPrice *= 1.2; // +20% за дореволюционные
                } else if (yearNum < 1950) {
                    predictedPrice *= 1.1; // +10% за советские до 1950
                }
            }
            
            // Корректировка на редкость
            if (coin_description) {
                const desc = coin_description.toLowerCase();
                if (desc.includes('редк') || desc.includes('уник')) {
                    predictedPrice *= 1.5; // +50% за редкие
                }
            }
            
            return {
                predictedPrice: Math.round(predictedPrice),
                metalValue: 0, // Не рассчитываем для калиброванной модели
                numismaticPremium: Math.round(predictedPrice),
                conditionMultiplier: 1.0,
                confidence: Math.min(0.9, 0.5 + (calibration.sampleSize / 100)), // Уверенность зависит от размера выборки
                method: 'calibrated'
            };
        }
        
        // 2. Если нет точной калибровки, используем упрощенную модель
        return this.simplePrediction(lot);
    }

    // Упрощенная модель для случаев без калибровки
    simplePrediction(lot) {
        const { metal, weight, condition } = lot;
        
        // Базовые цены по металлам (калиброванные на исторических данных)
        const basePrices = {
            'Au': 50000,  // Базовая цена золотой монеты
            'Ag': 5000,   // Базовая цена серебряной монеты
            'Cu': 2000,   // Базовая цена медной монеты
            'Fe': 1000,   // Базовая цена железной монеты
            'Ni': 1500    // Базовая цена никелевой монеты
        };
        
        // Коэффициенты состояний (упрощенные)
        const conditionMultipliers = {
            'MS64': 2.0, 'MS61': 1.8, 'MS62': 1.6, 'MS65': 1.4, 'MS63': 1.2, 'MS60': 1.0, 'MS66': 0.8,
            'MS': 1.0, 'AU55': 1.5, 'AU58': 1.3, 'AU': 0.6, 'AU/UNC': 0.7,
            'UNC': 0.5, 'XF+/AU': 0.6, 'XF': 0.4, 'VF': 0.3, 'F': 0.2, 'G': 0.1,
            'PL': 0.8, 'XX': 0.9, 'Superb': 0.7, 'Gem': 0.6, 'Ch': 0.7
        };
        
        const basePrice = basePrices[metal] || 1000;
        const conditionMultiplier = conditionMultipliers[condition] || 0.3;
        
        let predictedPrice = basePrice * conditionMultiplier;
        
        // Корректировка на вес
        if (weight && weight > 0) {
            predictedPrice *= (weight / 5.0); // Нормализуем к 5г
        }
        
        return {
            predictedPrice: Math.round(predictedPrice),
            metalValue: Math.round(basePrice * 0.1), // Примерная стоимость металла
            numismaticPremium: Math.round(predictedPrice * 0.9),
            conditionMultiplier: conditionMultiplier,
            confidence: 0.3, // Низкая уверенность для упрощенной модели
            method: 'simple'
        };
    }

    // Прогнозирование для текущего аукциона
    async predictCurrentAuctionPrices(auctionNumber) {
        console.log(`\n🔮 ФИНАЛЬНОЕ прогнозирование цен для аукциона ${auctionNumber}:`);
        
        // Калибруем модель
        await this.calibrateModel();
        
        // Получаем лоты текущего аукциона
        const lots = await this.dbClient.query(`
            SELECT 
                id, lot_number, condition, metal, weight, year, letters,
                winning_bid, coin_description
            FROM auction_lots 
            WHERE auction_number = $1
            ORDER BY lot_number
            LIMIT 30;
        `, [auctionNumber]);
        
        console.log(`📊 Найдено ${lots.rows.length} лотов для прогнозирования`);
        
        const predictions = [];
        let totalAccuracy = 0;
        let validPredictions = 0;
        let calibratedCount = 0;
        let simpleCount = 0;
        
        for (const lot of lots.rows) {
            const prediction = await this.predictPrice(lot);
            
            predictions.push({
                lotId: lot.id,
                lotNumber: lot.lot_number,
                condition: lot.condition,
                metal: lot.metal,
                weight: lot.weight,
                year: lot.year,
                predictedPrice: prediction.predictedPrice,
                metalValue: prediction.metalValue,
                numismaticPremium: prediction.numismaticPremium,
                confidence: prediction.confidence,
                method: prediction.method,
                actualPrice: lot.winning_bid,
                description: lot.coin_description
            });
            
            if (prediction.method === 'calibrated') calibratedCount++;
            else simpleCount++;
            
            console.log(`📋 Лот ${lot.lot_number}: ${lot.condition} | ${lot.metal} | ${lot.weight || 'нет'}г`);
            console.log(`   Прогноз: ${prediction.predictedPrice.toLocaleString()}₽ (${prediction.method}, уверенность: ${(prediction.confidence * 100).toFixed(0)}%)`);
            
            if (lot.winning_bid) {
                const accuracy = Math.abs(prediction.predictedPrice - lot.winning_bid) / lot.winning_bid * 100;
                const accuracyPercent = Math.max(0, 100 - accuracy);
                console.log(`   Факт: ${lot.winning_bid.toLocaleString()}₽ | Точность: ${accuracyPercent.toFixed(1)}%`);
                totalAccuracy += accuracyPercent;
                validPredictions++;
            }
            console.log('');
        }
        
        if (validPredictions > 0) {
            const avgAccuracy = totalAccuracy / validPredictions;
            console.log(`📊 Средняя точность прогнозов: ${avgAccuracy.toFixed(1)}%`);
            console.log(`📊 Калиброванных прогнозов: ${calibratedCount}, упрощенных: ${simpleCount}`);
        }
        
        return predictions;
    }

    // Сохранение прогнозов в базу данных
    async savePredictions(predictions) {
        console.log('\n💾 Сохранение финальных прогнозов в базу данных...');
        
        // Создаем таблицу если не существует
        await this.dbClient.query(`
            CREATE TABLE IF NOT EXISTS lot_price_predictions (
                id SERIAL PRIMARY KEY,
                lot_id INTEGER UNIQUE REFERENCES auction_lots(id),
                predicted_price DECIMAL(12,2),
                metal_value DECIMAL(12,2),
                numismatic_premium DECIMAL(12,2),
                confidence_score DECIMAL(3,2),
                prediction_method VARCHAR(50) DEFAULT 'final_model',
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        
        // Сохраняем прогнозы
        for (const prediction of predictions) {
            await this.dbClient.query(`
                INSERT INTO lot_price_predictions 
                (lot_id, predicted_price, metal_value, numismatic_premium, confidence_score, prediction_method)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (lot_id) DO UPDATE SET
                    predicted_price = EXCLUDED.predicted_price,
                    metal_value = EXCLUDED.metal_value,
                    numismatic_premium = EXCLUDED.numismatic_premium,
                    confidence_score = EXCLUDED.confidence_score,
                    prediction_method = EXCLUDED.prediction_method,
                    created_at = NOW();
            `, [
                prediction.lotId,
                prediction.predictedPrice,
                prediction.metalValue,
                prediction.numismaticPremium,
                prediction.confidence,
                prediction.method
            ]);
        }
        
        console.log(`✅ Сохранено ${predictions.length} финальных прогнозов`);
    }

    async run() {
        try {
            await this.init();
            
            console.log('🔮 ФИНАЛЬНАЯ СИСТЕМА ПРОГНОЗИРОВАНИЯ ЦЕН ЛОТОВ');
            console.log('📋 Модель с калибровкой на исторических данных');
            
            // Тестируем на завершенном аукционе
            const predictions = await this.predictCurrentAuctionPrices('964');
            
            // Сохраняем прогнозы
            await this.savePredictions(predictions);
            
            console.log('\n✅ Финальное прогнозирование завершено!');
            
        } catch (error) {
            console.error('❌ Ошибка прогнозирования:', error.message);
        } finally {
            await this.dbClient.end();
        }
    }
}

// Экспорт класса для использования в других модулях
module.exports = FinalPricePredictor;

// Запуск финальной системы прогнозирования
async function main() {
    const predictor = new FinalPricePredictor();
    await predictor.run();
}

if (require.main === module) {
    main();
}
