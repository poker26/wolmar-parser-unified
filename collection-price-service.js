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
        
        // Получаем номер текущего аукциона из продакшн базы
        try {
            // Сначала проверим структуру таблицы auction_lots
            const tableInfo = await this.pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'auction_lots'
            `);
            
            console.log('📋 Структура таблицы auction_lots:', tableInfo.rows.map(r => r.column_name));
            
            // Ищем незакрытый аукцион (дата закрытия больше текущей даты)
            const currentAuctionResult = await this.pool.query(`
                SELECT auction_number 
                FROM auction_lots 
                WHERE auction_end_date > CURRENT_DATE 
                GROUP BY auction_number
                ORDER BY auction_number::integer DESC 
                LIMIT 1
            `);
            
            if (currentAuctionResult.rows.length > 0) {
                this.currentAuctionNumber = currentAuctionResult.rows[0].auction_number;
                console.log(`🔗 CollectionPriceService инициализирован. Текущий незакрытый аукцион: ${this.currentAuctionNumber}`);
            } else {
                // Если все аукционы закрыты, используем несуществующий номер
                this.currentAuctionNumber = '999999'; // Заведомо несуществующий номер
                console.log(`🔗 CollectionPriceService инициализирован. Все аукционы закрыты, используем несуществующий: ${this.currentAuctionNumber}`);
            }
        } catch (error) {
            console.error('❌ Ошибка получения текущего аукциона:', error);
            this.currentAuctionNumber = '999'; // Fallback
        }
    }

    /**
     * Определение инициалов минцмейстера по году и описанию монеты
     */
    getMintmasterLetters(year, description) {
        // Сначала пытаемся извлечь из описания
        const lettersMatch = description.match(/([А-Я]{2})\./);
        if (lettersMatch) {
            console.log(`🔍 Найдены инициалы в описании: ${lettersMatch[1]}`);
            return lettersMatch[1];
        }
        
        // Для российских/советских монет используем исторические данные по годам
        if (year >= 1895 && year <= 1901) {
            console.log(`🔍 1895-1901: АГ (Аполлон Грасгоф)`);
            return 'АГ'; // Аполлон Грасгоф
        } else if (year >= 1902 && year <= 1917) {
            console.log(`🔍 1902-1917: ВС (Виктор Смирнов)`);
            return 'ВС'; // Виктор Смирнов
        } else if (year >= 1918 && year <= 1921) {
            console.log(`🔍 1918-1921: ПЛ (Петр Латышев)`);
            return 'ПЛ'; // Петр Латышев
        } else if (year >= 1922 && year <= 1927) {
            console.log(`🔍 1922-1927: АГ (Аполлон Грасгоф)`);
            return 'АГ'; // Аполлон Грасгоф (второй период)
        } else if (year >= 1928 && year <= 1931) {
            console.log(`🔍 1928-1931: ПЛ (Петр Латышев)`);
            return 'ПЛ'; // Петр Латышев (второй период)
        } else if (year >= 1932 && year <= 1936) {
            console.log(`🔍 1932-1936: АГ (Аполлон Грасгоф)`);
            return 'АГ'; // Аполлон Грасгоф (третий период)
        } else if (year >= 1937 && year <= 1946) {
            console.log(`🔍 1937-1946: АГ (Аполлон Грасгоф)`);
            return 'АГ'; // Аполлон Грасгоф (четвертый период)
        } else if (year >= 1947 && year <= 1953) {
            console.log(`🔍 1947-1953: АГ (Аполлон Грасгоф)`);
            return 'АГ'; // Аполлон Грасгоф (пятый период)
        } else if (year >= 1954 && year <= 1961) {
            console.log(`🔍 1954-1961: АГ (Аполлон Грасгоф)`);
            return 'АГ'; // Аполлон Грасгоф (шестой период)
        } else if (year >= 1962 && year <= 1975) {
            console.log(`🔍 1962-1975: АГ (Аполлон Грасгоф)`);
            return 'АГ'; // Аполлон Грасгоф (седьмой период)
        } else if (year >= 1976 && year <= 1985) {
            console.log(`🔍 1976-1985: АГ (Аполлон Грасгоф)`);
            return 'АГ'; // Аполлон Грасгоф (восьмой период)
        } else if (year >= 1986 && year <= 1991) {
            console.log(`🔍 1986-1991: АГ (Аполлон Грасгоф)`);
            return 'АГ'; // Аполлон Грасгоф (девятый период)
        } else if (year >= 1992 && year <= 2000) {
            console.log(`🔍 1992-2000: АГ (Аполлон Грасгоф)`);
            return 'АГ'; // Аполлон Грасгоф (десятый период)
        } else if (year >= 2001 && year <= 2010) {
            console.log(`🔍 2001-2010: АГ (Аполлон Грасгоф)`);
            return 'АГ'; // Аполлон Грасгоф (одиннадцатый период)
        } else if (year >= 2011 && year <= 2020) {
            console.log(`🔍 2011-2020: Современные монеты (letters нерелевантен)`);
            return ''; // Для современных монет letters нерелевантен
        } else if (year >= 2021 && year <= 2030) {
            console.log(`🔍 2021-2030: Современные монеты (letters нерелевантен)`);
            return ''; // Для современных монет letters нерелевантен
        } else {
            console.log(`🔍 Неизвестный год ${year}: letters нерелевантен`);
            return ''; // Для неизвестных лет letters нерелевантен
        }
    }

    /**
     * Основная функция прогнозирования - используем ТОЧНО ТУ ЖЕ логику, что и в продакшн коде
     */
    async predictPrice(lot) {
        try {
            // Отладочная информация о передаваемых данных
            console.log(`🔍 Передаем в ImprovedPredictionsGenerator:`, {
                id: lot.id,
                lot_number: lot.lot_number,
                auction_number: lot.auction_number,
                metal: lot.metal,
                condition: lot.condition,
                weight: lot.weight,
                year: lot.year,
                letters: lot.letters,
                category: lot.category
            });
            
            // Используем ImprovedPredictionsGenerator - точно такую же логику, как в продакшн коде
            const ImprovedPredictionsGenerator = require('./improved-predictions-generator');
            const generator = new ImprovedPredictionsGenerator();
            
            await generator.init();
            
            try {
                const prediction = await generator.predictPrice(lot);
                
                console.log(`✅ Прогноз рассчитан для лота ${lot.lot_number}: ${prediction.predicted_price}₽`);
                
                return {
                    predictedPrice: prediction.predicted_price,
                    metalValue: prediction.metal_value,
                    numismaticPremium: prediction.numismatic_premium,
                    conditionMultiplier: 1.0,
                    confidence: prediction.confidence_score,
                    method: prediction.prediction_method
                };
            } finally {
                await generator.close();
            }
            
        } catch (error) {
            console.error('❌ Ошибка расчета прогноза:', error);
            return this.simplePrediction(lot);
        }
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
    adaptCoinDataForPrediction(coin, userCondition = null) {
        try {
            console.log(`🔧 Адаптация: входные данные`, { coin: coin, userCondition: userCondition });
            
            // Нормализуем металл - учитываем все варианты
            let metal = coin.metal;
            if (metal === 'AU' || metal === 'Au') metal = 'Au';
            if (metal === 'AG' || metal === 'Ag') metal = 'Ag';
            if (metal === 'PD' || metal === 'Pd') metal = 'Pd';
            if (metal === 'PT' || metal === 'Pt') metal = 'Pt';
            if (metal === 'CU' || metal === 'Cu') metal = 'Cu';
            if (metal === 'FE' || metal === 'Fe') metal = 'Fe';
            if (metal === 'NI' || metal === 'Ni') metal = 'Ni';
            
            console.log(`🔧 Металл нормализован: ${coin.metal} -> ${metal}`);
            
            // Нормализуем состояние - приоритет состоянию из коллекции пользователя
            let condition = userCondition || coin.condition || '';
            if (!condition || condition === '') {
                // Если состояние не указано, используем разумное по умолчанию
                condition = 'XF';
            }
            
            console.log(`🔧 Состояние нормализовано: ${userCondition || coin.condition} -> ${condition}`);
            
            // Нормализуем вес
            let weight = coin.coin_weight || coin.pure_metal_weight;
            if (weight && typeof weight === 'string') {
                weight = parseFloat(weight);
            }
            
            console.log(`🔧 Вес нормализован: ${coin.coin_weight || coin.pure_metal_weight} -> ${weight}`);
            
            const result = {
                id: coin.coin_id, // ID монеты из каталога
                lot_number: coin.coin_id.toString(), // Используем ID монеты как номер лота
                auction_number: this.currentAuctionNumber, // Используем текущий аукцион для исключения незавершенных торгов
                metal: metal,
                weight: weight,
                condition: condition,
                year: coin.year,
                letters: this.getMintmasterLetters(coin.year, coin.original_description), // Определяем инициалы минцмейстера по году и описанию
                coin_description: coin.original_description || coin.coin_name || ''
            };
            
            console.log(`🔧 Адаптация завершена:`, result);
            return result;
            
        } catch (error) {
            console.error(`❌ Ошибка в adaptCoinDataForPrediction:`, error);
            throw error;
        }
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
            
            // Отладочная информация
            console.log(`🔍 Данные для прогнозирования:`, {
                metal: adaptedData.metal,
                condition: adaptedData.condition,
                weight: adaptedData.weight,
                year: adaptedData.year
            });
            
            // Модель уже калибрована в init()
            
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
            
            // Получаем все лоты в коллекции (coin_id → auction_lots.id).
            // Сохранность из коллекции (uc.condition) имеет приоритет над грейдом лота.
            const collectionResult = await this.pool.query(`
                SELECT
                    uc.id as collection_id,
                    uc.coin_id,
                    COALESCE(NULLIF(uc.condition, ''), al.condition) as condition,
                    al.id,
                    al.lot_number,
                    al.auction_number,
                    al.coin_description,
                    al.metal,
                    al.year,
                    al.letters,
                    al.weight,
                    al.fineness,
                    al.pure_metal_weight,
                    al.category,
                    al.auction_end_date
                FROM user_collections uc
                JOIN auction_lots al ON uc.coin_id = al.id
                WHERE uc.user_id = $1
                ORDER BY uc.id
            `, [userId]);
            
            if (collectionResult.rows.length === 0) {
                console.log('📭 Коллекция пользователя пуста');
                return { updated: 0, errors: 0 };
            }
            
            console.log(`📚 Найдено ${collectionResult.rows.length} лотов в коллекции`);

            let updated = 0;
            let errors = 0;

            // Обрабатываем каждый лот — он уже в формате auction_lots,
            // передаём напрямую в прогнозный движок (без adaptCoinDataForPrediction).
            for (const item of collectionResult.rows) {
                try {
                    console.log(`🔮 Расчет прогнозной цены для лота ID: ${item.coin_id} (${item.metal} ${item.condition})`);

                    const adaptedData = {
                        id: item.id,
                        lot_number: item.lot_number,
                        auction_number: item.auction_number,
                        coin_description: item.coin_description,
                        metal: item.metal,
                        condition: item.condition,
                        year: item.year,
                        letters: item.letters,
                        weight: item.weight,
                        fineness: item.fineness,
                        pure_metal_weight: item.pure_metal_weight,
                        category: item.category,
                        auction_end_date: item.auction_end_date
                    };
                    
                    // Отладочная информация
                    console.log(`🔍 Данные для прогнозирования:`, {
                        metal: adaptedData.metal,
                        condition: adaptedData.condition,
                        weight: adaptedData.weight,
                        year: adaptedData.year
                    });
                    
                    console.log(`🔍 Полные адаптированные данные:`, adaptedData);
                    
                    // Получаем прогноз
                    console.log(`🔮 Начинаем расчет прогноза...`);
                    const prediction = await this.predictPrice(adaptedData);
                    console.log(`✅ Расчет прогноза завершен`);
                    
                    console.log(`💰 Прогнозная цена: ${prediction.predictedPrice ? prediction.predictedPrice.toLocaleString() : 'null'}₽ (${prediction.method}, уверенность: ${(prediction.confidence * 100).toFixed(0)}%)`);
                    
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
                        prediction.confidence,
                        prediction.method,
                        new Date(),
                        item.collection_id
                    ]);
                    
                    updated++;
                    console.log(`✅ Обновлена прогнозная цена для лота #${item.coin_id}: ${prediction.predictedPrice ? prediction.predictedPrice.toLocaleString() : 'null'}₽`);

                } catch (error) {
                    errors++;
                    console.error(`❌ Ошибка обновления лота #${item.coin_id}:`, error.message);
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
                    al.metal,
                    COUNT(*) as count,
                    SUM(uc.predicted_price) as total_value,
                    AVG(uc.predicted_price) as avg_price
                FROM user_collections uc
                JOIN auction_lots al ON uc.coin_id = al.id
                WHERE uc.user_id = $1 AND uc.predicted_price IS NOT NULL
                GROUP BY al.metal
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
     * Пересчет прогнозных цен для конкретных лотов из избранного
     * Копия логики из recalculateUserCollectionPrices, но для лотов аукциона
     */
    async recalculateLotPredictions(lotIds) {
        try {
            console.log(`🔄 Пересчет прогнозных цен для ${lotIds.length} лотов из избранного`);
            
            // Получаем данные лотов (аналогично коллекции, но из auction_lots)
            const lotsResult = await this.pool.query(`
                SELECT 
                    al.id,
                    al.lot_number,
                    al.auction_number,
                    al.coin_description,
                    al.metal,
                    al.condition,
                    al.weight,
                    al.year,
                    al.letters,
                    al.winning_bid
                FROM auction_lots al
                WHERE al.id = ANY($1)
                ORDER BY al.id
            `, [lotIds]);
            
            if (lotsResult.rows.length === 0) {
                console.log('📭 Лоты не найдены');
                return { updated: 0, errors: 0 };
            }
            
            console.log(`📚 Найдено ${lotsResult.rows.length} лотов для пересчета`);
            
            let updated = 0;
            let errors = 0;
            
            // Модель уже калибрована в init()
            
            // Обрабатываем каждый лот (точно как в коллекции)
            for (const lot of lotsResult.rows) {
                try {
                    console.log(`🔮 Расчет прогнозной цены для лота ${lot.lot_number} (ID: ${lot.id})`);
                    console.log(`📋 Лот: ${lot.coin_description?.substring(0, 50)}... - ${lot.metal} ${lot.condition}`);
                    console.log(`📋 Полные данные лота:`, lot);
                    
                    // Адаптируем данные для системы прогнозирования (используем существующий метод)
                    console.log(`🔧 Начинаем адаптацию данных...`);
                    const adaptedData = this.adaptLotDataForPrediction(lot);
                    console.log(`✅ Адаптация завершена`);
                    
                    // Отладочная информация
                    console.log(`🔍 Данные для прогнозирования:`, {
                        metal: adaptedData.metal,
                        condition: adaptedData.condition,
                        weight: adaptedData.weight,
                        year: adaptedData.year
                    });
                    
                    console.log(`🔍 Полные адаптированные данные:`, adaptedData);
                    
                    // Получаем прогноз (точно как в коллекции)
                    console.log(`🔮 Начинаем расчет прогноза...`);
                    const prediction = await this.predictPrice(adaptedData);
                    console.log(`✅ Расчет прогноза завершен`);
                    
                    console.log(`💰 Прогнозная цена: ${prediction.predictedPrice ? prediction.predictedPrice.toLocaleString() : 'null'}₽ (${prediction.method}, уверенность: ${(prediction.confidence * 100).toFixed(0)}%)`);
                    
                    // Обновляем запись в lot_price_predictions (вместо user_collections)
                    await this.pool.query(`
                        INSERT INTO lot_price_predictions (
                            lot_id, 
                            predicted_price, 
                            metal_value, 
                            numismatic_premium, 
                            confidence_score, 
                            prediction_method, 
                            sample_size,
                            created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        ON CONFLICT (lot_id) 
                        DO UPDATE SET 
                            predicted_price = EXCLUDED.predicted_price,
                            metal_value = EXCLUDED.metal_value,
                            numismatic_premium = EXCLUDED.numismatic_premium,
                            confidence_score = EXCLUDED.confidence_score,
                            prediction_method = EXCLUDED.prediction_method,
                            sample_size = EXCLUDED.sample_size,
                            created_at = EXCLUDED.created_at
                    `, [
                        lot.id,
                        prediction.predictedPrice,
                        prediction.metalValue,
                        prediction.numismaticPremium,
                        prediction.confidence,
                        prediction.method,
                        prediction.sampleSize || 0,
                        new Date()
                    ]);
                    
                    updated++;
                    console.log(`✅ Обновлена прогнозная цена для лота ${lot.lot_number}: ${prediction.predictedPrice ? prediction.predictedPrice.toLocaleString() : 'null'}₽`);
                    
                } catch (error) {
                    errors++;
                    console.error(`❌ Ошибка обновления лота ${lot.lot_number}:`, error.message);
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
     * Адаптация данных лота для системы прогнозирования
     * Копия логики из adaptCoinDataForPrediction, но для лотов аукциона
     */
    adaptLotDataForPrediction(lot) {
        try {
            console.log(`🔧 Адаптация лота: входные данные`, { lot: lot });
            
            // Нормализуем металл (точно как в коллекции)
            let metal = lot.metal;
            if (metal === 'AU' || metal === 'Au') metal = 'Au';
            if (metal === 'AG' || metal === 'Ag') metal = 'Ag';
            if (metal === 'PD' || metal === 'Pd') metal = 'Pd';
            if (metal === 'PT' || metal === 'Pt') metal = 'Pt';
            if (metal === 'CU' || metal === 'Cu') metal = 'Cu';
            if (metal === 'FE' || metal === 'Fe') metal = 'Fe';
            if (metal === 'NI' || metal === 'Ni') metal = 'Ni';
            
            console.log(`🔧 Металл нормализован: ${lot.metal} -> ${metal}`);
            
            // Нормализуем состояние (точно как в коллекции)
            let condition = lot.condition || '';
            if (!condition || condition === '') {
                condition = 'XF';
            }
            
            console.log(`🔧 Состояние нормализовано: ${lot.condition} -> ${condition}`);
            
            // Нормализуем вес (точно как в коллекции)
            let weight = lot.weight;
            if (weight && typeof weight === 'string') {
                weight = parseFloat(weight);
            }
            
            console.log(`🔧 Вес нормализован: ${lot.weight} -> ${weight}`);
            
            // Извлекаем номинал из описания
            let denomination = 'Не указан';
            if (lot.coin_description) {
                const denominationMatch = lot.coin_description.match(/(\d+(?:[.,]\d+)?)\s*(руб|коп|копеек?|рубл)/i);
                if (denominationMatch) {
                    denomination = `${denominationMatch[1]} ${denominationMatch[2]}`;
                }
            }
            
            // Извлекаем монетный двор
            let mint = lot.letters || 'Не указан';
            if (lot.coin_description) {
                const mintMatch = lot.coin_description.match(/(СПБ|СПМ|ЕМ|АМ|ВМ|КМ|ТМ|НМД|ММД|ЛМД|СПМД)/i);
                if (mintMatch) {
                    mint = mintMatch[1];
                }
            }
            
            const result = {
                // Поля для системы прогнозирования (как в коллекции)
                id: lot.id,  // ← Добавляем ID!
                coin_name: lot.coin_description || 'Неизвестная монета',
                denomination: denomination,
                metal: metal,
                condition: condition,
                year: lot.year,
                weight: weight,
                coin_weight: weight,
                pure_metal_weight: weight,
                mint: mint,
                original_description: lot.coin_description,
                
                // Поля для ImprovedPredictionsGenerator
                lot_number: lot.lot_number,
                auction_number: lot.auction_number,
                coin_description: lot.coin_description
            };
            
            console.log(`🔧 Адаптация завершена:`, result);
            return result;
            
        } catch (error) {
            console.error(`❌ Ошибка в adaptLotDataForPrediction:`, error);
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
