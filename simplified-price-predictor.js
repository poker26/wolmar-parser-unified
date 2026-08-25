/**
 * Упрощенная система прогнозирования цен лотов
 * Основана на допущениях:
 * 1) Для недрагоценных металлов (без веса) - только нумизматическая наценка
 * 2) Исторические данные уже учитывают все особенности (тираж, редкость и т.п.)
 */

const { Client } = require('pg');
const config = require('./config');

class SimplifiedPricePredictor {
    constructor() {
        this.dbConfig = config.dbConfig;
        this.dbClient = new Client(this.dbConfig);
        
        // Цены драгоценных металлов (для расчета металлической стоимости)
        this.preciousMetalPrices = {
            'Au': 5000,  // ₽/г за чистое золото
            'Ag': 80,    // ₽/г за чистое серебро  
            'Pt': 3000,  // ₽/г за платину
            'Pd': 2000   // ₽/г за палладий
        };
        
        // Пробы драгоценных металлов
        this.metalPurities = {
            'Au': 0.9,   // 900 проба
            'Ag': 0.9,   // 900 проба
            'Pt': 0.95,  // 950 проба
            'Pd': 0.95   // 950 проба
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
                AND lot_status IS DISTINCT FROM 'active'              -- не активные торги (текущие ставки)
                AND source_site IN ('wolmar.ru','numismat.ru')        -- только аукционные дома (не маркетплейсы)
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
        
        // Показываем топ-10 комбинаций
        console.log('\n📋 Топ-10 комбинаций состояние+металл:');
        calibrationData.rows.slice(0, 10).forEach((row, index) => {
            const key = `${row.condition}_${row.metal}`;
            const premium = this.numismaticPremiums[key];
            console.log(`  ${index + 1}. ${row.condition} + ${row.metal}: ${row.sample_size} лотов`);
            console.log(`     Общая цена: ${Math.round(row.avg_price).toLocaleString()}₽`);
            console.log(`     Нумизматическая наценка: ${Math.round(premium.numismaticPremium).toLocaleString()}₽`);
            if (premium.metalValue > 0) {
                console.log(`     Стоимость металла: ${Math.round(premium.metalValue).toLocaleString()}₽`);
            }
        });
        
        return this.numismaticPremiums;
    }

    // Основная функция прогнозирования
    async predictPrice(lot) {
        const { metal, weight, condition, year, letters, coin_description } = lot;
        
        console.log(`🔍 Отладка predictPrice для лота ${lot.lot_number}:`);
        console.log(`  - metal: ${metal}, condition: ${condition}, weight: ${weight}, year: ${year}`);
        
        // 1. Ищем точную калибровку
        const calibrationKey = `${condition}_${metal}`;
        const calibration = this.numismaticPremiums[calibrationKey];
        
        console.log(`  - calibrationKey: ${calibrationKey}`);
        console.log(`  - calibration:`, calibration ? 'найдена' : 'НЕ найдена');
        
        if (calibration && calibration.sampleSize >= 3) {
            // Используем калиброванные данные
            let predictedPrice = calibration.medianPrice; // Используем медиану как более стабильную
            
            console.log(`  - sampleSize: ${calibration.sampleSize}`);
            console.log(`  - medianPrice: ${calibration.medianPrice}`);
            console.log(`  - predictedPrice: ${predictedPrice}`);
            
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
            
            console.log(`  - Финальный predictedPrice: ${predictedPrice}`);
            
            const result = {
                predictedPrice: Math.round(predictedPrice),
                metalValue: this.preciousMetalPrices[metal] && weight ? 
                    Math.round(weight * this.metalPurities[metal] * this.preciousMetalPrices[metal]) : 0,
                numismaticPremium: Math.round(predictedPrice - (this.preciousMetalPrices[metal] && weight ? 
                    weight * this.metalPurities[metal] * this.preciousMetalPrices[metal] : 0)),
                confidence: Math.min(0.95, 0.5 + (calibration.sampleSize / 50)), // Уверенность зависит от размера выборки
                method: 'calibrated',
                sampleSize: calibration.sampleSize
            };
            
            console.log(`  - Результат:`, result);
            return result;
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
            'Ni': 1500,   // Базовая цена никелевой монеты
            'Pt': 80000,  // Базовая цена платиновой монеты
            'Pd': 60000   // Базовая цена палладиевой монеты
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

    // Прогнозирование для текущего аукциона
    async predictCurrentAuctionPrices(auctionNumber) {
        console.log(`\n🔮 УПРОЩЕННОЕ прогнозирование цен для аукциона ${auctionNumber}:`);
        
        // Калибруем модель
        await this.calibrateNumismaticPremiums();
        
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
                sampleSize: prediction.sampleSize,
                actualPrice: lot.winning_bid,
                description: lot.coin_description
            });
            
            if (prediction.method === 'calibrated') calibratedCount++;
            else simpleCount++;
            
            console.log(`📋 Лот ${lot.lot_number}: ${lot.condition} | ${lot.metal} | ${lot.weight || 'нет'}г`);
            console.log(`   Прогноз: ${prediction.predictedPrice.toLocaleString()}₽ (${prediction.method}, уверенность: ${(prediction.confidence * 100).toFixed(0)}%)`);
            console.log(`   Металл: ${prediction.metalValue.toLocaleString()}₽ | Наценка: ${prediction.numismaticPremium.toLocaleString()}₽`);
            if (prediction.sampleSize > 0) {
                console.log(`   Выборка: ${prediction.sampleSize} лотов`);
            }
            
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
        console.log('\n💾 Сохранение упрощенных прогнозов в базу данных...');
        
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
        
        console.log(`✅ Сохранено ${predictions.length} упрощенных прогнозов`);
    }

    async run() {
        try {
            await this.init();
            
            console.log('🔮 УПРОЩЕННАЯ СИСТЕМА ПРОГНОЗИРОВАНИЯ ЦЕН ЛОТОВ');
            console.log('📋 Модель основана на нумизматических наценках из исторических данных');
            console.log('📋 Допущения: для недрагоценных металлов - только нумизматическая наценка');
            
            // Тестируем на завершенном аукционе
            const predictions = await this.predictCurrentAuctionPrices('964');
            
            // Сохраняем прогнозы
            await this.savePredictions(predictions);
            
            console.log('\n✅ Упрощенное прогнозирование завершено!');
            
        } catch (error) {
            console.error('❌ Ошибка прогнозирования:', error.message);
        } finally {
            await this.dbClient.end();
        }
    }
    
    // Сохранение одного прогноза в базу данных
    async saveSinglePrediction(lotId, prediction) {
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
            lotId,
            prediction.predicted_price,
            prediction.metal_value,
            prediction.numismatic_premium,
            prediction.confidence_score,
            prediction.prediction_method
        ]);
    }
    
    // Пересчет прогнозов для конкретных лотов
    async recalculateForLots(lotIds) {
        try {
            console.log(`🔄 Пересчет прогнозов для ${lotIds.length} лотов...`);
            
            // Подключаемся к базе данных
            await this.init();
            
            // Калибруем модель (ВАЖНО!)
            await this.calibrateNumismaticPremiums();
            
            // Получаем данные лотов
            const lotsQuery = `
                SELECT id, lot_number, auction_number, coin_description, condition, metal, weight, year
                FROM auction_lots 
                WHERE id = ANY($1)
            `;
            const lotsResult = await this.dbClient.query(lotsQuery, [lotIds]);
            const lots = lotsResult.rows;
            
            console.log(`📊 Найдено ${lots.length} лотов для пересчета`);
            
            if (lots.length === 0) {
                console.log('❌ Лоты не найдены');
                return;
            }
            
            // Пересчитываем прогнозы для каждого лота
            let recalculatedCount = 0;
            for (const lot of lots) {
                try {
                    console.log(`🔄 Пересчитываем прогноз для лота ${lot.lot_number} (ID: ${lot.id})...`);
                    
                    // Используем ImprovedPredictionsGenerator вместо SimplifiedPricePredictor
                    const ImprovedPredictionsGenerator = require('./improved-predictions-generator');
                    const generator = new ImprovedPredictionsGenerator();
                    await generator.init();
                    
                    const prediction = await generator.predictPrice(lot);
                    if (prediction) {
                        await this.saveSinglePrediction(lot.id, prediction);
                        recalculatedCount++;
                        console.log(`✅ Прогноз для лота ${lot.lot_number}: ${prediction.predicted_price}₽`);
                    } else {
                        console.log(`⚠️ Не удалось рассчитать прогноз для лота ${lot.lot_number}`);
                    }
                    
                    await generator.close();
                } catch (error) {
                    console.error(`❌ Ошибка пересчета прогноза для лота ${lot.lot_number}:`, error.message);
                }
            }
            
            console.log(`✅ Пересчет завершен: ${recalculatedCount} из ${lots.length} лотов`);
            
        } catch (error) {
            console.error('Ошибка пересчета прогнозов для лотов:', error);
        } finally {
            await this.dbClient.end();
        }
    }
}

// Запуск упрощенной системы прогнозирования
async function main() {
    const predictor = new SimplifiedPricePredictor();
    
    // Проверяем аргументы командной строки
    const args = process.argv.slice(2);
    const watchlistIndex = args.indexOf('--watchlist');
    
    if (watchlistIndex !== -1 && args[watchlistIndex + 1]) {
        // Режим пересчета для конкретных лотов из избранного
        const lotIds = args[watchlistIndex + 1].split(',').map(id => parseInt(id.trim()));
        console.log(`🔄 Пересчет прогнозов для лотов из избранного: ${lotIds.join(', ')}`);
        await predictor.recalculateForLots(lotIds);
    } else {
        // Обычный режим - пересчет для всех лотов
        await predictor.run();
    }
}

main();
