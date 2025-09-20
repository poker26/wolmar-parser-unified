const { Client } = require('pg');
const config = require('./config');

class RobustPredictionsGenerator {
    constructor() {
        this.dbClient = null;
        this.preciousMetalPrices = {
            'Au': 7500, // Золото за грамм
            'Ag': 100,  // Серебро за грамм
            'Pt': 3000, // Платина за грамм
            'Pd': 2000  // Палладий за грамм
        };
        this.metalPurities = {
            'Au': 0.9,  // 90% для золотых монет
            'Ag': 0.9,  // 90% для серебряных монет
            'Pt': 0.95, // 95% для платиновых монет
            'Pd': 0.95  // 95% для палладиевых монет
        };
        this.batchSize = 50; // Сохраняем прогнозы пакетами по 50
    }

    async init() {
        this.dbClient = new Client(config.dbConfig);
        await this.dbClient.connect();
        console.log('🔗 Подключение к базе данных установлено');
    }

    async close() {
        if (this.dbClient) {
            await this.dbClient.end();
            console.log('🧹 Ресурсы освобождены');
        }
    }

    // Поиск аналогичных лотов
    async findSimilarLots(lot) {
        const { condition, metal, year, letters, coin_description, auction_number } = lot;
        
        // Извлекаем номинал из описания монеты
        const denominationMatch = coin_description.match(/(\d+)\s*рублей?/i);
        const currentDenomination = denominationMatch ? denominationMatch[1] : null;
        
        // Ищем лоты с точно такими же параметрами + номинал
        // Исключаем лоты текущего аукциона
        let query = `
            SELECT 
                id,
                lot_number,
                auction_number,
                winning_bid,
                weight,
                coin_description,
                auction_end_date
            FROM auction_lots 
            WHERE condition = $1 
                AND metal = $2 
                AND year = $3 
                AND letters = $4
                AND winning_bid IS NOT NULL 
                AND winning_bid > 0
                AND id != $5
                AND auction_number != $6
        `;
        
        const params = [condition, metal, year, letters, lot.id, auction_number];
        
        if (currentDenomination) {
            query += ` AND coin_description ~ $${params.length + 1}`;
            params.push(`\\m${currentDenomination}\\s*рублей?\\M`);
        }
        
        query += ` ORDER BY auction_end_date DESC`;
        
        const result = await this.dbClient.query(query, params);
        return result.rows;
    }

    // Расчет стоимости металла на текущую дату
    calculateMetalValue(metal, weight) {
        if (!weight || !this.preciousMetalPrices[metal]) {
            return 0;
        }
        
        const pricePerGram = this.preciousMetalPrices[metal];
        const purity = this.metalPurities[metal] || 1;
        
        return pricePerGram * weight * purity;
    }

    // Основная функция прогнозирования
    async predictPrice(lot) {
        const similarLots = await this.findSimilarLots(lot);
        
        // Случай 1: Аналогичные лоты не найдены
        if (similarLots.length === 0) {
            return {
                predicted_price: null,
                metal_value: this.calculateMetalValue(lot.metal, lot.weight),
                numismatic_premium: null,
                confidence_score: 0,
                prediction_method: 'no_similar_lots',
                sample_size: 0
            };
        }
        
        // Случай 2: Найден только один аналогичный лот
        if (similarLots.length === 1) {
            const similarLot = similarLots[0];
            const currentMetalValue = this.calculateMetalValue(lot.metal, lot.weight);
            const similarMetalValue = this.calculateMetalValue(similarLot.metal, similarLot.weight);
            
            let predictedPrice = similarLot.winning_bid;
            
            // Корректируем на разницу в стоимости металла
            if (currentMetalValue > 0 && similarMetalValue > 0) {
                const metalDifference = currentMetalValue - similarMetalValue;
                predictedPrice += metalDifference;
            }
            
            // Проверяем на NaN и бесконечность
            if (isNaN(predictedPrice) || !isFinite(predictedPrice)) {
                predictedPrice = similarLot.winning_bid;
            }
            
            return {
                predicted_price: predictedPrice,
                metal_value: currentMetalValue,
                numismatic_premium: predictedPrice - currentMetalValue,
                confidence_score: 0.7,
                prediction_method: 'single_similar_lot',
                sample_size: 1
            };
        }
        
        // Случай 3: Множественные аналоги - применяем статистическую модель
        const prices = similarLots.map(lot => lot.winning_bid).sort((a, b) => a - b);
        const median = prices[Math.floor(prices.length / 2)];
        
        // Корректируем медиану на разницу в стоимости металла
        const currentMetalValue = this.calculateMetalValue(lot.metal, lot.weight);
        const similarMetalValues = similarLots.map(similar => 
            this.calculateMetalValue(similar.metal, similar.weight)
        );
        const avgSimilarMetalValue = similarMetalValues.reduce((sum, val) => sum + val, 0) / similarMetalValues.length;
        
        let predictedPrice = median;
        if (currentMetalValue > 0 && avgSimilarMetalValue > 0) {
            const metalDifference = currentMetalValue - avgSimilarMetalValue;
            predictedPrice += metalDifference;
        }
        
        // Проверяем на NaN и бесконечность
        if (isNaN(predictedPrice) || !isFinite(predictedPrice)) {
            predictedPrice = median;
        }
        
        // Рассчитываем уверенность на основе размера выборки
        let confidence = Math.min(0.95, 0.5 + (similarLots.length * 0.02));
        
        // Дополнительная проверка
        if (predictedPrice === null || predictedPrice === undefined) {
            predictedPrice = median;
        }
        
        return {
            predicted_price: predictedPrice,
            metal_value: currentMetalValue,
            numismatic_premium: predictedPrice - currentMetalValue,
            confidence_score: confidence,
            prediction_method: 'statistical_model',
            sample_size: similarLots.length
        };
    }

    // Пакетное сохранение прогнозов
    async savePredictionsBatch(predictions) {
        if (predictions.length === 0) return;
        
        const values = predictions.map((pred, index) => {
            const baseIndex = index * 7;
            return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7})`;
        }).join(', ');
        
        const query = `
            INSERT INTO lot_price_predictions (lot_id, predicted_price, metal_value, numismatic_premium, confidence_score, sample_size, prediction_method)
            VALUES ${values}
            ON CONFLICT (lot_id) DO UPDATE SET
                predicted_price = EXCLUDED.predicted_price,
                metal_value = EXCLUDED.metal_value,
                numismatic_premium = EXCLUDED.numismatic_premium,
                confidence_score = EXCLUDED.confidence_score,
                sample_size = EXCLUDED.sample_size,
                prediction_method = EXCLUDED.prediction_method
        `;
        
        const params = predictions.flatMap(pred => [
            pred.lot_id,
            pred.predicted_price,
            pred.metal_value,
            pred.numismatic_premium,
            pred.confidence_score,
            pred.sample_size,
            pred.prediction_method
        ]);
        
        await this.dbClient.query(query, params);
    }

    // Генерация прогнозов для аукциона
    async generatePredictionsForAuction(auctionNumber) {
        console.log(`\n🏆 Генерируем надежные прогнозы для аукциона ${auctionNumber}:`);
        
        // Получаем все лоты аукциона
        const lotsResult = await this.dbClient.query(`
            SELECT id, lot_number, condition, metal, weight, year, letters, winning_bid, coin_description, auction_number
            FROM auction_lots 
            WHERE auction_number = $1
            ORDER BY lot_number
        `, [auctionNumber]);
        
        const lots = lotsResult.rows;
        console.log(`📋 Найдено ${lots.length} лотов для прогнозирования`);
        
        const allPredictions = [];
        let processedCount = 0;
        
        for (const lot of lots) {
            try {
                const prediction = await this.predictPrice(lot);
                allPredictions.push({
                    lot_id: lot.id,
                    ...prediction
                });
                
                processedCount++;
                
                // Сохраняем пакетами
                if (allPredictions.length >= this.batchSize) {
                    await this.savePredictionsBatch(allPredictions);
                    console.log(`💾 Сохранено ${allPredictions.length} прогнозов (обработано ${processedCount}/${lots.length})`);
                    allPredictions.length = 0; // Очищаем массив
                }
                
                if (processedCount % 20 === 0) {
                    console.log(`⏳ Обработано ${processedCount}/${lots.length} лотов`);
                }
                
            } catch (error) {
                console.error(`❌ Ошибка при обработке лота ${lot.lot_number}:`, error.message);
            }
        }
        
        // Сохраняем оставшиеся прогнозы
        if (allPredictions.length > 0) {
            await this.savePredictionsBatch(allPredictions);
            console.log(`💾 Сохранено ${allPredictions.length} прогнозов (финальный пакет)`);
        }
        
        console.log(`✅ Обработка завершена: ${processedCount} лотов`);
    }
}

// Запуск
async function main() {
    const generator = new RobustPredictionsGenerator();
    try {
        await generator.init();
        
        const args = process.argv.slice(2);
        if (args.length > 0) {
            const auctionNumber = args[0];
            console.log(`🎯 Генерируем прогнозы для указанного аукциона ${auctionNumber}`);
            await generator.generatePredictionsForAuction(auctionNumber);
        } else {
            console.log('❌ Пожалуйста, укажите номер аукциона: node robust-predictions-generator.js [auctionNumber]');
        }
    } catch (error) {
        console.error('❌ Ошибка генерации прогнозов:', error);
    } finally {
        await generator.close();
    }
}

if (require.main === module) {
    main();
}

module.exports = RobustPredictionsGenerator;
