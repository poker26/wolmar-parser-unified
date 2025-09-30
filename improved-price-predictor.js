/**
 * Улучшенная система прогнозирования цен лотов
 * Учитывает больше факторов и использует исторические данные для калибровки
 */

const { Client } = require('pg');
const config = require('./config');

class ImprovedPricePredictor {
    constructor() {
        this.dbConfig = config.dbConfig;
        this.dbClient = new Client(this.dbConfig);
        
        // Улучшенные коэффициенты на основе анализа
        this.conditionMultipliers = {
            // MS с градациями (высокие цены)
            'MS64': 4.4, 'MS61': 3.1, 'MS62': 2.7, 'MS65': 2.4, 'MS63': 2.2, 'MS60': 1.7, 'MS66': 1.2,
            'MS': 1.0, // Базовая MS
            
            // AU с градациями
            'AU55': 3.0, 'AU58': 2.7, 'AU': 0.37, 'AU/UNC': 0.43,
            
            // Другие состояния
            'UNC': 0.30, 'XF+/AU': 0.40, 'XF': 0.25, 'VF': 0.15, 'F': 0.10, 'G': 0.05,
            'PL': 0.61, 'XX': 0.67, 'Superb': 0.50, 'Gem': 0.36, 'Ch': 0.39
        };
        
        // Цены металлов (актуальные)
        this.metalPrices = {
            'Au': 5000, 'Ag': 80, 'Pt': 3000, 'Cu': 5, 'Ni': 10, 'Fe': 2
        };
        
        // Пробы металлов
        this.metalPurities = {
            'Au': 0.9, 'Ag': 0.9, 'Pt': 0.95, 'Cu': 1.0, 'Ni': 1.0, 'Fe': 1.0
        };
        
        // Базовые веса для металлов (если не указан)
        this.defaultWeights = {
            'Au': 4.3,   // Типичный вес золотой монеты
            'Ag': 20.0,  // Типичный вес серебряной монеты
            'Cu': 10.0,  // Типичный вес медной монеты
            'Fe': 8.0,   // Типичный вес железной монеты
            'Ni': 5.0    // Типичный вес никелевой монеты
        };
    }

    async init() {
        await this.dbClient.connect();
        console.log('🔗 Подключение к базе данных установлено');
    }

    // Получение исторических данных для калибровки
    async getHistoricalData(condition, metal) {
        const query = `
            SELECT 
                AVG(winning_bid) as avg_price,
                COUNT(*) as sample_size,
                AVG(weight) as avg_weight
            FROM auction_lots 
            WHERE winning_bid IS NOT NULL 
                AND winning_bid > 0
                AND condition = $1
                AND metal = $2
                AND weight IS NOT NULL
                AND weight > 0
            GROUP BY condition, metal;
        `;
        
        const result = await this.dbClient.query(query, [condition, metal]);
        return result.rows[0] || null;
    }

    // Расчет базовой стоимости металла
    calculateMetalValue(metal, weight) {
        if (!metal) return 0;
        
        // Используем базовый вес если не указан
        const actualWeight = weight || this.defaultWeights[metal] || 5.0;
        
        const metalPrice = this.metalPrices[metal] || 0;
        const purity = this.metalPurities[metal] || 1.0;
        
        return actualWeight * purity * metalPrice;
    }

    // Улучшенное получение коэффициента состояния
    async getConditionMultiplier(condition, metal) {
        if (!condition) return 0.1;
        
        // Ищем точное совпадение
        if (this.conditionMultipliers[condition]) {
            return this.conditionMultipliers[condition];
        }
        
        // Ищем частичное совпадение
        for (const [key, value] of Object.entries(this.conditionMultipliers)) {
            if (condition.includes(key) || key.includes(condition)) {
                return value;
            }
        }
        
        // Если не найдено, используем исторические данные для калибровки
        const historicalData = await this.getHistoricalData(condition, metal);
        if (historicalData && historicalData.sample_size >= 3) {
            // Калибруем на основе исторических данных
            const baseMetalValue = this.calculateMetalValue(metal, historicalData.avg_weight);
            if (baseMetalValue > 0) {
                return historicalData.avg_price / baseMetalValue;
            }
        }
        
        // Базовые оценки по типу состояния
        if (condition.includes('MS')) return 1.0;
        if (condition.includes('AU')) return 0.4;
        if (condition.includes('UNC')) return 0.3;
        if (condition.includes('XF')) return 0.25;
        if (condition.includes('VF')) return 0.15;
        if (condition.includes('F')) return 0.1;
        
        return 0.1;
    }

    // Улучшенная функция прогнозирования
    async predictPrice(lot) {
        const { metal, weight, condition, year, letters, coin_description } = lot;
        
        // 1. Базовая стоимость металла
        const metalValue = this.calculateMetalValue(metal, weight);
        
        // 2. Коэффициент состояния (с исторической калибровкой)
        const conditionMultiplier = await this.getConditionMultiplier(condition, metal);
        
        // 3. Базовый прогноз
        let predictedPrice = metalValue * conditionMultiplier;
        
        // 4. Корректировки на основе дополнительных факторов
        
        // Корректировка на год
        if (year && !isNaN(year)) {
            const yearNum = parseInt(year);
            if (yearNum < 1800) {
                predictedPrice *= 2.0; // +100% за очень старые
            } else if (yearNum < 1900) {
                predictedPrice *= 1.5; // +50% за дореволюционные
            } else if (yearNum < 1950) {
                predictedPrice *= 1.2; // +20% за советские до 1950
            } else if (yearNum < 1990) {
                predictedPrice *= 1.1; // +10% за советские
            }
        }
        
        // Корректировка на монетный двор
        if (letters) {
            if (letters.includes('АР') || letters.includes('СПБ')) {
                predictedPrice *= 1.3; // +30% за столичные
            } else if (letters.includes('ЕМ')) {
                predictedPrice *= 1.1; // +10% за Екатеринбург
            }
        }
        
        // Корректировка на редкость по описанию
        if (coin_description) {
            const desc = coin_description.toLowerCase();
            if (desc.includes('редк') || desc.includes('уник')) {
                predictedPrice *= 2.0; // +100% за редкие
            } else if (desc.includes('тираж') && desc.includes('мал')) {
                predictedPrice *= 1.5; // +50% за малый тираж
            }
        }
        
        // Корректировка на металл (некоторые металлы имеют дополнительную ценность)
        if (metal === 'Pt') {
            predictedPrice *= 1.2; // +20% за платину
        } else if (metal === 'Cu' && condition && condition.includes('MS')) {
            predictedPrice *= 3.0; // +200% за медные в MS (очень редкие)
        }
        
        // Минимальная цена
        predictedPrice = Math.max(predictedPrice, 100);
        
        return {
            predictedPrice: Math.round(predictedPrice),
            metalValue: Math.round(metalValue),
            numismaticPremium: Math.round(predictedPrice - metalValue),
            conditionMultiplier: conditionMultiplier,
            confidence: this.calculateConfidence(lot, conditionMultiplier)
        };
    }

    // Улучшенный расчет уверенности
    calculateConfidence(lot, conditionMultiplier) {
        let confidence = 0.5; // Базовая уверенность
        
        // Увеличиваем уверенность при наличии ключевых данных
        if (lot.metal) confidence += 0.2;
        if (lot.weight) confidence += 0.2;
        if (lot.condition) confidence += 0.2;
        if (lot.year) confidence += 0.1;
        
        // Увеличиваем уверенность для точных коэффициентов
        if (this.conditionMultipliers[lot.condition]) {
            confidence += 0.2; // Точное совпадение
        } else if (conditionMultiplier > 0.5) {
            confidence += 0.1; // Хорошая калибровка
        } else {
            confidence -= 0.1; // Низкая калибровка
        }
        
        // Уменьшаем уверенность для редких комбинаций
        if (lot.metal === 'Pt' || lot.metal === 'Ni') {
            confidence -= 0.1; // Редкие металлы
        }
        
        return Math.max(0.1, Math.min(1.0, confidence));
    }

    // Прогнозирование для текущего аукциона
    async predictCurrentAuctionPrices(auctionNumber) {
        console.log(`\n🔮 УЛУЧШЕННОЕ прогнозирование цен для аукциона ${auctionNumber}:`);
        
        // Получаем лоты текущего аукциона
        const lots = await this.dbClient.query(`
            SELECT 
                id, lot_number, condition, metal, weight, year, letters,
                winning_bid, coin_description
            FROM auction_lots 
            WHERE auction_number = $1
            ORDER BY lot_number
            LIMIT 20;
        `, [auctionNumber]);
        
        console.log(`📊 Найдено ${lots.rows.length} лотов для прогнозирования`);
        
        const predictions = [];
        let totalAccuracy = 0;
        let validPredictions = 0;
        
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
                actualPrice: lot.winning_bid,
                description: lot.coin_description
            });
            
            console.log(`📋 Лот ${lot.lot_number}: ${lot.condition} | ${lot.metal} | ${lot.weight || 'нет'}г`);
            console.log(`   Прогноз: ${prediction.predictedPrice.toLocaleString()}₽ (уверенность: ${(prediction.confidence * 100).toFixed(0)}%)`);
            console.log(`   Металл: ${prediction.metalValue.toLocaleString()}₽ | Наценка: ${prediction.numismaticPremium.toLocaleString()}₽`);
            
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
        }
        
        return predictions;
    }

    // Сохранение прогнозов в базу данных
    async savePredictions(predictions) {
        console.log('\n💾 Сохранение улучшенных прогнозов в базу данных...');
        
        // Создаем таблицу если не существует
        await this.dbClient.query(`
            CREATE TABLE IF NOT EXISTS lot_price_predictions (
                id SERIAL PRIMARY KEY,
                lot_id INTEGER UNIQUE REFERENCES auction_lots(id),
                predicted_price DECIMAL(12,2),
                metal_value DECIMAL(12,2),
                numismatic_premium DECIMAL(12,2),
                confidence_score DECIMAL(3,2),
                prediction_method VARCHAR(50) DEFAULT 'improved_model',
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        
        // Сохраняем прогнозы
        for (const prediction of predictions) {
            await this.dbClient.query(`
                INSERT INTO lot_price_predictions 
                (lot_id, predicted_price, metal_value, numismatic_premium, confidence_score, prediction_method)
                VALUES ($1, $2, $3, $4, $5, 'improved_model')
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
                prediction.confidence
            ]);
        }
        
        console.log(`✅ Сохранено ${predictions.length} улучшенных прогнозов`);
    }

    async run() {
        try {
            await this.init();
            
            console.log('🔮 УЛУЧШЕННАЯ СИСТЕМА ПРОГНОЗИРОВАНИЯ ЦЕН ЛОТОВ');
            console.log('📋 Модель с исторической калибровкой и дополнительными факторами');
            
            // Тестируем на завершенном аукционе
            const predictions = await this.predictCurrentAuctionPrices('964');
            
            // Сохраняем прогнозы
            await this.savePredictions(predictions);
            
            console.log('\n✅ Улучшенное прогнозирование завершено!');
            
        } catch (error) {
            console.error('❌ Ошибка прогнозирования:', error.message);
        } finally {
            await this.dbClient.end();
        }
    }
}

// Запуск улучшенной системы прогнозирования
async function main() {
    const predictor = new ImprovedPricePredictor();
    await predictor.run();
}

main();
