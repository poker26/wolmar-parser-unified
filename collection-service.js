const { Pool } = require('pg');
const config = require('./config');

class CollectionService {
    constructor() {
        this.pool = new Pool(config.dbConfig);
    }

    // Добавить монету в коллекцию
    async addToCollection(userId, coinId, notes = null, conditionRating = null, purchasePrice = null, purchaseDate = null) {
        const client = await this.pool.connect();
        
        try {
            // Проверяем, существует ли монета
            const coinCheck = await client.query(
                'SELECT id, coin_name FROM coin_catalog WHERE id = $1',
                [coinId]
            );

            if (coinCheck.rows.length === 0) {
                throw new Error('Монета не найдена в каталоге');
            }

            // Проверяем, не добавлена ли уже монета в коллекцию
            const existingCheck = await client.query(
                'SELECT id FROM user_collections WHERE user_id = $1 AND coin_id = $2',
                [userId, coinId]
            );

            if (existingCheck.rows.length > 0) {
                throw new Error('Монета уже добавлена в коллекцию');
            }

            // Добавляем монету в коллекцию
            const result = await client.query(`
                INSERT INTO user_collections (user_id, coin_id, notes, condition_rating, purchase_price, purchase_date)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, added_at
            `, [userId, coinId, notes, conditionRating, purchasePrice, purchaseDate]);

            const collection = result.rows[0];
            console.log(`✅ Монета ${coinCheck.rows[0].coin_name} добавлена в коллекцию пользователя ${userId}`);

            return {
                id: collection.id,
                coinId,
                addedAt: collection.added_at
            };

        } catch (error) {
            console.error('❌ Ошибка добавления в коллекцию:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    // Удалить монету из коллекции
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

            console.log(`✅ Монета удалена из коллекции пользователя ${userId}`);
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
            
            // Базовый запрос
            let query = `
                SELECT 
                    uc.id as collection_id,
                    uc.added_at,
                    uc.notes,
                    uc.condition_rating,
                    uc.purchase_price,
                    uc.purchase_date,
                    cc.id as coin_id,
                    cc.denomination,
                    cc.coin_name,
                    cc.year,
                    cc.metal,
                    cc.rarity,
                    cc.mint,
                    cc.mintage,
                    cc.condition,
                    cc.country,
                    cc.avers_image_url,
                    cc.revers_image_url,
                    cc.original_description
                FROM user_collections uc
                JOIN coin_catalog cc ON uc.coin_id = cc.id
                WHERE uc.user_id = $1
            `;

            const queryParams = [userId];
            let paramIndex = 2;

            // Добавляем фильтры
            if (filters.metal) {
                query += ` AND cc.metal = $${paramIndex}`;
                queryParams.push(filters.metal);
                paramIndex++;
            }

            if (filters.country) {
                query += ` AND cc.country = $${paramIndex}`;
                queryParams.push(filters.country);
                paramIndex++;
            }

            if (filters.yearFrom) {
                query += ` AND cc.year >= $${paramIndex}`;
                queryParams.push(filters.yearFrom);
                paramIndex++;
            }

            if (filters.yearTo) {
                query += ` AND cc.year <= $${paramIndex}`;
                queryParams.push(filters.yearTo);
                paramIndex++;
            }

            if (filters.search) {
                query += ` AND (cc.coin_name ILIKE $${paramIndex} OR cc.original_description ILIKE $${paramIndex})`;
                queryParams.push(`%${filters.search}%`);
                paramIndex++;
            }

            // Добавляем сортировку и пагинацию
            query += ` ORDER BY uc.added_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            queryParams.push(limit, offset);

            const result = await client.query(query, queryParams);

            // Получаем общее количество записей
            let countQuery = `
                SELECT COUNT(*) as total
                FROM user_collections uc
                JOIN coin_catalog cc ON uc.coin_id = cc.id
                WHERE uc.user_id = $1
            `;

            const countParams = [userId];
            let countParamIndex = 2;

            // Применяем те же фильтры для подсчета
            if (filters.metal) {
                countQuery += ` AND cc.metal = $${countParamIndex}`;
                countParams.push(filters.metal);
                countParamIndex++;
            }

            if (filters.country) {
                countQuery += ` AND cc.country = $${countParamIndex}`;
                countParams.push(filters.country);
                countParamIndex++;
            }

            if (filters.yearFrom) {
                countQuery += ` AND cc.year >= $${countParamIndex}`;
                countParams.push(filters.yearFrom);
                countParamIndex++;
            }

            if (filters.yearTo) {
                countQuery += ` AND cc.year <= $${countParamIndex}`;
                countParams.push(filters.yearTo);
                countParamIndex++;
            }

            if (filters.search) {
                countQuery += ` AND (cc.coin_name ILIKE $${countParamIndex} OR cc.original_description ILIKE $${countParamIndex})`;
                countParams.push(`%${filters.search}%`);
                countParamIndex++;
            }

            const countResult = await client.query(countQuery, countParams);
            const total = parseInt(countResult.rows[0].total);

            return {
                coins: result.rows,
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
            const allowedFields = ['notes', 'condition_rating', 'purchase_price', 'purchase_date'];
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
                RETURNING id, notes, condition_rating, purchase_price, purchase_date
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
                    COUNT(DISTINCT cc.metal) as metals_count,
                    COUNT(DISTINCT cc.country) as countries_count,
                    COUNT(DISTINCT cc.year) as years_count,
                    AVG(uc.condition_rating) as avg_condition,
                    SUM(uc.purchase_price) as total_investment
                FROM user_collections uc
                JOIN coin_catalog cc ON uc.coin_id = cc.id
                WHERE uc.user_id = $1
            `, [userId]);

            const metalStats = await client.query(`
                SELECT 
                    cc.metal,
                    COUNT(*) as count
                FROM user_collections uc
                JOIN coin_catalog cc ON uc.coin_id = cc.id
                WHERE uc.user_id = $1
                GROUP BY cc.metal
                ORDER BY count DESC
            `, [userId]);

            const yearStats = await client.query(`
                SELECT 
                    cc.year,
                    COUNT(*) as count
                FROM user_collections uc
                JOIN coin_catalog cc ON uc.coin_id = cc.id
                WHERE uc.user_id = $1 AND cc.year IS NOT NULL
                GROUP BY cc.year
                ORDER BY cc.year DESC
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

    // Закрытие соединения
    async close() {
        await this.pool.end();
    }
}

module.exports = CollectionService;
