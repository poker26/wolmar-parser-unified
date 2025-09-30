/**
 * Система прогнозирования цен лотов
 * Базовая модель на основе анализа исторических данных
 */

const { Client } = require('pg');
const config = require('./config');

class PricePredictor {
    constructor() {
        this.dbConfig = config.dbConfig;
        this.dbClient = new Client(this.dbConfig);
        
        // Коэффициенты на основе анализа данных
        this.conditionMultipliers = {
            'MS64': 4.4,    // 329,205₽ / 74,655₽ (базовая MS)
            'MS61': 3.1,    // 227,977₽ / 74,655₽
            'AU55': 3.0,    // 224,180₽ / 74,655₽
            'AU58': 2.7,    // 203,554₽ / 74,655₽
            'MS62': 2.7,    // 200,186₽ / 74,655₽
            'MS65': 2.4,    // 177,910₽ / 74,655₽
            'MS63': 2.2,    // 164,086₽ / 74,655₽
            'MS60': 1.7,    // 126,346₽ / 74,655₽
            'MS66': 1.2,    // 86,419₽ / 74,655₽
            'MS': 1.0,      // Базовая MS
            'AU/UNC': 0.43, // 32,331₽ / 74,655₽
            'XF+/AU': 0.40, // 30,095₽ / 74,655₽
            'AU': 0.37,     // 27,575₽ / 74,655₽
            'UNC': 0.30,    // Примерная оценка
            'XF': 0.25,     // Примерная оценка
            'VF': 0.15,     // Примерная оценка
            'F': 0.10,      // Примерная оценка
            'G': 0.05       // Примерная оценка
        };
        
        // Цены металлов (примерные, нужно обновлять)
        this.metalPrices = {
            'Au': 5000,     // ₽/г за чистое золото
            'Ag': 80,       // ₽/г за чистое серебро
            'Pt': 3000,     // ₽/г за платину
            'Cu': 5,        // ₽/г за медь
            'Ni': 10        // ₽/г за никель
        };
        
        // Пробы металлов
        this.metalPurities = {
            'Au': 0.9,      // 900 проба
            'Ag': 0.9,      // 900 проба
            'Pt': 0.95,     // 950 проба
            'Cu': 1.0,      // Чистая медь
            'Ni': 1.0       // Чистый никель
        };
    }

    async init() {
        await this.dbClient.connect();
        console.log('🔗 Подключение к базе данных установлено');
    }

    // Расчет базовой стоимости металла
    calculateMetalValue(metal, weight) {
        if (!metal || !weight) return 0;
        
        const metalPrice = this.metalPrices[metal] || 0;
        const purity = this.metalPurities[metal] || 1.0;
        
        return weight * purity * metalPrice;
    }

    // Получение коэффициента состояния
    getConditionMultiplier(condition) {
        if (!condition) return 0.1; // Минимальный коэффициент
        
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
        
        // Если не найдено, используем базовую оценку
        if (condition.includes('MS')) return 1.0;
        if (condition.includes('AU')) return 0.4;
        if (condition.includes('UNC')) return 0.3;
        if (condition.includes('XF')) return 0.25;
        if (condition.includes('VF')) return 0.15;
        if (condition.includes('F')) return 0.1;
        
        return 0.1; // Минимальный коэффициент
    }

    // Основная функция прогнозирования
    predictPrice(lot) {
        const { metal, weight, condition, year, letters } = lot;
        
        // 1. Базовая стоимость металла
        const metalValue = this.calculateMetalValue(metal, weight);
        
        // 2. Коэффициент состояния
        const conditionMultiplier = this.getConditionMultiplier(condition);
        
        // 3. Базовый прогноз
        let predictedPrice = metalValue * conditionMultiplier;
        
        // 4. Корректировки
        // Корректировка на год (старые монеты дороже)
        if (year && !isNaN(year)) {
            const yearNum = parseInt(year);
            if (yearNum < 1900) {
                predictedPrice *= 1.5; // +50% за дореволюционные
            } else if (yearNum < 1950) {
                predictedPrice *= 1.2; // +20% за советские до 1950
            }
        }
        
        // Корректировка на редкость (по буквам)
        if (letters && letters.length > 0) {
            // Некоторые буквы могут указывать на редкость
            if (letters.includes('АР') || letters.includes('СПБ')) {
                predictedPrice *= 1.3; // +30% за столичные монетные дворы
            }
        }
        
        // Минимальная цена
        predictedPrice = Math.max(predictedPrice, 100);
        
        return {
            predictedPrice: Math.round(predictedPrice),
            metalValue: Math.round(metalValue),
            numismaticPremium: Math.round(predictedPrice - metalValue),
            conditionMultiplier: conditionMultiplier,
            confidence: this.calculateConfidence(lot)
        };
    }

    // Расчет уверенности в прогнозе
    calculateConfidence(lot) {
        let confidence = 0.5; // Базовая уверенность
        
        // Увеличиваем уверенность при наличии ключевых данных
        if (lot.metal && lot.weight) confidence += 0.2;
        if (lot.condition) confidence += 0.2;
        if (lot.year) confidence += 0.1;
        
        // Уменьшаем уверенность для редких состояний
        const condition = lot.condition;
        if (condition && this.conditionMultipliers[condition]) {
            confidence += 0.1; // Точное совпадение
        } else if (condition) {
            confidence -= 0.1; // Неточное совпадение
        }
        
        return Math.max(0.1, Math.min(1.0, confidence));
    }

    // Прогнозирование для текущего аукциона
    async predictCurrentAuctionPrices(auctionNumber) {
        console.log(`\n🔮 Прогнозирование цен для аукциона ${auctionNumber}:`);
        
        // Получаем лоты текущего аукциона
        const lots = await this.dbClient.query(`
            SELECT 
                id, lot_number, condition, metal, weight, year, letters,
                winning_bid, coin_description
            FROM auction_lots 
            WHERE auction_number = $1
            ORDER BY lot_number
            LIMIT 50;
        `, [auctionNumber]);
        
        console.log(`📊 Найдено ${lots.rows.length} лотов для прогнозирования`);
        
        const predictions = [];
        
        for (const lot of lots.rows) {
            const prediction = this.predictPrice(lot);
            
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
            
            console.log(`📋 Лот ${lot.lot_number}: ${lot.condition} | ${lot.metal} | ${lot.weight}г`);
            console.log(`   Прогноз: ${prediction.predictedPrice.toLocaleString()}₽ (уверенность: ${(prediction.confidence * 100).toFixed(0)}%)`);
            console.log(`   Металл: ${prediction.metalValue.toLocaleString()}₽ | Наценка: ${prediction.numismaticPremium.toLocaleString()}₽`);
            if (lot.winning_bid) {
                const accuracy = Math.abs(prediction.predictedPrice - lot.winning_bid) / lot.winning_bid * 100;
                console.log(`   Факт: ${lot.winning_bid.toLocaleString()}₽ | Точность: ${(100 - accuracy).toFixed(1)}%`);
            }
            console.log('');
        }
        
        return predictions;
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
                prediction_method VARCHAR(50) DEFAULT 'basic_model',
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        
        // Сохраняем прогнозы
        for (const prediction of predictions) {
            await this.dbClient.query(`
                INSERT INTO lot_price_predictions 
                (lot_id, predicted_price, metal_value, numismatic_premium, confidence_score)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (lot_id) DO UPDATE SET
                    predicted_price = EXCLUDED.predicted_price,
                    metal_value = EXCLUDED.metal_value,
                    numismatic_premium = EXCLUDED.numismatic_premium,
                    confidence_score = EXCLUDED.confidence_score,
                    created_at = NOW();
            `, [
                prediction.lotId,
                prediction.predictedPrice,
                prediction.metalValue,
                prediction.numismaticPremium,
                prediction.confidence
            ]);
        }
        
        console.log(`✅ Сохранено ${predictions.length} прогнозов`);
    }

    async run() {
        try {
            await this.init();
            
            console.log('🔮 СИСТЕМА ПРОГНОЗИРОВАНИЯ ЦЕН ЛОТОВ');
            console.log('📋 Базовая модель на основе анализа исторических данных');
            
            // Тестируем на завершенном аукционе
            const predictions = await this.predictCurrentAuctionPrices('964');
            
            // Сохраняем прогнозы
            await this.savePredictions(predictions);
            
            console.log('\n✅ Прогнозирование завершено!');
            
        } catch (error) {
            console.error('❌ Ошибка прогнозирования:', error.message);
        } finally {
            await this.dbClient.end();
        }
    }
}

// Запуск системы прогнозирования
async function main() {
    const predictor = new PricePredictor();
    await predictor.run();
}

main();
