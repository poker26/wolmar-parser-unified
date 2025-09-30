/**
 * Сервис прогнозных цен для коллекции пользователей
 * Переиспользует существующую систему прогнозирования из основного сайта
 */

const { Pool } = require('pg');
const config = require('./config');
class CollectionPriceService {
    constructor() {
        this.pool = new Pool(config.dbConfig);
        this.predictor = null;
        this.metalsService = null;
    }

    /**
     * Инициализация сервиса
     */
    async init() {
        // Инициализируем сервис цен на металлы
        const MetalsPriceService = require('./metals-price-service');
        this.metalsService = new MetalsPriceService();
        
        // Калибруем модель прогнозирования
        await this.calibrateModel();
        
        console.log('🔗 CollectionPriceService инициализирован');
    }

    /**
     * Калибровка модели на исторических данных (адаптированная версия из FinalPricePredictor)
     */
    async calibrateModel() {
        console.log('🔧 Калибровка модели прогнозирования...');
        
        // Получаем статистику по состояниям и металлам
        const calibrationData = await this.pool.query(`
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
        
        console.log('✅ Модель калибрована');
    }

    /**
     * Основная функция прогнозирования (адаптированная из FinalPricePredictor)
     */
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

    /**
     * Упрощенная модель для случаев без калибровки
     */
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

    /**
     * Адаптация данных монеты из каталога к формату, ожидаемому системой прогнозирования
     */
    adaptCoinDataForPrediction(coin) {
        return {
            metal: coin.metal,
            weight: coin.coin_weight || coin.pure_metal_weight,
            condition: coin.condition,
            year: coin.year,
            letters: coin.mint, // Используем монетный двор как letters
            coin_description: coin.original_description || coin.coin_name
        };
    }

    /**
     * Расчет прогнозной цены для одной монеты в коллекции
     */
    async calculatePredictedPrice(coinId) {
        try {
            console.log(`🔮 Расчет прогнозной цены для монеты ID: ${coinId}`);
            
            // Получаем данные монеты из каталога
            const coinResult = await this.pool.query(`
                SELECT 
                    id, coin_name, denomination, year, metal, condition, 
                    coin_weight, pure_metal_weight, mintage, rarity, mint,
                    original_description
                FROM coin_catalog 
                WHERE id = $1
            `, [coinId]);
            
            if (coinResult.rows.length === 0) {
                throw new Error(`Монета с ID ${coinId} не найдена в каталоге`);
            }
            
            const coin = coinResult.rows[0];
            console.log(`📋 Монета: ${coin.coin_name} (${coin.denomination}) - ${coin.metal} ${coin.condition}`);
            
            // Адаптируем данные для системы прогнозирования
            const adaptedData = this.adaptCoinDataForPrediction(coin);
            
            // Калибруем модель (если еще не калибрована)
            if (!this.calibrationTable) {
                await this.calibrateModel();
            }
            
            // Получаем прогноз
            const prediction = await this.predictPrice(adaptedData);
            
            console.log(`💰 Прогнозная цена: ${prediction.predictedPrice.toLocaleString()}₽ (${prediction.method}, уверенность: ${(prediction.confidence * 100).toFixed(0)}%)`);
            
            return {
                predictedPrice: prediction.predictedPrice,
                confidenceScore: prediction.confidence,
                predictionMethod: prediction.method,
                metalValue: prediction.metalValue,
                numismaticPremium: prediction.numismaticPremium,
                calculationDate: new Date()
            };
            
        } catch (error) {
            console.error(`❌ Ошибка расчета прогнозной цены для монеты ${coinId}:`, error.message);
            throw error;
        }
    }

    /**
     * Пересчет прогнозных цен для всех монет в коллекции пользователя
     */
    async recalculateUserCollectionPrices(userId) {
        try {
            console.log(`🔄 Пересчет прогнозных цен для пользователя ID: ${userId}`);
            
            // Получаем все монеты в коллекции пользователя
            const collectionResult = await this.pool.query(`
                SELECT 
                    uc.id as collection_id,
                    uc.coin_id,
                    cc.coin_name,
                    cc.denomination,
                    cc.metal,
                    cc.condition,
                    cc.year
                FROM user_collections uc
                JOIN coin_catalog cc ON uc.coin_id = cc.id
                WHERE uc.user_id = $1
                ORDER BY uc.id
            `, [userId]);
            
            if (collectionResult.rows.length === 0) {
                console.log('📭 Коллекция пользователя пуста');
                return { updated: 0, errors: 0 };
            }
            
            console.log(`📚 Найдено ${collectionResult.rows.length} монет в коллекции`);
            
            let updated = 0;
            let errors = 0;
            
            // Калибруем модель один раз для всех монет
            if (!this.calibrationTable) {
                await this.calibrateModel();
            }
            
            // Обрабатываем каждую монету
            for (const item of collectionResult.rows) {
                try {
                    const prediction = await this.calculatePredictedPrice(item.coin_id);
                    
                    // Обновляем запись в коллекции
                    await this.pool.query(`
                        UPDATE user_collections 
                        SET 
                            predicted_price = $1,
                            confidence_score = $2,
                            prediction_method = $3,
                            price_calculation_date = $4
                        WHERE id = $5
                    `, [
                        prediction.predictedPrice,
                        prediction.confidenceScore,
                        prediction.predictionMethod,
                        prediction.calculationDate,
                        item.collection_id
                    ]);
                    
                    updated++;
                    console.log(`✅ Обновлена прогнозная цена для ${item.coin_name}: ${prediction.predictedPrice.toLocaleString()}₽`);
                    
                } catch (error) {
                    errors++;
                    console.error(`❌ Ошибка обновления ${item.coin_name}:`, error.message);
                }
            }
            
            console.log(`📊 Пересчет завершен: обновлено ${updated}, ошибок ${errors}`);
            return { updated, errors };
            
        } catch (error) {
            console.error('❌ Ошибка пересчета прогнозных цен:', error.message);
            throw error;
        }
    }

    /**
     * Получение суммарной прогнозной стоимости коллекции пользователя
     */
    async getCollectionTotalValue(userId) {
        try {
            console.log(`💰 Расчет суммарной стоимости коллекции пользователя ID: ${userId}`);
            
            const result = await this.pool.query(`
                SELECT 
                    COUNT(*) as total_coins,
                    SUM(predicted_price) as total_predicted_value,
                    AVG(predicted_price) as avg_predicted_price,
                    MIN(predicted_price) as min_predicted_price,
                    MAX(predicted_price) as max_predicted_price,
                    AVG(confidence_score) as avg_confidence,
                    COUNT(CASE WHEN predicted_price IS NOT NULL THEN 1 END) as coins_with_predictions,
                    MAX(price_calculation_date) as last_calculation_date
                FROM user_collections 
                WHERE user_id = $1
            `, [userId]);
            
            const stats = result.rows[0];
            
            // Получаем разбивку по металлам
            const metalStats = await this.pool.query(`
                SELECT 
                    cc.metal,
                    COUNT(*) as count,
                    SUM(uc.predicted_price) as total_value,
                    AVG(uc.predicted_price) as avg_price
                FROM user_collections uc
                JOIN coin_catalog cc ON uc.coin_id = cc.id
                WHERE uc.user_id = $1 AND uc.predicted_price IS NOT NULL
                GROUP BY cc.metal
                ORDER BY total_value DESC
            `, [userId]);
            
            return {
                totalCoins: parseInt(stats.total_coins),
                totalPredictedValue: parseFloat(stats.total_predicted_value) || 0,
                avgPredictedPrice: parseFloat(stats.avg_predicted_price) || 0,
                minPredictedPrice: parseFloat(stats.min_predicted_price) || 0,
                maxPredictedPrice: parseFloat(stats.max_predicted_price) || 0,
                avgConfidence: parseFloat(stats.avg_confidence) || 0,
                coinsWithPredictions: parseInt(stats.coins_with_predictions),
                lastCalculationDate: stats.last_calculation_date,
                metalBreakdown: metalStats.rows.map(row => ({
                    metal: row.metal,
                    count: parseInt(row.count),
                    totalValue: parseFloat(row.total_value),
                    avgPrice: parseFloat(row.avg_price)
                }))
            };
            
        } catch (error) {
            console.error('❌ Ошибка расчета суммарной стоимости:', error.message);
            throw error;
        }
    }

    /**
     * Получение прогнозной цены для конкретной монеты в коллекции
     */
    async getCoinPredictedPrice(userId, coinId) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    predicted_price,
                    confidence_score,
                    prediction_method,
                    price_calculation_date
                FROM user_collections 
                WHERE user_id = $1 AND coin_id = $2
            `, [userId, coinId]);
            
            if (result.rows.length === 0) {
                return null;
            }
            
            const row = result.rows[0];
            return {
                predictedPrice: parseFloat(row.predicted_price),
                confidenceScore: parseFloat(row.confidence_score),
                predictionMethod: row.prediction_method,
                calculationDate: row.price_calculation_date
            };
            
        } catch (error) {
            console.error('❌ Ошибка получения прогнозной цены:', error.message);
            throw error;
        }
    }

    /**
     * Закрытие соединений
     */
    async close() {
        await this.pool.end();
        if (this.predictor && this.predictor.dbClient) {
            await this.predictor.dbClient.end();
        }
    }
}

module.exports = CollectionPriceService;
