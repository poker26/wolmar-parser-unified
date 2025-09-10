const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('./config');

class CatalogParser {
    constructor() {
        this.pool = new Pool(config.dbConfig);
        this.imagesDir = './catalog-images';
        this.ensureImagesDirectory();
    }

    async init() {
        try {
            await this.testDatabaseConnection();
            await this.createTables();
            console.log('✅ Каталог-парсер инициализирован');
        } catch (error) {
            console.error('❌ Ошибка инициализации:', error);
            throw error;
        }
    }

    async testDatabaseConnection() {
        try {
            const client = await this.pool.connect();
            await client.query('SELECT NOW()');
            client.release();
            console.log('✅ Подключение к базе данных установлено');
        } catch (error) {
            console.error('❌ Ошибка подключения к базе данных:', error);
            throw error;
        }
    }

    async createTables() {
        const client = await this.pool.connect();
        
        try {
            // Таблица каталога монет
            await client.query(`
                CREATE TABLE IF NOT EXISTS coin_catalog (
                    id SERIAL PRIMARY KEY,
                    lot_id INTEGER REFERENCES auction_lots(id),
                    auction_number INTEGER,
                    lot_number VARCHAR(50),
                    
                    -- Основная информация
                    denomination VARCHAR(100),           -- Номинал (если нет, то 1)
                    coin_name VARCHAR(500),             -- Название монеты
                    year INTEGER,                       -- Год выпуска
                    metal VARCHAR(20),                  -- Металл (Ag, Au, Cu, etc.)
                    rarity VARCHAR(10),                 -- Редкость (R, RR, RRR)
                    
                    -- Дополнительная информация
                    mint VARCHAR(200),                  -- Монетный двор
                    mintage INTEGER,                    -- Тираж
                    condition VARCHAR(100),             -- Состояние
                    
                    -- Каталоги
                    bitkin_info TEXT,                   -- Информация из каталога Биткина
                    uzdenikov_info TEXT,                -- Информация из каталога Узденикова
                    ilyin_info TEXT,                    -- Информация из каталога Ильина
                    petrov_info TEXT,                   -- Информация из каталога Петрова
                    severin_info TEXT,                  -- Информация из каталога Северина
                    dyakov_info TEXT,                   -- Информация из каталога Дьякова
                    kazakov_info TEXT,                  -- Информация из каталога Казакова
                    
                    -- Изображения
                    avers_image_path VARCHAR(500),      -- Путь к изображению аверса
                    revers_image_path VARCHAR(500),     -- Путь к изображению реверса
                    avers_image_url VARCHAR(500),       -- URL изображения аверса
                    revers_image_url VARCHAR(500),      -- URL изображения реверса
                    
                    -- Метаданные
                    original_description TEXT,          -- Оригинальное описание
                    parsed_at TIMESTAMP DEFAULT NOW(),
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);

            // Индексы для быстрого поиска
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_catalog_auction_lot 
                ON coin_catalog(auction_number, lot_number)
            `);
            
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_catalog_denomination 
                ON coin_catalog(denomination)
            `);
            
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_catalog_year 
                ON coin_catalog(year)
            `);
            
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_catalog_metal 
                ON coin_catalog(metal)
            `);
            
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_catalog_rarity
                ON coin_catalog(rarity)
            `);
            
            // Добавляем колонку kazakov_info если её нет
            try {
                await client.query(`
                    ALTER TABLE coin_catalog 
                    ADD COLUMN IF NOT EXISTS kazakov_info TEXT
                `);
                console.log('✅ Колонка kazakov_info добавлена');
            } catch (error) {
                console.log('ℹ️ Колонка kazakov_info уже существует или ошибка:', error.message);
            }
            
            // Добавляем колонки для хранения изображений в базе данных
            try {
                await client.query(`
                    ALTER TABLE coin_catalog 
                    ADD COLUMN IF NOT EXISTS avers_image_data BYTEA
                `);
                console.log('✅ Колонка avers_image_data добавлена');
            } catch (error) {
                console.log('ℹ️ Колонка avers_image_data уже существует или ошибка:', error.message);
            }
            
            try {
                await client.query(`
                    ALTER TABLE coin_catalog 
                    ADD COLUMN IF NOT EXISTS revers_image_data BYTEA
                `);
                console.log('✅ Колонка revers_image_data добавлена');
            } catch (error) {
                console.log('ℹ️ Колонка revers_image_data уже существует или ошибка:', error.message);
            }
            
            // Создаем уникальное ограничение для (auction_number, lot_number)
            try {
                await client.query(`
                    ALTER TABLE coin_catalog 
                    ADD CONSTRAINT coin_catalog_auction_lot_unique 
                    UNIQUE (auction_number, lot_number)
                `);
                console.log('✅ Уникальное ограничение для (auction_number, lot_number) создано');
            } catch (error) {
                console.log('ℹ️ Уникальное ограничение уже существует или ошибка:', error.message);
            }

            console.log('✅ Таблицы каталога созданы');
        } finally {
            client.release();
        }
    }

    ensureImagesDirectory() {
        if (!fs.existsSync(this.imagesDir)) {
            fs.mkdirSync(this.imagesDir, { recursive: true });
            console.log('✅ Директория для изображений создана:', this.imagesDir);
        }
    }

    // Парсер названия лота
    parseLotDescription(description) {
        const result = {
            denomination: '1',
            coin_name: '',
            year: null,
            metal: '',
            rarity: '',
            mint: '',
            mintage: null,
            condition: '',
            bitkin_info: '',
            uzdenikov_info: '',
            ilyin_info: '',
            petrov_info: '',
            severin_info: '',
            dyakov_info: '',
            kazakov_info: ''
        };

        try {
            // Извлекаем номинал (число в начале)
            const denominationMatch = description.match(/^(\d+(?:\.\d+)?)\s+/);
            if (denominationMatch) {
                result.denomination = denominationMatch[1];
            } else {
                // Если нет числового номинала, устанавливаем "1"
                result.denomination = "1";
            }

            // Извлекаем год
            const yearMatch = description.match(/(\d{4})г?\./);
            if (yearMatch) {
                result.year = parseInt(yearMatch[1]);
            }

            // Извлекаем металл
            const metalMatch = description.match(/\b(Ag|Au|Cu|Br|Ni|Fe|Pb|Sn|Zn|Pt|Pd)\b/);
            if (metalMatch) {
                result.metal = metalMatch[1];
            }

            // Извлекаем редкость
            const rarityMatch = description.match(/\b(R{1,3})\b/);
            if (rarityMatch) {
                result.rarity = rarityMatch[1];
            }

            // Извлекаем название монеты
            let nameMatch = description.match(/^\d+(?:\.\d+)?\s+(.+?)\s+\d{4}г?\./);
            if (nameMatch) {
                result.coin_name = nameMatch[1].trim();
            } else {
                // Если нет числового номинала, ищем название до года
                nameMatch = description.match(/^([А-Яа-я\w\s]+?)\s+\d{4}г?\./);
                if (nameMatch) {
                    result.coin_name = nameMatch[1].trim();
                }
            }

            // Извлекаем монетный двор
            const mintMatch = description.match(/([А-Яа-я\s]+монетный\s+двор)/i);
            if (mintMatch) {
                result.mint = mintMatch[1].trim();
            }

            // Извлекаем тираж
            const mintageMatch = description.match(/тираж\s+([\d\s,]+)/i);
            if (mintageMatch) {
                result.mintage = parseInt(mintageMatch[1].replace(/[\s,]/g, ''));
            }

            // Извлекаем информацию из каталогов
            this.extractCatalogInfo(description, result);

            // Извлекаем состояние
            const conditionMatch = description.match(/(отличной|хорошей|удовлетворительной|плохой)\s+кондиции/i);
            if (conditionMatch) {
                result.condition = conditionMatch[1] + ' кондиции';
            }

        } catch (error) {
            console.error('Ошибка парсинга описания:', error);
        }

        return result;
    }

    extractCatalogInfo(description, result) {
        // Биткин - более точное извлечение
        const bitkinMatch = description.match(/Биткин[^,]*?([^,]+?)(?=,|$|Уздеников|Ильин|Петров|Северин|Дьяков)/);
        if (bitkinMatch) {
            result.bitkin_info = bitkinMatch[1].trim();
        }

        // Уздеников (включая опечатки)
        const uzdenikovMatch = description.match(/Узден[иі]ков[^,]*?([^,]+?)(?=,|$|Биткин|Ильин|Петров|Северин|Дьяков|Казаков)/);
        if (uzdenikovMatch) {
            result.uzdenikov_info = uzdenikovMatch[1].trim();
        }

        // Ильин
        const ilyinMatch = description.match(/Ильин[^,]*?([^,]+?)(?=,|$|Биткин|Уздеников|Петров|Северин|Дьяков)/);
        if (ilyinMatch) {
            result.ilyin_info = ilyinMatch[1].trim();
        }

        // Петров
        const petrovMatch = description.match(/Петров[^,]*?([^,]+?)(?=,|$|Биткин|Уздеников|Ильин|Северин|Дьяков)/);
        if (petrovMatch) {
            result.petrov_info = petrovMatch[1].trim();
        }

        // Северин
        const severinMatch = description.match(/Северин[^,]*?([^,]+?)(?=,|$|Биткин|Уздеников|Ильин|Петров|Дьяков)/);
        if (severinMatch) {
            result.severin_info = severinMatch[1].trim();
        }

        // Дьяков
        const dyakovMatch = description.match(/Дьяков[^,]*?([^,]+?)(?=,|$|Биткин|Уздеников|Ильин|Петров|Северин|Казаков)/);
        if (dyakovMatch) {
            result.dyakov_info = dyakovMatch[1].trim();
        }

        // Казаков
        const kazakovMatch = description.match(/Казаков[^,]*?([^,]+?)(?=,|$|Биткин|Уздеников|Ильин|Петров|Северин|Дьяков)/);
        if (kazakovMatch) {
            result.kazakov_info = kazakovMatch[1].trim();
        }
    }

    // Загрузка изображения
    async downloadImage(url) {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;
            
            protocol.get(url, (response) => {
                if (response.statusCode === 200) {
                    const chunks = [];
                    response.on('data', (chunk) => {
                        chunks.push(chunk);
                    });
                    
                    response.on('end', () => {
                        const imageData = Buffer.concat(chunks);
                        console.log(`✅ Изображение загружено: ${url} (${imageData.length} байт)`);
                        resolve(imageData);
                    });
                    
                    response.on('error', (err) => {
                        reject(err);
                    });
                } else {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                }
            }).on('error', (err) => {
                reject(err);
            });
        });
    }

    // Обработка одного лота
    async processLot(lot) {
        try {
            console.log(`Обработка лота ${lot.auction_number}-${lot.lot_number}: ${lot.coin_description.substring(0, 100)}...`);
            
            // Парсим описание
            const parsedData = this.parseLotDescription(lot.coin_description);
            
            // Загружаем изображения
            let aversImageData = null;
            let reversImageData = null;
            
            if (lot.avers_image_url) {
                try {
                    aversImageData = await this.downloadImage(lot.avers_image_url);
                } catch (error) {
                    console.warn(`Не удалось загрузить аверс для лота ${lot.auction_number}-${lot.lot_number}:`, error.message);
                }
            }
            
            if (lot.revers_image_url) {
                try {
                    reversImageData = await this.downloadImage(lot.revers_image_url);
                } catch (error) {
                    console.warn(`Не удалось загрузить реверс для лота ${lot.auction_number}-${lot.lot_number}:`, error.message);
                }
            }
            
            // Сохраняем в базу данных
            await this.saveToCatalog(lot, parsedData, aversImageData, reversImageData);
            
            console.log(`✅ Лот ${lot.auction_number}-${lot.lot_number} обработан`);
            
        } catch (error) {
            console.error(`❌ Ошибка обработки лота ${lot.auction_number}-${lot.lot_number}:`, error);
        }
    }

    // Сохранение в каталог
    async saveToCatalog(lot, parsedData, aversImageData, reversImageData) {
        const client = await this.pool.connect();
        
        try {
            // Проверяем, существует ли уже монета с такими же номиналом, названием и металлом
            const checkQuery = `
                SELECT id, year FROM coin_catalog 
                WHERE denomination = $1 
                AND coin_name = $2 
                AND metal = $3
            `;
            
            const checkResult = await client.query(checkQuery, [
                parsedData.denomination,
                parsedData.coin_name,
                parsedData.metal
            ]);
            
            if (checkResult.rows.length > 0) {
                // Монета уже существует, обновляем информацию о годах
                const existingCoin = checkResult.rows[0];
                console.log(`ℹ️ Монета ${parsedData.denomination} ${parsedData.coin_name} (${parsedData.metal}) уже существует. Год ${existingCoin.year} -> ${parsedData.year}`);
                
                // Обновляем год, если новый год больше (более поздний)
                if (parsedData.year && parsedData.year > existingCoin.year) {
                    const updateQuery = `
                        UPDATE coin_catalog 
                        SET year = $1, parsed_at = NOW()
                        WHERE id = $2
                    `;
                    await client.query(updateQuery, [parsedData.year, existingCoin.id]);
                    console.log(`✅ Обновлен год для монеты ${parsedData.denomination} ${parsedData.coin_name} на ${parsedData.year}`);
                }
                return; // Не создаем новую запись
            }
            
            // Монеты нет, создаем новую запись
            const insertQuery = `
                INSERT INTO coin_catalog (
                    lot_id, auction_number, lot_number,
                    denomination, coin_name, year, metal, rarity,
                    mint, mintage, condition,
                    bitkin_info, uzdenikov_info, ilyin_info, 
                    petrov_info, severin_info, dyakov_info, kazakov_info,
                    avers_image_path, revers_image_path,
                    avers_image_url, revers_image_url,
                    avers_image_data, revers_image_data,
                    original_description
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 
                    $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
                )
            `;
            
            await client.query(insertQuery, [
                parseInt(lot.id),
                parseInt(lot.auction_number),
                lot.lot_number,
                parsedData.denomination,
                parsedData.coin_name,
                parsedData.year,
                parsedData.metal,
                parsedData.rarity,
                parsedData.mint,
                parsedData.mintage,
                parsedData.condition,
                parsedData.bitkin_info,
                parsedData.uzdenikov_info,
                parsedData.ilyin_info,
                parsedData.petrov_info,
                parsedData.severin_info,
                parsedData.dyakov_info,
                parsedData.kazakov_info,
                null, // avers_image_path (больше не используем)
                null, // revers_image_path (больше не используем)
                lot.avers_image_url,
                lot.revers_image_url,
                aversImageData,
                reversImageData,
                lot.coin_description
            ]);
            
            console.log(`✅ Создана новая запись: ${parsedData.denomination} ${parsedData.coin_name} (${parsedData.metal}) ${parsedData.year}г.`);
            
        } finally {
            client.release();
        }
    }

    // Обработка всех лотов
    async processAllLots() {
        // Очистка базы данных для отладки
        console.log('🧹 Очистка базы данных для отладки...');
        const client = await this.pool.connect();
        try {
            await client.query('DELETE FROM coin_catalog');
            console.log('✅ База данных очищена');
        } finally {
            client.release();
        }
        
        const client2 = await this.pool.connect();
        
        try {
            const result = await client2.query(`
                SELECT id, auction_number, lot_number, coin_description, 
                       avers_image_url, revers_image_url
                FROM auction_lots 
                WHERE coin_description IS NOT NULL 
                AND coin_description != ''
                ORDER BY auction_number, lot_number
            `);
            
            console.log(`Найдено ${result.rows.length} лотов для обработки`);
            
            for (const lot of result.rows) {
                await this.processLot(lot);
                // Небольшая пауза между запросами
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            console.log('✅ Все лоты обработаны');
            
        } finally {
            client2.release();
        }
    }

    // Тестирование парсера
    testParser() {
        const testDescription = "Альбертусталер 1753г. Ag. RR, Ильин - 15 рублей, Петров - 30 рублей | В слабе NRG. Привлекательный экземпляр в отличной кондиции, редкость на рынке. Мангеймский монетный двор. Биткин редкость - R1, №# 628.61, тираж 1 043, Уздеников редкость - \"точка с чертой\", №# 4922, Ильин - 15 рублей, Петров - 30 рублей, Северин - \"черта\" # 1890, Дьяков# 46 (R1)";
        
        console.log('Тестирование парсера:');
        console.log('Исходное описание:', testDescription);
        console.log('Результат парсинга:', JSON.stringify(this.parseLotDescription(testDescription), null, 2));
    }

    async close() {
        await this.pool.end();
    }
}

// Запуск парсера
async function main() {
    const parser = new CatalogParser();
    
    try {
        await parser.init();
        
        // Тестируем парсер
        parser.testParser();
        
        // Обрабатываем все лоты
        await parser.processAllLots();
        
    } catch (error) {
        console.error('Ошибка:', error);
    } finally {
        await parser.close();
    }
}

if (require.main === module) {
    main();
}

module.exports = CatalogParser;
