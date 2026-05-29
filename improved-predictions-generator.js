const { Client } = require('pg');
const config = require('./config');
const MetalsPriceService = require('./metals-price-service');

class ImprovedPredictionsGenerator {
    constructor() {
        this.dbClient = null;
        this.metalsPriceService = new MetalsPriceService();
        
        // Fallback цены (используются если не удается получить актуальные)
        this.fallbackMetalPrices = {
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
        
        // Кэш для актуальных цен металлов
        this.metalsPriceCache = new Map();
        this.cacheTimeout = 60 * 60 * 1000; // 1 час
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
        if (this.metalsPriceService) {
            await this.metalsPriceService.close();
        }
    }

    // Получение актуальных цен металлов с ЦБ РФ
    async getCurrentMetalPrices() {
        try {
            const cacheKey = 'current_metals_prices';
            const now = Date.now();
            
            // Проверяем кэш
            if (this.metalsPriceCache.has(cacheKey)) {
                const cached = this.metalsPriceCache.get(cacheKey);
                if (now - cached.timestamp < this.cacheTimeout) {
                    console.log('💰 Используем кэшированные цены металлов');
                    return cached.prices;
                }
            }
            
            console.log('🔄 Получаем актуальные цены металлов с ЦБ РФ...');
            
            // Получаем данные за сегодня
            const today = new Date();
            const priceData = await this.metalsPriceService.getPriceData(today);
            
            if (priceData && priceData.metals) {
                // Конвертируем цены в формат, ожидаемый системой
                const currentPrices = {
                    'Au': priceData.metals.gold || this.fallbackMetalPrices.Au,
                    'Ag': priceData.metals.silver || this.fallbackMetalPrices.Ag,
                    'Pt': priceData.metals.platinum || this.fallbackMetalPrices.Pt,
                    'Pd': priceData.metals.palladium || this.fallbackMetalPrices.Pd
                };
                
                // Кэшируем результат
                this.metalsPriceCache.set(cacheKey, {
                    prices: currentPrices,
                    timestamp: now
                });
                
                console.log('✅ Актуальные цены металлов получены:', currentPrices);
                return currentPrices;
            } else {
                console.log('⚠️ Не удалось получить актуальные цены, используем fallback');
                return this.fallbackMetalPrices;
            }
            
        } catch (error) {
            console.error('❌ Ошибка получения цен металлов:', error.message);
            console.log('⚠️ Используем fallback цены');
            return this.fallbackMetalPrices;
        }
    }

    // Поиск аналогичных лотов
    async findSimilarLots(lot) {
        const { condition, metal, year, letters, coin_description, auction_number } = lot;
        
        console.log(`🔍 Поиск аналогичных лотов для лота ${lot.lot_number} (аукцион ${auction_number})`);
        
        // Используем универсальную функцию извлечения номинала и валюты
        const { extractDenominationAndCurrency, createDenominationSQLCondition } = require('./utils/denomination-extractor');
        const denominationData = extractDenominationAndCurrency(coin_description);
        
        console.log(`🔍 Извлеченные данные о номинале:`, denominationData);
        
        // Извлекаем название монеты (до первого четырехзначного года)
        const coinNameMatch = coin_description.match(/^(.+?)(?=\s*\d{4}г)/);
        const coinName = coinNameMatch ? coinNameMatch[1].trim() : null;
        
        // Ищем лоты с точно такими же параметрами + номинал
        // Исключаем лоты текущего аукциона (auction_number = lot.auction_number)
        // ВРЕМЕННО ИСКЛЮЧАЕМ letters из критериев поиска для упрощения
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
            WHERE metal = $1 
                AND year = $2 
                AND winning_bid IS NOT NULL 
                AND winning_bid > 0
                AND id != $3
                AND auction_number != $4
        `;
        
        const params = [metal, year, lot.id, lot.auction_number];
        
        // Для современных монет (2020+) используем более гибкий поиск по состоянию
        if (year >= 2020) {
            // Для современных монет ищем лоты с любым состоянием PF, UNC, MS, AU, XF
            query += ` AND (condition = $5 OR condition = $6 OR condition = $7 OR condition = $8 OR condition = $9 OR condition = $10)`;
            params.push(condition, 'PF', 'UNC', 'MS70', 'MS65', 'AU');
        } else if (metal === 'Pt') {
            // Для платиновых монет используем гибкий поиск по состояниям
            // Платиновые монеты редки, поэтому расширяем поиск
            query += ` AND (condition = $5 OR condition = $6 OR condition = $7 OR condition = $8 OR condition = $9 OR condition = $10 OR condition = $11)`;
            params.push(condition, 'AU', 'AUDet.', 'XF', 'XF+', 'VF', 'VF30');
        } else {
            // Для остальных старых монет используем точное совпадение состояния
            query += ` AND condition = $5`;
            params.push(condition);
        }
        
        // Если найдено название монеты, используем его для точного поиска
        if (coinName) {
            query += ` AND coin_description ILIKE $${params.length + 1}`;
            params.push(`%${coinName}%`);
        } else if (denominationData) {
            // Если название не найдено, используем номинал и валюту для точного поиска
            const denominationCondition = createDenominationSQLCondition(denominationData, params);
            query += denominationCondition;
            console.log(`🔍 Добавлено условие по номиналу и валюте: ${denominationData.fullText}`);
        }
        
        query += ` ORDER BY auction_end_date DESC`;
        
        console.log(`🔍 SQL запрос: ${query}`);
        console.log(`🔍 Параметры: [${params.join(', ')}]`);
        
        const result = await this.dbClient.query(query, params);
        
        console.log(`🔍 Найдено ${result.rows.length} лотов`);
        if (result.rows.length > 0) {
            console.log(`🔍 Первые 3 лота:`);
            result.rows.slice(0, 3).forEach((row, index) => {
                console.log(`   ${index + 1}. Лот ${row.lot_number}, Аукцион ${row.auction_number}, Цена: ${row.winning_bid}₽`);
            });
        }
        
        return result.rows;
    }

    // Поиск аналогичных лотов с точным совпадением описания (для исключенных категорий)
    async findSimilarLotsExactMatch(lot) {
        const { coin_description, auction_number } = lot;
        
        console.log(`🔍 Поиск лотов с точным совпадением описания для лота ${lot.lot_number} (категория: ${lot.category})`);
        
        // Нормализуем описание: убираем лишние пробелы, приводим к нижнему регистру для сравнения
        const normalizedDescription = coin_description.trim().toLowerCase();
        
        // Ищем лоты с точно таким же описанием (с учетом возможных вариаций пробелов)
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
            WHERE LOWER(TRIM(coin_description)) = $1
                AND winning_bid IS NOT NULL 
                AND winning_bid > 0
                AND id != $2
                AND auction_number != $3
            ORDER BY auction_end_date DESC
            LIMIT 20
        `;
        
        const params = [normalizedDescription, lot.id, lot.auction_number];
        
        console.log(`🔍 SQL запрос (точное совпадение): ${query}`);
        console.log(`🔍 Параметры: [${params.join(', ')}]`);
        
        const result = await this.dbClient.query(query, params);
        
        console.log(`🔍 Найдено ${result.rows.length} лотов с точным совпадением описания`);
        if (result.rows.length > 0) {
            console.log(`🔍 Первые 3 лота:`);
            result.rows.slice(0, 3).forEach((row, index) => {
                console.log(`   ${index + 1}. Лот ${row.lot_number}, Аукцион ${row.auction_number}, Цена: ${row.winning_bid}₽`);
            });
        }
        
        return result.rows;
    }

    // Расчет стоимости металла на текущую дату
    async calculateMetalValue(metal, weight) {
        if (!weight || weight <= 0) {
            return 0;
        }
        
        // Получаем актуальные цены металлов
        const currentPrices = await this.getCurrentMetalPrices();
        const pricePerGram = currentPrices[metal];
        
        if (!pricePerGram) {
            console.log(`⚠️ Цена для металла ${metal} не найдена, используем fallback`);
            return 0;
        }
        
        const purity = this.metalPurities[metal] || 1;
        const metalValue = pricePerGram * weight * purity;
        
        console.log(`💰 Расчет стоимости металла: ${metal} ${weight}г × ${pricePerGram}₽/г × ${purity} = ${metalValue.toFixed(2)}₽`);
        return metalValue;
    }

    // Основная функция прогнозирования
    async predictPrice(lot) {
        // Проверяем, можно ли рассчитать прогноз для данной категории
        const { canCalculatePricePrediction, requiresExactDescriptionMatch } = require('./utils/category-exclusions');
        if (!canCalculatePricePrediction(lot.category)) {
            console.log(`⚠️ Лот ${lot.lot_number}: категория "${lot.category}" исключена из расчета прогнозной цены`);
            const metalValue = await this.calculateMetalValue(lot.metal, lot.weight);
            return {
                predicted_price: null,
                metal_value: metalValue,
                numismatic_premium: null,
                confidence_score: 0,
                prediction_method: 'category_excluded',
                sample_size: 0
            };
        }
        
        // Для категорий, требующих точного совпадения описания, используем специальный поиск
        const needsExactMatch = requiresExactDescriptionMatch(lot.category);
        const similarLots = needsExactMatch 
            ? await this.findSimilarLotsExactMatch(lot)
            : await this.findSimilarLots(lot);
        
        console.log(`🔍 Лот ${lot.lot_number}: найдено ${similarLots.length} аналогичных лотов`);
        
        // Случай 1: Аналогичные лоты не найдены
        if (similarLots.length === 0) {
            console.log(`   ❌ Аналоги не найдены - прогноз не генерируется`);
            const metalValue = await this.calculateMetalValue(lot.metal, lot.weight);
            return {
                predicted_price: null,
                metal_value: metalValue,
                numismatic_premium: null,
                confidence_score: 0,
                prediction_method: 'no_similar_lots',
                sample_size: 0
            };
        }
        
        // Случай 2: Найден только один аналогичный лот
        if (similarLots.length === 1) {
            const similarLot = similarLots[0];
            const currentMetalValue = await this.calculateMetalValue(lot.metal, lot.weight);
            const similarMetalValue = await this.calculateMetalValue(similarLot.metal, similarLot.weight);
            
            // Корректируем цену на разницу в стоимости металла
            let predictedPrice = similarLot.winning_bid;
            if (currentMetalValue > 0 && similarMetalValue > 0) {
                const metalValueDifference = currentMetalValue - similarMetalValue;
                predictedPrice = similarLot.winning_bid + metalValueDifference;
                
                // Проверяем на NaN и исправляем
                if (isNaN(predictedPrice) || !isFinite(predictedPrice)) {
                    predictedPrice = similarLot.winning_bid; // Используем цену аналога без корректировки
                    console.log(`   ⚠️ Корректировка металла привела к NaN, используем цену аналога: ${similarLot.winning_bid}`);
                } else {
                    console.log(`   📊 Один аналог: ${similarLot.winning_bid} → ${predictedPrice} (корректировка металла: ${metalValueDifference.toFixed(0)})`);
                }
            } else {
                console.log(`   📊 Один аналог: ${similarLot.winning_bid} → ${predictedPrice} (без корректировки металла)`);
            }
            
            return {
                predicted_price: Math.round(predictedPrice),
                metal_value: currentMetalValue,
                numismatic_premium: Math.round(predictedPrice - currentMetalValue),
                confidence_score: 0.6, // Средняя уверенность для одного аналога
                prediction_method: 'single_similar_lot',
                sample_size: 1
            };
        }
        
        // Случай 3: Найдено два и более аналогичных лотов
        console.log(`   📈 Множественные аналоги (${similarLots.length}) - применяем статистическую модель`);
        
        // Рассчитываем статистики
        const prices = similarLots.map(lot => lot.winning_bid);
        const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
        const median = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)];
        
        // Используем медиану как более устойчивую к выбросам
        let predictedPrice = median;
        
        // Корректировка на стоимость металла для драгоценных металлов
        const currentPrices = await this.getCurrentMetalPrices();
        if (currentPrices[lot.metal] && lot.weight) {
            const currentMetalValue = await this.calculateMetalValue(lot.metal, lot.weight);
            
            // Рассчитываем среднюю стоимость металла для аналогичных лотов
            let totalSimilarMetalValue = 0;
            for (const similarLot of similarLots) {
                totalSimilarMetalValue += await this.calculateMetalValue(similarLot.metal, similarLot.weight);
            }
            const avgSimilarMetalValue = totalSimilarMetalValue / similarLots.length;
            
            // Корректируем прогноз на разницу в стоимости металла
            const metalValueDifference = currentMetalValue - avgSimilarMetalValue;
            predictedPrice = median + metalValueDifference;
            
            // Проверяем на NaN и исправляем
            if (isNaN(predictedPrice) || !isFinite(predictedPrice)) {
                predictedPrice = median; // Используем медиану без корректировки
                console.log(`   ⚠️ Корректировка металла привела к NaN, используем медиану: ${median}`);
            } else {
                console.log(`   🔧 Корректировка металла: ${metalValueDifference.toFixed(0)}`);
            }
        }
        
        // Рассчитываем уверенность на основе размера выборки и разброса цен
        const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
        const coefficientOfVariation = Math.sqrt(variance) / mean;
        
        let confidence = Math.min(0.95, 0.5 + (similarLots.length / 20)); // Базовая уверенность
        if (coefficientOfVariation > 0.5) {
            confidence *= 0.8; // Снижаем уверенность при большом разбросе
        }
        
        console.log(`   📊 Медиана: ${median}, Корректированная: ${predictedPrice}, Уверенность: ${(confidence * 100).toFixed(1)}%`);
        
        const finalMetalValue = await this.calculateMetalValue(lot.metal, lot.weight);
        const numismaticPremium = Math.round(predictedPrice - finalMetalValue);
        
        return {
            predicted_price: Math.round(predictedPrice),
            metal_value: finalMetalValue,
            numismatic_premium: numismaticPremium,
            confidence_score: confidence,
            prediction_method: 'statistical_model',
            sample_size: similarLots.length
        };
    }

    // Генерация прогнозов для аукциона
    async generatePredictionsForAuction(auctionNumber) {
        console.log(`\n🏆 Генерируем улучшенные прогнозы для аукциона ${auctionNumber}:`);
        console.log(`🔍 Тип auctionNumber: ${typeof auctionNumber}, значение: ${auctionNumber}`);
        
        // Получаем все лоты аукциона
        const lotsResult = await this.dbClient.query(`
            SELECT id, lot_number, condition, metal, weight, year, letters, winning_bid, coin_description, auction_number
            FROM auction_lots 
            WHERE auction_number = $1
            ORDER BY lot_number
        `, [auctionNumber]);
        
        const lots = lotsResult.rows;
        console.log(`📋 Найдено ${lots.length} лотов для прогнозирования`);
        
        const predictions = [];
        let processedCount = 0;
        
        for (const lot of lots) {
            try {
                const prediction = await this.predictPrice(lot);
                predictions.push({
                    lot_id: lot.id,
                    ...prediction
                });
                
                processedCount++;
                if (processedCount % 10 === 0) {
                    console.log(`   ⏳ Обработано ${processedCount}/${lots.length} лотов`);
                }
            } catch (error) {
                console.error(`❌ Ошибка прогнозирования для лота ${lot.lot_number}:`, error.message);
            }
        }
        
        console.log(`\n💾 Сохранение ${predictions.length} прогнозов в базу данных...`);
        
        // Сохраняем прогнозы
        for (const prediction of predictions) {
            try {
                await this.dbClient.query(`
                    INSERT INTO lot_price_predictions (lot_id, predicted_price, metal_value, numismatic_premium, confidence_score, prediction_method, sample_size)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (lot_id) DO UPDATE SET
                        predicted_price = EXCLUDED.predicted_price,
                        metal_value = EXCLUDED.metal_value,
                        numismatic_premium = EXCLUDED.numismatic_premium,
                        confidence_score = EXCLUDED.confidence_score,
                        prediction_method = EXCLUDED.prediction_method,
                        sample_size = EXCLUDED.sample_size,
                        created_at = NOW();
                `, [
                    prediction.lot_id,
                    prediction.predicted_price,
                    prediction.metal_value,
                    prediction.numismatic_premium,
                    prediction.confidence_score,
                    prediction.prediction_method,
                    prediction.sample_size
                ]);
            } catch (error) {
                console.error(`❌ Ошибка сохранения прогноза для лота ${prediction.lot_id}:`, error.message);
            }
        }
        
        // Статистика
        const withPredictions = predictions.filter(p => p.predicted_price !== null).length;
        const withoutPredictions = predictions.filter(p => p.predicted_price === null).length;
        
        console.log(`✅ Сохранено ${predictions.length} прогнозов для аукциона ${auctionNumber}`);
        console.log(`   📊 С прогнозами: ${withPredictions}, Без прогнозов: ${withoutPredictions}`);
    }

    // Сохранение одного прогноза (upsert)
    async savePrediction(lotId, prediction) {
        await this.dbClient.query(`
            INSERT INTO lot_price_predictions (lot_id, predicted_price, metal_value, numismatic_premium, confidence_score, prediction_method, sample_size)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (lot_id) DO UPDATE SET
                predicted_price = EXCLUDED.predicted_price,
                metal_value = EXCLUDED.metal_value,
                numismatic_premium = EXCLUDED.numismatic_premium,
                confidence_score = EXCLUDED.confidence_score,
                prediction_method = EXCLUDED.prediction_method,
                sample_size = EXCLUDED.sample_size,
                created_at = NOW();
        `, [
            lotId,
            prediction.predicted_price,
            prediction.metal_value,
            prediction.numismatic_premium,
            prediction.confidence_score,
            prediction.prediction_method,
            prediction.sample_size
        ]);
    }

    // Генерация прогнозов для конкретного списка лотов (по их ID) — режим "избранного"
    async generatePredictionsForLots(lotIds) {
        console.log(`\n🎯 Генерируем прогнозы для ${lotIds.length} выбранных лотов (избранное)`);

        const lotsResult = await this.dbClient.query(`
            SELECT id, lot_number, condition, metal, weight, year, letters, winning_bid, coin_description, auction_number, category
            FROM auction_lots
            WHERE id = ANY($1)
            ORDER BY lot_number
        `, [lotIds]);

        const lots = lotsResult.rows;
        console.log(`📋 Найдено ${lots.length} лотов для прогнозирования`);

        let savedCount = 0;
        for (const lot of lots) {
            try {
                const prediction = await this.predictPrice(lot);
                await this.savePrediction(lot.id, prediction);
                savedCount++;
                console.log(`✅ Прогноз для лота ${lot.lot_number}: ${prediction.predicted_price}₽ (${prediction.prediction_method})`);
            } catch (error) {
                console.error(`❌ Ошибка прогнозирования для лота ${lot.lot_number}:`, error.message);
            }
        }

        console.log(`✅ Сохранено ${savedCount} из ${lots.length} прогнозов`);
        return savedCount;
    }

    // Основная функция
    async generatePredictions() {
        console.log('🔮 ГЕНЕРАЦИЯ УЛУЧШЕННЫХ ПРОГНОЗОВ');
        
        // Получаем только текущий (самый новый) аукцион
        const currentAuction = await this.dbClient.query(`
            SELECT DISTINCT auction_number
            FROM auction_lots
            ORDER BY auction_number DESC
            LIMIT 1
        `);
        
        if (currentAuction.rows.length === 0) {
            console.log('❌ Активных аукционов не найдено');
            return;
        }
        
        const auctionNumber = currentAuction.rows[0].auction_number;
        console.log(`📊 Генерируем прогнозы только для текущего аукциона ${auctionNumber}`);
        
        await this.generatePredictionsForAuction(auctionNumber);
        
        console.log('\n🎉 Генерация улучшенных прогнозов завершена!');
    }
}

// Запуск
async function main() {
    const generator = new ImprovedPredictionsGenerator();
    try {
        await generator.init();
        
        // Проверяем аргументы командной строки
        const args = process.argv.slice(2);
        const watchlistIndex = args.indexOf('--watchlist');

        if (watchlistIndex !== -1 && args[watchlistIndex + 1]) {
            // Режим пересчета для конкретных лотов из избранного
            const lotIds = args[watchlistIndex + 1]
                .split(',')
                .map(id => parseInt(id.trim()))
                .filter(id => !isNaN(id));
            console.log(`🎯 Пересчет прогнозов для лотов из избранного: ${lotIds.join(', ')}`);
            await generator.generatePredictionsForLots(lotIds);
        } else if (args.length > 0) {
            const auctionNumber = args[0];
            console.log(`🎯 Генерируем прогнозы для указанного аукциона ${auctionNumber}`);
            await generator.generatePredictionsForAuction(auctionNumber);
        } else {
            await generator.generatePredictions();
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

module.exports = ImprovedPredictionsGenerator;
