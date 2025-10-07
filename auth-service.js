const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const config = require('./config');

class AuthService {
    constructor() {
        this.pool = new Pool(config.dbConfig);
        this.jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
        this.jwtExpiresIn = '7d'; // 7 дней
    }

    // Хеширование пароля
    async hashPassword(password) {
        const saltRounds = 12;
        return await bcrypt.hash(password, saltRounds);
    }

    // Проверка пароля
    async verifyPassword(password, hash) {
        return await bcrypt.compare(password, hash);
    }

    // Генерация JWT токена
    generateToken(userId, username) {
        return jwt.sign(
            { 
                userId, 
                username,
                iat: Math.floor(Date.now() / 1000)
            },
            this.jwtSecret,
            { expiresIn: this.jwtExpiresIn }
        );
    }

    // Проверка JWT токена
    verifyToken(token) {
        try {
            return jwt.verify(token, this.jwtSecret);
        } catch (error) {
            throw new Error('Недействительный токен');
        }
    }

    // Регистрация пользователя
    async register(username, password, email = null, fullName = null) {
        const client = await this.pool.connect();
        
        try {
            // Проверяем, существует ли пользователь
            const existingUser = await client.query(
                'SELECT id FROM collection_users WHERE username = $1',
                [username]
            );

            if (existingUser.rows.length > 0) {
                throw new Error('Пользователь с таким именем уже существует');
            }

            // Хешируем пароль
            const passwordHash = await this.hashPassword(password);

            // Создаем пользователя
            const result = await client.query(`
                INSERT INTO collection_users (username, password_hash, email, full_name)
                VALUES ($1, $2, $3, $4)
                RETURNING id, username, email, full_name, created_at
            `, [username, passwordHash, email, fullName]);

            const user = result.rows[0];
            console.log(`✅ Пользователь ${username} зарегистрирован (ID: ${user.id})`);
            
            return {
                id: user.id,
                username: user.username,
                email: user.email,
                fullName: user.full_name,
                createdAt: user.created_at
            };

        } catch (error) {
            console.error('❌ Ошибка регистрации:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    // Авторизация пользователя
    async login(username, password) {
        const client = await this.pool.connect();
        
        try {
            // Находим пользователя по username
            const result = await client.query(`
                SELECT id, username, password_hash, email, full_name, is_active
                FROM collection_users 
                WHERE username = $1
            `, [username]);

            if (result.rows.length === 0) {
                throw new Error('Пользователь не найден');
            }

            const user = result.rows[0];

            if (!user.is_active) {
                throw new Error('Аккаунт заблокирован');
            }

            // Проверяем пароль
            const isValidPassword = await this.verifyPassword(password, user.password_hash);
            if (!isValidPassword) {
                throw new Error('Неверный пароль');
            }

            // Обновляем время последнего входа
            await client.query(
                'UPDATE collection_users SET last_login = NOW() WHERE id = $1',
                [user.id]
            );

            // Генерируем токен
            const token = this.generateToken(user.id, user.username);

            console.log(`✅ Пользователь ${username} авторизован (ID: ${user.id})`);

            return {
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    fullName: user.full_name
                }
            };

        } catch (error) {
            console.error('❌ Ошибка авторизации:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    // Проверка токена и получение пользователя
    async verifyUser(token) {
        try {
            const decoded = this.verifyToken(token);
        } catch (error) {
            return null;
        }

        const client = await this.pool.connect();
        
        try {
            const result = await client.query(`
                SELECT id, username, email, full_name, is_active
                FROM collection_users 
                WHERE id = $1 AND is_active = true
            `, [decoded.userId]);

            if (result.rows.length === 0) {
                return null;
            }

            return result.rows[0];

        } catch (error) {
            console.error('❌ Ошибка проверки токена:', error.message);
            return null;
        } finally {
            client.release();
        }
    }

    // Получение пользователя по ID
    async getUserById(userId) {
        const client = await this.pool.connect();
        
        try {
            const result = await client.query(`
                SELECT id, username, email, full_name, created_at, last_login
                FROM collection_users 
                WHERE id = $1 AND is_active = true
            `, [userId]);

            return result.rows[0] || null;

        } catch (error) {
            console.error('❌ Ошибка получения пользователя:', error.message);
            return null;
        } finally {
            client.release();
        }
    }

    // Обновление профиля пользователя
    async updateProfile(userId, updates) {
        const client = await this.pool.connect();
        
        try {
            const allowedFields = ['email', 'full_name'];
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

            values.push(userId);
            const query = `
                UPDATE collection_users 
                SET ${updateFields.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING id, username, email, full_name
            `;

            const result = await client.query(query, values);
            
            if (result.rows.length === 0) {
                throw new Error('Пользователь не найден');
            }

            console.log(`✅ Профиль пользователя ${userId} обновлен`);
            return result.rows[0];

        } catch (error) {
            console.error('❌ Ошибка обновления профиля:', error.message);
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

module.exports = AuthService;
