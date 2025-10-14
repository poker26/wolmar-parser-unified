const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'wolmar_parser',
    password: 'postgres',
    port: 5432,
});

async function createCategoriesTable() {
    try {
        // Создаем таблицу для хранения категорий Wolmar
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS wolmar_categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                url_slug VARCHAR(255) NOT NULL UNIQUE,
                url_template VARCHAR(500) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        
        await pool.query(createTableQuery);
        console.log('✅ Таблица wolmar_categories создана');
        
        // Создаем индексы для быстрого поиска
        await pool.query('CREATE INDEX IF NOT EXISTS idx_wolmar_categories_name ON wolmar_categories(name)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_wolmar_categories_url_slug ON wolmar_categories(url_slug)');
        console.log('✅ Индексы созданы');
        
        // Добавляем функцию для обновления updated_at
        const updateTriggerQuery = `
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ language 'plpgsql';
            
            DROP TRIGGER IF EXISTS update_wolmar_categories_updated_at ON wolmar_categories;
            CREATE TRIGGER update_wolmar_categories_updated_at
                BEFORE UPDATE ON wolmar_categories
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();
        `;
        
        await pool.query(updateTriggerQuery);
        console.log('✅ Триггер для updated_at создан');
        
    } catch (error) {
        console.error('❌ Ошибка создания таблицы:', error);
    } finally {
        await pool.end();
    }
}

createCategoriesTable();