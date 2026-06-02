const { Pool } = require('pg');
const config = require('./config');

// «Моя коллекция» = сохранённые лоты аукционов. coin_id в user_collections
// исторически указывает на auction_lots.id (таблицы coin_catalog в этой БД нет).
// Поэтому весь сервис работает поверх auction_lots + прогнозного движка.
class CollectionService {
    constructor() {
        this.pool = new Pool(config.dbConfig);
    }

    // Набор полей лота, который отдаём фронту. Алиасим под старые имена
    // (coin_name/original_description), чтобы существующий UI каталога не сломался.
    _lotSelect(alias = 'al') {
        return `
                    ${alias}.id as coin_id,
                    ${alias}.coin_description as coin_name,
                    ${alias}.coin_description as original_description,
                    ${alias}.year,
                    ${alias}.metal,
                    ${alias}.condition as lot_condition,
                    ${alias}.category,
                    ${alias}.weight as coin_weight,
                    ${alias}.fineness,
                    ${alias}.pure_metal_weight,
                    ${alias}.auction_number,
                    ${alias}.lot_number,
                    ${alias}.winning_bid,
                    ${alias}.letters,
                    ${alias}.avers_image_url,
                    ${alias}.revers_image_url`;
    }

    // Добавить лот в коллекцию (с годом и сохранностью).
    // condition — пользовательская сохранность; если не задана, берём грейд самого лота.
    async addToCollection(userId, coinId, notes = null, condition = null, purchasePrice = null, purchaseDate = null) {
        const client = await this.pool.connect();

        try {
            // Проверяем, существует ли лот
            const lotCheck = await client.query(
                'SELECT id, coin_description, condition FROM auction_lots WHERE id = $1',
                [coinId]
            );

            if (lotCheck.rows.length === 0) {
                throw new Error('Лот не найден в базе аукционов');
            }

            // Проверяем, не добавлен ли уже лот в коллекцию
            const existingCheck = await client.query(
                'SELECT id FROM user_collections WHERE user_id = $1 AND coin_id = $2',
                [userId, coinId]
            );

            if (existingCheck.rows.length > 0) {
                throw new Error('Монета уже добавлена в коллекцию');
            }

            // Сохранность по умолчанию — грейд лота
            const effCondition = (condition && String(condition).trim() !== '')
                ? condition
                : lotCheck.rows[0].condition;

            const result = await client.query(`
                INSERT INTO user_collections (user_id, coin_id, notes, condition, purchase_price, purchase_date)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, added_at
            `, [userId, coinId, notes, effCondition, purchasePrice, purchaseDate]);

            const collection = result.rows[0];
            console.log(`✅ Лот #${coinId} «${(lotCheck.rows[0].coin_description || '').slice(0, 40)}» добавлен в коллекцию пользователя ${userId}`);

            return {
                id: collection.id,
                coinId,
                condition: effCondition,
                addedAt: collection.added_at
            };

        } catch (error) {
            console.error('❌ Ошибка добавления в коллекцию:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    // Удалить лот из коллекции
    async removeFromCollection(userId, coinId) {
        const client = await this.pool.connect();

        try {
            const result = await client.query(
                'DELETE FROM user_collections WHERE user_id = $1 AND coin_id = $2 RETURNING id',
                [userId, coinId]
            );

            if (result.rows.length === 0) {
                throw new Error('Монета не найдена в коллекции');
            }

            console.log(`✅ Лот #${coinId} удалён из коллекции пользователя ${userId}`);
            return { success: true };

        } catch (error) {
            console.error('❌ Ошибка удаления из коллекции:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    // Получить коллекцию пользователя с пагинацией
    async getUserCollection(userId, page = 1, limit = 20, filters = {}) {
        const client = await this.pool.connect();

        try {
            const offset = (page - 1) * limit;

            let query = `
                SELECT
                    uc.id as collection_id,
                    uc.added_at,
                    uc.notes,
                    uc.condition,
                    uc.purchase_price,
                    uc.purchase_date,
                    uc.predicted_price,
                    uc.confidence_score,
                    uc.prediction_method,
                    uc.price_calculation_date,
                    ${this._lotSelect('al')}
                FROM user_collections uc
                JOIN auction_lots al ON uc.coin_id = al.id
                WHERE uc.user_id = $1
            `;

            const queryParams = [userId];
            let paramIndex = 2;

            if (filters.metal) {
                query += ` AND al.metal = $${paramIndex}`;
                queryParams.push(filters.metal);
                paramIndex++;
            }
            if (filters.category) {
                query += ` AND al.category = $${paramIndex}`;
                queryParams.push(filters.category);
                paramIndex++;
            }
            if (filters.yearFrom) {
                query += ` AND al.year >= $${paramIndex}`;
                queryParams.push(filters.yearFrom);
                paramIndex++;
            }
            if (filters.yearTo) {
                query += ` AND al.year <= $${paramIndex}`;
                queryParams.push(filters.yearTo);
                paramIndex++;
            }
            if (filters.search) {
                query += ` AND al.coin_description ILIKE $${paramIndex}`;
                queryParams.push(`%${filters.search}%`);
                paramIndex++;
            }

            query += ` ORDER BY uc.added_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            queryParams.push(limit, offset);

            const result = await client.query(query, queryParams);

            // Подсчёт общего числа записей
            let countQuery = `
                SELECT COUNT(*) as total
                FROM user_collections uc
                JOIN auction_lots al ON uc.coin_id = al.id
                WHERE uc.user_id = $1
            `;
            const countParams = [userId];
            let cpi = 2;
            if (filters.metal) { countQuery += ` AND al.metal = $${cpi}`; countParams.push(filters.metal); cpi++; }
            if (filters.category) { countQuery += ` AND al.category = $${cpi}`; countParams.push(filters.category); cpi++; }
            if (filters.yearFrom) { countQuery += ` AND al.year >= $${cpi}`; countParams.push(filters.yearFrom); cpi++; }
            if (filters.yearTo) { countQuery += ` AND al.year <= $${cpi}`; countParams.push(filters.yearTo); cpi++; }
            if (filters.search) { countQuery += ` AND al.coin_description ILIKE $${cpi}`; countParams.push(`%${filters.search}%`); cpi++; }

            const countResult = await client.query(countQuery, countParams);
            const total = parseInt(countResult.rows[0].total);

            const processedCoins = result.rows.map(coin => {
                if (coin.purchase_date) {
                    const date = new Date(coin.purchase_date);
                    coin.purchase_date = date.toISOString().split('T')[0];
                }
                return coin;
            });

            return {
                coins: processedCoins,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            };

        } catch (error) {
            console.error('❌ Ошибка получения коллекции:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    // Обновить информацию о монете в коллекции
    async updateCollectionItem(userId, coinId, updates) {
        const client = await this.pool.connect();

        try {
            const allowedFields = ['notes', 'condition_rating', 'condition', 'purchase_price', 'purchase_date'];
            const updateFields = [];
            const values = [];
            let paramIndex = 1;

            for (const [field, value] of Object.entries(updates)) {
                if (allowedFields.includes(field) && value !== undefined) {
                    updateFields.push(`${field} = $${paramIndex}`);
                    values.push(value);
                    paramIndex++;
                }
            }

            if (updateFields.length === 0) {
                throw new Error('Нет полей для обновления');
            }

            values.push(userId, coinId);
            const query = `
                UPDATE user_collections
                SET ${updateFields.join(', ')}
                WHERE user_id = $${paramIndex} AND coin_id = $${paramIndex + 1}
                RETURNING id, notes, condition_rating, condition, purchase_price, purchase_date
            `;

            const result = await client.query(query, values);

            if (result.rows.length === 0) {
                throw new Error('Монета не найдена в коллекции');
            }

            console.log(`✅ Информация о монете в коллекции пользователя ${userId} обновлена`);
            return result.rows[0];

        } catch (error) {
            console.error('❌ Ошибка обновления коллекции:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    // Проверить, есть ли монета в коллекции
    async isInCollection(userId, coinId) {
        const client = await this.pool.connect();

        try {
            const result = await client.query(
                'SELECT id FROM user_collections WHERE user_id = $1 AND coin_id = $2',
                [userId, coinId]
            );

            return result.rows.length > 0;

        } catch (error) {
            console.error('❌ Ошибка проверки коллекции:', error.message);
            return false;
        } finally {
            client.release();
        }
    }

    // Получить статистику коллекции
    async getCollectionStats(userId) {
        const client = await this.pool.connect();

        try {
            const stats = await client.query(`
                SELECT
                    COUNT(*) as total_coins,
                    COUNT(DISTINCT al.metal) as metals_count,
                    COUNT(DISTINCT al.category) as countries_count,
                    COUNT(DISTINCT al.year) as years_count,
                    SUM(uc.purchase_price) as total_investment
                FROM user_collections uc
                JOIN auction_lots al ON uc.coin_id = al.id
                WHERE uc.user_id = $1
            `, [userId]);

            const metalStats = await client.query(`
                SELECT al.metal, COUNT(*) as count
                FROM user_collections uc
                JOIN auction_lots al ON uc.coin_id = al.id
                WHERE uc.user_id = $1
                GROUP BY al.metal
                ORDER BY count DESC
            `, [userId]);

            const yearStats = await client.query(`
                SELECT al.year, COUNT(*) as count
                FROM user_collections uc
                JOIN auction_lots al ON uc.coin_id = al.id
                WHERE uc.user_id = $1 AND al.year IS NOT NULL
                GROUP BY al.year
                ORDER BY al.year DESC
                LIMIT 10
            `, [userId]);

            return {
                ...stats.rows[0],
                metals: metalStats.rows,
                recentYears: yearStats.rows
            };

        } catch (error) {
            console.error('❌ Ошибка получения статистики:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * «Проходы» лота по истории аукционов — продажи той же монеты в других
     * аукционах. Логика повторяет findSimilarLots прогнозного движка
     * (металл/категория + год + тип по описанию), но грейд НЕ фиксируется —
     * нам интересна вся ценовая история монеты по сохранностям.
     */
    async getCoinPasses(coinId, limit = 50) {
        const client = await this.pool.connect();
        try {
            const base = await client.query(
                `SELECT id, auction_number, coin_description, metal, year, category
                 FROM auction_lots WHERE id = $1`,
                [coinId]
            );
            if (base.rows.length === 0) throw new Error('Лот не найден');
            const lot = base.rows[0];

            const { extractDenominationAndCurrency, createDenominationSQLCondition } =
                require('./utils/denomination-extractor');
            const desc = lot.coin_description || '';
            const coinNameMatch = desc.match(/^(.+?)(?=\s*\d{4}г)/);
            const coinName = coinNameMatch ? coinNameMatch[1].trim() : null;
            const denominationData = coinName ? null : extractDenominationAndCurrency(desc);

            const hasMetal = lot.metal != null && String(lot.metal).trim() !== '';
            const hasYear = lot.year != null && String(lot.year).trim() !== '';
            const hasType = !!(coinName || denominationData);

            if (!hasYear && !hasType) {
                return { lot, passes: [] };
            }

            const runQuery = async (withTypeFilter) => {
                const params = [lot.id, lot.auction_number];
                let q = `
                    SELECT id, lot_number, auction_number, condition, winning_bid,
                           metal, year, weight, auction_end_date, coin_description
                    FROM auction_lots
                    WHERE winning_bid IS NOT NULL AND winning_bid > 0
                        AND id != $1 AND auction_number != $2`;
                if (hasMetal) { params.push(lot.metal); q += ` AND metal = $${params.length}`; }
                else { params.push(lot.category); q += ` AND category = $${params.length}`; }
                if (hasYear) { params.push(lot.year); q += ` AND year = $${params.length}`; }
                if (withTypeFilter) {
                    if (coinName) { params.push(`%${coinName}%`); q += ` AND coin_description ILIKE $${params.length}`; }
                    else if (denominationData) { q += createDenominationSQLCondition(denominationData, params); }
                }
                q += ` ORDER BY auction_end_date DESC NULLS LAST LIMIT ${limit}`;
                const r = await client.query(q, params);
                return r.rows;
            };

            let rows = await runQuery(true);
            if (rows.length < 2 && hasType) {
                const relaxed = await runQuery(false);
                if (relaxed.length > rows.length) rows = relaxed;
            }

            return { lot, passes: rows };

        } catch (error) {
            console.error('❌ Ошибка получения проходов:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    // Закрытие соединения
    async close() {
        await this.pool.end();
    }
}

module.exports = CollectionService;
