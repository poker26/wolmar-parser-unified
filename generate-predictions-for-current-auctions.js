/**
 * Генерация прогнозов для текущих активных аукционов
 * Использует упрощенную модель прогнозирования
 */

const { Client } = require('pg');
const config = require('./config');

class CurrentAuctionsPredictor {
    constructor() {
        this.dbConfig = config.dbConfig;
        this.dbClient = new Client(this.dbConfig);
        
        // Цены драгоценных металлов
        this.preciousMetalPrices = {
            'Au': 5000, 'Ag': 80, 'Pt': 3000, 'Pd': 2000
        };
        
        // Пробы драгоценных металлов
        this.metalPurities = {
            'Au': 0.9, 'Ag': 0.9, 'Pt': 0.95, 'Pd': 0.95
        };
        
        // Калибровочная таблица для нумизматических наценок
        this.numismaticPremiums = {};
    }

    async init() {
        await this.dbClient.connect();
        console.log('🔗 Подключение к базе данных установлено');
    }

    // Калибровка нумизматических наценок на исторических данных
    async calibrateNumismaticPremiums() {
        console.log('\n🔧 КАЛИБРОВКА НУМИЗМАТИЧЕСКИХ НАЦЕНОК:');
        
        // Получаем статистику по состояниям и металлам
        const calibrationData = await this.dbClient.query(`
            SELECT 
                condition,
                metal,
                COUNT(*) as sample_size,
                AVG(winning_bid) as avg_price,
                AVG(weight) as avg_weight,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY winning_bid) as median_price
            FROM auction_lots 
            WHERE winning_bid IS NOT NULL 
                AND winning_bid > 0
                AND condition IS NOT NULL
                AND metal IS NOT NULL
            GROUP BY condition, metal
            HAVING COUNT(*) >= 3
            ORDER BY avg_price DESC;
        `);
        
        console.log(`📊 Получено ${calibrationData.rows.length} комбинаций для калибровки`);
        
        // Создаем калибровочную таблицу
        this.numismaticPremiums = {};
        
        for (const row of calibrationData.rows) {
            const key = `${row.condition}_${row.metal}`;
            
            // Рассчитываем нумизматическую наценку
            let numismaticPremium = row.avg_price; // По умолчанию вся цена - нумизматическая наценка
            
            // Для драгоценных металлов вычитаем стоимость металла
            if (this.preciousMetalPrices[row.metal] && row.avg_weight) {
                const metalValue = row.avg_weight * this.metalPurities[row.metal] * this.preciousMetalPrices[row.metal];
                numismaticPremium = Math.max(0, row.avg_price - metalValue);
            }
            
            this.numismaticPremiums[key] = {
                numismaticPremium: numismaticPremium,
                totalPrice: row.avg_price,
                medianPrice: row.median_price,
                sampleSize: row.sample_size,
                avgWeight: row.avg_weight,
                metalValue: this.preciousMetalPrices[row.metal] && row.avg_weight ? 
                    row.avg_weight * this.metalPurities[row.metal] * this.preciousMetalPrices[row.metal] : 0
            };
        }
        
        return this.numismaticPremiums;
    }

    // Основная функция прогнозирования
    async predictPrice(lot) {
        const { metal, weight, condition, year, letters, coin_description } = lot;
        
        // 1. Ищем точную калибровку
        const calibrationKey = `${condition}_${metal}`;
        const calibration = this.numismaticPremiums[calibrationKey];
        
        if (calibration && calibration.sampleSize >= 3) {
            // Используем калиброванные данные
            let predictedPrice = calibration.medianPrice; // Используем медиану как более стабильную
            
            // Корректировка на вес для драгоценных металлов
            if (weight && calibration.avgWeight && calibration.avgWeight > 0 && this.preciousMetalPrices[metal]) {
                const weightRatio = weight / calibration.avgWeight;
                const metalValue = weight * this.metalPurities[metal] * this.preciousMetalPrices[metal];
                const numismaticPremium = calibration.numismaticPremium;
                predictedPrice = metalValue + numismaticPremium;
            }
            
            // Корректировка на год (небольшая)
            if (year && !isNaN(year)) {
                const yearNum = parseInt(year);
                if (yearNum < 1800) {
                    predictedPrice *= 1.2; // +20% за очень старые
                } else if (yearNum < 1900) {
                    predictedPrice *= 1.1; // +10% за дореволюционные
                }
            }
            
            return {
                predictedPrice: Math.round(predictedPrice),
                metalValue: this.preciousMetalPrices[metal] && weight ? 
                    Math.round(weight * this.metalPurities[metal] * this.preciousMetalPrices[metal]) : 0,
                numismaticPremium: Math.round(predictedPrice - (this.preciousMetalPrices[metal] && weight ? 
                    weight * this.metalPurities[metal] * this.preciousMetalPrices[metal] : 0)),
                confidence: Math.min(0.95, 0.5 + (calibration.sampleSize / 50)), // Уверенность зависит от размера выборки
                method: 'calibrated',
                sampleSize: calibration.sampleSize
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
            'Au': 50000, 'Ag': 5000, 'Cu': 2000, 'Fe': 1000, 'Ni': 1500, 'Pt': 80000, 'Pd': 60000
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
        
        // Корректировка на вес для драгоценных металлов
        if (weight && weight > 0 && this.preciousMetalPrices[metal]) {
            const metalValue = weight * this.metalPurities[metal] * this.preciousMetalPrices[metal];
            const numismaticPremium = predictedPrice * 0.8; // 80% нумизматическая наценка
            predictedPrice = metalValue + numismaticPremium;
        }
        
        return {
            predictedPrice: Math.round(predictedPrice),
            metalValue: this.preciousMetalPrices[metal] && weight ? 
                Math.round(weight * this.metalPurities[metal] * this.preciousMetalPrices[metal]) : 0,
            numismaticPremium: Math.round(predictedPrice - (this.preciousMetalPrices[metal] && weight ? 
                weight * this.metalPurities[metal] * this.preciousMetalPrices[metal] : 0)),
            confidence: 0.3, // Низкая уверенность для упрощенной модели
            method: 'simple',
            sampleSize: 0
        };
    }

    // Сохранение прогнозов в базу данных
    async savePredictions(predictions) {
        console.log('\n💾 Сохранение прогнозов в базу данных...');
        
        // Создаем таблицу если не существует
        await this.dbClient.query(`
            CREATE TABLE IF NOT EXISTS lot_price_predictions (
                id SERIAL PRIMARY KEY,
                lot_id INTEGER UNIQUE REFERENCES auction_lots(id),
                predicted_price DECIMAL(12,2),
                metal_value DECIMAL(12,2),
                numismatic_premium DECIMAL(12,2),
                confidence_score DECIMAL(3,2),
                prediction_method VARCHAR(50) DEFAULT 'simplified_model',
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
        
        console.log(`✅ Сохранено ${predictions.length} прогнозов`);
    }

    async generatePredictionsForCurrentAuctions() {
        console.log('🔮 ГЕНЕРАЦИЯ ПРОГНОЗОВ ДЛЯ ТЕКУЩИХ АУКЦИОНОВ');
        
        // Калибруем модель
        await this.calibrateNumismaticPremiums();
        
        // Получаем список последних аукционов (для демонстрации)
        const activeAuctions = await this.dbClient.query(`
            SELECT DISTINCT auction_number 
            FROM auction_lots 
            ORDER BY auction_number DESC
            LIMIT 2;
        `);
        
        console.log(`📊 Найдено ${activeAuctions.rows.length} активных аукционов`);
        
        for (const auction of activeAuctions.rows) {
            const auctionNumber = auction.auction_number;
            console.log(`\n🏆 Генерируем прогнозы для аукциона ${auctionNumber}:`);
            
            try {
                // Получаем лоты текущего аукциона
                const lots = await this.dbClient.query(`
                    SELECT 
                        id, lot_number, condition, metal, weight, year, letters,
                        winning_bid, coin_description
                    FROM auction_lots 
                    WHERE auction_number = $1
                    ORDER BY lot_number;
                `, [auctionNumber]);
                
                console.log(`📋 Найдено ${lots.rows.length} лотов для прогнозирования`);
                
                const predictions = [];
                
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
                }
                
                // Сохраняем прогнозы
                await this.savePredictions(predictions);
                
                console.log(`✅ Сохранено ${predictions.length} прогнозов для аукциона ${auctionNumber}`);
                
            } catch (error) {
                console.error(`❌ Ошибка генерации прогнозов для аукциона ${auctionNumber}:`, error.message);
            }
        }
    }

    async run() {
        try {
            await this.init();
            await this.generatePredictionsForCurrentAuctions();
            console.log('\n🎉 Генерация прогнозов завершена!');
        } catch (error) {
            console.error('❌ Ошибка генерации прогнозов:', error.message);
        } finally {
            await this.dbClient.end();
        }
    }
}

// Запуск генерации прогнозов
async function main() {
    const predictor = new CurrentAuctionsPredictor();
    await predictor.run();
}

main();