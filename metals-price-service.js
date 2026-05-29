const axios = require('axios');
const { Pool } = require('pg');
const config = require('./config');

class MetalsPriceService {
    constructor() {
        this.pool = new Pool(config.dbConfig);
        this.cache = new Map();
        this.cacheTimeout = 24 * 60 * 60 * 1000; // 24 часа
    }

    /**
     * Получение курса доллара к рублю на определенную дату
     * Использует API ЦБ РФ
     */
    async getUSDRate(date) {
        try {
            const dateStr = this.formatDateForCBR(date);
            const cacheKey = `usd_${dateStr}`;
            
            // Проверяем кэш
            if (this.cache.has(cacheKey)) {
                const cached = this.cache.get(cacheKey);
                if (Date.now() - cached.timestamp < this.cacheTimeout) {
                    return cached.data;
                }
            }

            // Запрашиваем данные с ЦБ РФ
            const response = await axios.get(
                `https://www.cbr.ru/scripts/XML_daily.asp?date_req=${dateStr}`,
                { timeout: 10000 }
            );

            // Парсим XML ответ
            const xmlData = response.data;
            const usdMatch = xmlData.match(/<Valute ID="R01235">[\s\S]*?<Value>([\d,]+)<\/Value>/);
            
            if (usdMatch) {
                const rate = parseFloat(usdMatch[1].replace(',', '.'));
                
                // Кэшируем результат
                this.cache.set(cacheKey, {
                    data: rate,
                    timestamp: Date.now()
                });
                
                return rate;
            }
            
            throw new Error('Курс доллара не найден в ответе ЦБ РФ');
            
        } catch (error) {
            console.error(`Ошибка получения курса USD на ${date}:`, error.message);
            return null;
        }
    }

    /**
     * Получение цен на драгоценные металлы с ЦБ РФ
     * Парсит веб-страницу с данными
     */
    async getMetalsPricesFromCBR(date) {
        try {
            const dateStr = this.formatDateForCBR(date);
            const cacheKey = `metals_${dateStr}`;
            
            // Проверяем кэш
            if (this.cache.has(cacheKey)) {
                const cached = this.cache.get(cacheKey);
                if (Date.now() - cached.timestamp < this.cacheTimeout) {
                    return cached.data;
                }
            }

            // Формируем URL для запроса данных ЦБ РФ
            const url = `https://cbr.ru/hd_base/metall/metall_base_new/?UniDbQuery.From=${dateStr}&UniDbQuery.To=${dateStr}&UniDbQuery.Gold=true&UniDbQuery.Silver=true&UniDbQuery.Platinum=true&UniDbQuery.Palladium=true&UniDbQuery.Posted=True&UniDbQuery.so=1`;
            
            const response = await axios.get(url, { 
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            // Парсим HTML для извлечения цен
            const html = response.data;
            const prices = this.parseMetalsPricesFromHTML(html);
            
            if (prices && Object.keys(prices).length > 0) {
                // Кэшируем результат
                this.cache.set(cacheKey, {
                    data: prices,
                    timestamp: Date.now()
                });
                
                return prices;
            }
            
            throw new Error('Цены на металлы не найдены в ответе ЦБ РФ');
            
        } catch (error) {
            console.error(`Ошибка получения цен на металлы на ${date}:`, error.message);
            return null;
        }
    }

    /**
     * Получение цен на металлы за ДИАПАЗОН дат одним запросом.
     * Возвращает массив { date: 'YYYY-MM-DD', gold, silver, platinum, palladium }
     * (только дни, по которым ЦБ опубликовал данные — выходные/праздники отсутствуют).
     */
    async getMetalsPricesRange(fromDate, toDate) {
        const from = this.formatDateForCBR(fromDate);
        const to = this.formatDateForCBR(toDate);
        const url = `https://cbr.ru/hd_base/metall/metall_base_new/?UniDbQuery.From=${from}&UniDbQuery.To=${to}&UniDbQuery.Gold=true&UniDbQuery.Silver=true&UniDbQuery.Platinum=true&UniDbQuery.Palladium=true&UniDbQuery.Posted=True&UniDbQuery.so=1`;

        const response = await axios.get(url, {
            timeout: 30000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        const html = response.data;
        const rowRegex = /<tr>\s*<td[^>]*>(\d{2}\.\d{2}\.\d{4})<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<\/tr>/g;
        const rows = [...html.matchAll(rowRegex)];

        return rows.map(m => ({
            date: this.cbrDateToISO(m[1]),
            gold: this.parsePrice(m[2]),
            silver: this.parsePrice(m[3]),
            platinum: this.parsePrice(m[4]),
            palladium: this.parsePrice(m[5])
        }));
    }

    /**
     * Получение курса USD за ДИАПАЗОН дат одним запросом (XML_dynamic ЦБ РФ).
     * Возвращает Map: 'YYYY-MM-DD' -> rate. Курс не критичен для прогноза,
     * поэтому ошибки здесь не должны останавливать загрузку металлов.
     */
    async getUSDRatesRange(fromDate, toDate) {
        const map = new Map();
        try {
            const from = this.formatDateForCBR(fromDate).replace(/\./g, '/');
            const to = this.formatDateForCBR(toDate).replace(/\./g, '/');
            const url = `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${from}&date_req2=${to}&VAL_NM_RQ=R01235`;
            const response = await axios.get(url, { timeout: 30000 });
            const recRegex = /<Record Date="(\d{2}\.\d{2}\.\d{4})"[^>]*>[\s\S]*?<Value>([\d,]+)<\/Value>[\s\S]*?<\/Record>/g;
            for (const m of response.data.matchAll(recRegex)) {
                map.set(this.cbrDateToISO(m[1]), parseFloat(m[2].replace(',', '.')));
            }
        } catch (error) {
            console.error('⚠️ Не удалось получить курсы USD за период:', error.message);
        }
        return map;
    }

    /**
     * Альтернативный метод получения цен через Metals-API (если есть API ключ)
     */
    async getMetalsPricesFromAPI(date, apiKey = null) {
        if (!apiKey) return null;
        
        try {
            const dateStr = this.formatDateForAPI(date);
            const response = await axios.get(
                `https://metals-api.com/api/${dateStr}?access_key=${apiKey}&base=USD&symbols=XAU,XAG,XPT,XPD`,
                { timeout: 10000 }
            );

            if (response.data.success) {
                return {
                    gold: response.data.rates.XAU,
                    silver: response.data.rates.XAG,
                    platinum: response.data.rates.XPT,
                    palladium: response.data.rates.XPD
                };
            }
            
            throw new Error('API вернул ошибку');
            
        } catch (error) {
            console.error(`Ошибка получения цен через Metals-API на ${date}:`, error.message);
            return null;
        }
    }

    /**
     * Получение всех необходимых данных (курс USD + цены на металлы)
     */
    async getPriceData(date) {
        try {
            const [usdRate, metalsPrices] = await Promise.all([
                this.getUSDRate(date),
                this.getMetalsPricesFromCBR(date)
            ]);

            return {
                date: date,
                usdRate: usdRate,
                metals: metalsPrices,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            console.error(`Ошибка получения данных на ${date}:`, error.message);
            return null;
        }
    }

    /**
     * Получение данных за период (последние 10 лет)
     */
    async getHistoricalData(years = 10) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setFullYear(endDate.getFullYear() - years);
        
        const results = [];
        const currentDate = new Date(startDate);
        
        console.log(`📊 Загружаем данные с ${startDate.toLocaleDateString()} по ${endDate.toLocaleDateString()}`);
        
        while (currentDate <= endDate) {
            // Пропускаем выходные дни
            if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6) {
                const data = await this.getPriceData(new Date(currentDate));
                if (data) {
                    results.push(data);
                    console.log(`✅ ${currentDate.toLocaleDateString()}: USD=${data.usdRate}, Au=${data.metals?.gold || 'N/A'}`);
                } else {
                    console.log(`❌ ${currentDate.toLocaleDateString()}: данные не получены`);
                }
                
                // Небольшая задержка между запросами
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        return results;
    }

    /**
     * Сохранение данных в базу данных
     */
    async saveToDatabase(priceData) {
        try {
            const insertQuery = `
                INSERT INTO metals_prices (date, usd_rate, gold_price, silver_price, platinum_price, palladium_price, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (date) 
                DO UPDATE SET
                    usd_rate = EXCLUDED.usd_rate,
                    gold_price = EXCLUDED.gold_price,
                    silver_price = EXCLUDED.silver_price,
                    platinum_price = EXCLUDED.platinum_price,
                    palladium_price = EXCLUDED.palladium_price,
                    updated_at = $7
            `;

            await this.pool.query(insertQuery, [
                priceData.date,
                priceData.usdRate,
                priceData.metals?.gold || null,
                priceData.metals?.silver || null,
                priceData.metals?.platinum || null,
                priceData.metals?.palladium || null,
                new Date()
            ]);

            return true;
            
        } catch (error) {
            console.error('Ошибка сохранения в базу данных:', error);
            return false;
        }
    }

    /**
     * Получение цены металла на определенную дату из базы данных
     */
    async getMetalPriceFromDB(date, metal) {
        try {
            // Маппинг металлов на названия колонок в БД
            const metalColumns = {
                'gold': 'gold_price',
                'silver': 'silver_price', 
                'platinum': 'platinum_price',
                'palladium': 'palladium_price',
                'gold_price': 'gold_price',
                'silver_price': 'silver_price',
                'platinum_price': 'platinum_price',
                'palladium_price': 'palladium_price',
                'au': 'gold_price',
                'ag': 'silver_price',
                'pt': 'platinum_price',
                'pd': 'palladium_price',
                'au_price': 'gold_price',
                'ag_price': 'silver_price',
                'pt_price': 'platinum_price',
                'pd_price': 'palladium_price'
            };
            
            const columnName = metalColumns[metal];
            if (!columnName) {
                throw new Error(`Неизвестный металл: ${metal}`);
            }
            
            const query = `
                SELECT ${columnName} as price, usd_rate
                FROM metals_prices 
                WHERE date = $1
            `;
            
            const result = await this.pool.query(query, [date]);
            
            if (result.rows.length > 0) {
                return {
                    price: result.rows[0].price,
                    usdRate: result.rows[0].usd_rate
                };
            }
            
            return null;
            
        } catch (error) {
            console.error(`Ошибка получения цены ${metal} из БД:`, error);
            return null;
        }
    }

    /**
     * Вычисление нумизматической наценки
     */
    calculateNumismaticPremium(lotPrice, metalWeight, metalPricePerGram, usdRate) {
        if (!metalWeight || !metalPricePerGram || !usdRate) {
            return null;
        }

        // Стоимость металла в рублях
        const metalValue = metalWeight * metalPricePerGram;
        
        // Нумизматическая наценка
        const premium = lotPrice - metalValue;
        const premiumPercent = (premium / metalValue) * 100;
        
        return {
            lotPrice: lotPrice,
            metalWeight: metalWeight,
            metalPricePerGram: metalPricePerGram,
            metalValue: metalValue,
            premium: premium,
            premiumPercent: premiumPercent
        };
    }

    /**
     * Вспомогательные методы
     */
    formatDateForCBR(date) {
        const d = new Date(date);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}.${month}.${year}`;
    }

    // 'DD.MM.YYYY' -> 'YYYY-MM-DD'
    cbrDateToISO(cbrDate) {
        const [day, month, year] = cbrDate.split('.');
        return `${year}-${month}-${day}`;
    }

    formatDateForAPI(date) {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    parseMetalsPricesFromHTML(html) {
        try {
            const prices = {};
            
            // Ищем строку с данными (вторая строка таблицы)
            const dataRowMatch = html.match(/<tr>\s*<td>[\d\.]+<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<\/tr>/);
            
            if (dataRowMatch) {
                // Извлекаем цены из ячеек (порядок: золото, серебро, платина, палладий)
                const goldPrice = this.parsePrice(dataRowMatch[1]);
                const silverPrice = this.parsePrice(dataRowMatch[2]);
                const platinumPrice = this.parsePrice(dataRowMatch[3]);
                const palladiumPrice = this.parsePrice(dataRowMatch[4]);
                
                if (goldPrice !== null) prices.gold = goldPrice;
                if (silverPrice !== null) prices.silver = silverPrice;
                if (platinumPrice !== null) prices.platinum = platinumPrice;
                if (palladiumPrice !== null) prices.palladium = palladiumPrice;
            }
            
            return Object.keys(prices).length > 0 ? prices : null;
            
        } catch (error) {
            console.error('Ошибка парсинга HTML:', error);
            return null;
        }
    }

    parsePrice(priceStr) {
        try {
            // Убираем HTML теги и пробелы
            const cleanPrice = priceStr.replace(/<[^>]*>/g, '').trim();
            
            // Заменяем пробелы на пустую строку и запятую на точку
            const normalizedPrice = cleanPrice.replace(/\s/g, '').replace(',', '.');
            
            const price = parseFloat(normalizedPrice);
            return isNaN(price) ? null : price;
            
        } catch (error) {
            return null;
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = MetalsPriceService;
