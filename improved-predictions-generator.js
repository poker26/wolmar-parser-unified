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

        // Кэш цен металлов по дате (ISO 'YYYY-MM-DD') — для оценки металла на дату продажи
        this.metalsByDateCache = new Map();
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
                console.error('🚨 ВНИМАНИЕ: ЦБ РФ не вернул цены металлов — используются РЕЗЕРВНЫЕ (хардкод) цены. Прогнозы по драгметаллам НЕДОСТОВЕРНЫ:', this.fallbackMetalPrices);
                return this.fallbackMetalPrices;
            }

        } catch (error) {
            console.error('❌ Ошибка получения цен металлов:', error.message);
            console.error('🚨 ВНИМАНИЕ: используются РЕЗЕРВНЫЕ (хардкод) цены металлов. Прогнозы по драгметаллам НЕДОСТОВЕРНЫ:', this.fallbackMetalPrices);
            return this.fallbackMetalPrices;
        }
    }

    // Поиск аналогичных лотов.
    //
    // Сохранность (грейд) — ОБЯЗАТЕЛЬНОЕ строгое измерение: разница в цене между
    // грейдами одной и той же монеты бывает в разы (PF70 vs UNC и т.п.), поэтому
    // НЕЛЬЗЯ смешивать грейды в одну выборку. Раньше для современных монет (год≥2020)
    // и платины грейды пулялись (condition IN (...)), что искажало медиану — убрано.
    //
    // Тир 1: тот же металл + год + ТОЧНО тот же грейд + тип монеты (название/номинал).
    // Тир 2 (только для покрытия): если в тире 1 < 2 аналогов, снимаем фильтр по типу,
    //        НО металл+год+грейд остаются строгими.
    async findSimilarLots(lot) {
        const { condition, metal, year, coin_description, auction_number } = lot;
        console.log(`🔍 Поиск аналогов для лота ${lot.lot_number} (аукцион ${auction_number}, грейд ${condition})`);

        const { extractDenominationAndCurrency, createDenominationSQLCondition } = require('./utils/denomination-extractor');
        const coinNameMatch = coin_description ? coin_description.match(/^(.+?)(?=\s*\d{4}г)/) : null;
        const coinName = coinNameMatch ? coinNameMatch[1].trim() : null;
        const denominationData = coinName ? null : extractDenominationAndCurrency(coin_description);

        const runQuery = async (withTypeFilter) => {
            const params = [metal, year, lot.id, lot.auction_number, condition];
            let query = `
                SELECT id, lot_number, auction_number, winning_bid, metal, weight,
                       fineness, pure_metal_weight, coin_description, auction_end_date
                FROM auction_lots
                WHERE metal = $1 AND year = $2
                    AND winning_bid IS NOT NULL AND winning_bid > 0
                    AND id != $3 AND auction_number != $4
                    AND condition = $5`;
            if (withTypeFilter) {
                if (coinName) {
                    query += ` AND coin_description ILIKE $${params.length + 1}`;
                    params.push(`%${coinName}%`);
                } else if (denominationData) {
                    query += createDenominationSQLCondition(denominationData, params);
                }
            }
            query += ` ORDER BY auction_end_date DESC`;
            const r = await this.dbClient.query(query, params);
            return r.rows;
        };

        // Тир 1 — точный по типу монеты.
        let rows = await runQuery(true);
        this._lastMatchRelaxed = false;

        // Тир 2 — расширяем выборку, сохраняя строгий грейд, ради покрытия.
        if (rows.length < 2 && (coinName || denominationData)) {
            const relaxedRows = await runQuery(false);
            if (relaxedRows.length > rows.length) {
                rows = relaxedRows;
                this._lastMatchRelaxed = true;
                console.log(`🔍 Тир 2 (без фильтра по типу, грейд строгий): ${rows.length} аналогов`);
            }
        }

        console.log(`🔍 Найдено ${rows.length} аналогов (грейд ${condition}${this._lastMatchRelaxed ? ', тир 2' : ''})`);
        return rows;
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
                metal,
                weight,
                fineness,
                pure_metal_weight,
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

    // Цены металлов (₽/г) на конкретную дату из metals_prices.
    // Берём ближайшую запись с date <= нужной даты; если таких нет (дата раньше
    // начала истории) — самую раннюю. Без даты → текущие цены ЦБ.
    async getMetalPricesAtDate(date) {
        if (!date) return await this.getCurrentMetalPrices();
        const iso = (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10);
        if (this.metalsByDateCache.has(iso)) return this.metalsByDateCache.get(iso);

        let prices = this.fallbackMetalPrices;
        try {
            let r = await this.dbClient.query(
                `SELECT gold_price, silver_price, platinum_price, palladium_price
                 FROM metals_prices WHERE date <= $1 ORDER BY date DESC LIMIT 1`, [iso]);
            if (!r.rows.length) {
                r = await this.dbClient.query(
                    `SELECT gold_price, silver_price, platinum_price, palladium_price
                     FROM metals_prices ORDER BY date ASC LIMIT 1`);
            }
            if (r.rows.length) {
                const x = r.rows[0];
                prices = {
                    Au: parseFloat(x.gold_price) || this.fallbackMetalPrices.Au,
                    Ag: parseFloat(x.silver_price) || this.fallbackMetalPrices.Ag,
                    Pt: parseFloat(x.platinum_price) || this.fallbackMetalPrices.Pt,
                    Pd: parseFloat(x.palladium_price) || this.fallbackMetalPrices.Pd,
                };
            }
        } catch (e) {
            console.error('⚠️ getMetalPricesAtDate — откат на резервные цены:', e.message);
        }
        this.metalsByDateCache.set(iso, prices);
        return prices;
    }

    /**
     * Стоимость металла лота (₽).
     * opts.pureWeight  — вес чистого металла (г), из каталога/текста (приоритет);
     * opts.fineness    — проба (доли 1000), если pureWeight нет;
     * opts.date        — дата продажи: цена металла берётся на эту дату (для аналогов).
     * Если ни pureWeight, ни fineness нет — запасное допущение по metalPurities.
     */
    async calculateMetalValue(metal, weight, opts = {}) {
        const { date = null, pureWeight = null, fineness = null } = opts;

        let effPure = null;
        if (pureWeight != null && pureWeight > 0) {
            effPure = pureWeight;                                   // вес×проба уже посчитан
        } else if (weight > 0 && fineness != null && fineness > 0) {
            effPure = weight * fineness / 1000;                     // есть проба
        } else if (weight > 0) {
            effPure = weight * (this.metalPurities[metal] || 1);    // запасное допущение
        }
        if (!effPure || effPure <= 0) return 0;

        const prices = date ? await this.getMetalPricesAtDate(date) : await this.getCurrentMetalPrices();
        const pricePerGram = prices[metal];
        if (!pricePerGram) return 0;

        return pricePerGram * effPure;
    }

    /** Удобная обёртка: melt-стоимость строки-лота (на её дату продажи, по её пробе). */
    async meltValue(row, metalOverride = null) {
        return this.calculateMetalValue(
            metalOverride || row.metal,
            row.weight != null ? parseFloat(row.weight) : null,
            {
                date: row.auction_end_date || null,
                pureWeight: row.pure_metal_weight != null ? parseFloat(row.pure_metal_weight) : null,
                fineness: row.fineness != null ? parseInt(row.fineness, 10) : null,
            }
        );
    }

    // Основная функция прогнозирования
    async predictPrice(lot) {
        // Проверяем, можно ли рассчитать прогноз для данной категории
        const { canCalculatePricePrediction, requiresExactDescriptionMatch } = require('./utils/category-exclusions');
        if (!canCalculatePricePrediction(lot.category)) {
            console.log(`⚠️ Лот ${lot.lot_number}: категория "${lot.category}" исключена из расчета прогнозной цены`);
            const metalValue = await this.meltValue(lot);
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
            const metalValue = await this.meltValue(lot);
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
            const currentMetalValue = await this.meltValue(lot);
            const similarMetalValue = await this.meltValue(similarLot, lot.metal);
            
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
        
        // Корректировка на стоимость металла: melt целевого лота (на его дату) минус
        // средний melt аналогов (каждый — на СВОЮ дату продажи). Так учитывается дрейф
        // цены металла между прошлыми продажами и текущим моментом.
        const currentMetalValue = await this.meltValue(lot);
        if (currentMetalValue > 0) {
            let totalSimilarMetalValue = 0;
            for (const similarLot of similarLots) {
                totalSimilarMetalValue += await this.meltValue(similarLot, lot.metal);
            }
            const avgSimilarMetalValue = totalSimilarMetalValue / similarLots.length;

            const metalValueDifference = currentMetalValue - avgSimilarMetalValue;
            predictedPrice = median + metalValueDifference;

            // Проверяем на NaN и исправляем
            if (isNaN(predictedPrice) || !isFinite(predictedPrice)) {
                predictedPrice = median; // Используем медиану без корректировки
                console.log(`   ⚠️ Корректировка металла привела к NaN, используем медиану: ${median}`);
            } else {
                console.log(`   🔧 Корректировка металла (по датам продаж): ${metalValueDifference.toFixed(0)}`);
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
        
        const finalMetalValue = await this.meltValue(lot);
        const numismaticPremium = Math.round(predictedPrice - finalMetalValue);
        
        return {
            predicted_price: Math.round(predictedPrice),
            metal_value: finalMetalValue,
            numismatic_premium: numismaticPremium,
            confidence_score: this._lastMatchRelaxed ? confidence * 0.85 : confidence,
            prediction_method: this._lastMatchRelaxed ? 'statistical_model_relaxed' : 'statistical_model',
            sample_size: similarLots.length
        };
    }

    // Генерация прогнозов для аукциона
    async generatePredictionsForAuction(auctionNumber) {
        console.log(`\n🏆 Генерируем улучшенные прогнозы для аукциона ${auctionNumber}:`);
        console.log(`🔍 Тип auctionNumber: ${typeof auctionNumber}, значение: ${auctionNumber}`);
        
        // Получаем все лоты аукциона
        const lotsResult = await this.dbClient.query(`
            SELECT id, lot_number, condition, metal, weight, fineness, pure_metal_weight, year, letters, winning_bid, coin_description, auction_number, category, auction_end_date
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
            SELECT id, lot_number, condition, metal, weight, fineness, pure_metal_weight, year, letters, winning_bid, coin_description, auction_number, category, auction_end_date
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
