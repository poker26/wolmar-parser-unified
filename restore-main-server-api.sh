#!/bin/bash

# Скрипт для восстановления API endpoints в основном сервере
# Исправляет проблему "Ошибка загрузки аукционов"

echo "🔧 Восстановление API endpoints в основном сервере..."
echo "===================================================="

# Проверяем, что мы на сервере
if [ ! -f "/var/www/wolmar-parser/server.js" ]; then
    echo "❌ Ошибка: Скрипт должен запускаться на сервере в /var/www/wolmar-parser"
    exit 1
fi

cd /var/www/wolmar-parser

echo "📊 Текущий статус:"
git status
git branch --show-current

echo ""
echo "🔄 Переключение на основную ветку..."
git checkout catalog-parser --force
git pull origin catalog-parser

echo ""
echo "🔍 Проверяем API endpoints в server.js..."

# Проверяем, есть ли API endpoints для аукционов
if grep -q "/api/auctions" server.js; then
    echo "✅ API endpoints для аукционов найдены"
else
    echo "❌ API endpoints для аукционов отсутствуют"
    echo "🔄 Восстанавливаем из резервной копии..."
    
    if [ -f "server.js.backup" ]; then
        echo "📦 Восстанавливаем из server.js.backup..."
        cp server.js.backup server.js
        echo "✅ Файл восстановлен из резервной копии"
    else
        echo "❌ Резервная копия не найдена"
        echo "🔄 Создаем базовые API endpoints..."
        
        # Создаем временный файл с API endpoints
        cat > temp_api_endpoints.js << 'EOF'
// API endpoints для аукционов
app.get('/api/auctions', async (req, res) => {
    try {
        const query = `
            SELECT 
                auction_number,
                COUNT(*) as lots_count,
                MIN(auction_end_date) as start_date,
                MAX(auction_end_date) as end_date,
                SUM(winning_bid) as total_value,
                AVG(winning_bid) as avg_bid,
                MAX(winning_bid) as max_bid,
                MIN(winning_bid) as min_bid
            FROM auction_lots 
            WHERE auction_number IS NOT NULL
            GROUP BY auction_number
            ORDER BY auction_number DESC
        `;
        
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка получения аукционов:', error);
        res.status(500).json({ error: 'Ошибка получения данных об аукционах' });
    }
});

// Получить лоты конкретного аукциона
app.get('/api/auctions/:auctionNumber/lots', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        const { page = 1, limit = 20, search, metal, condition, year, minPrice, maxPrice } = req.query;
        
        const offset = (page - 1) * limit;
        let whereClause = 'WHERE auction_number = $1';
        const queryParams = [auctionNumber];
        let paramCount = 1;
        
        if (search) {
            paramCount++;
            whereClause += ` AND coin_description ILIKE $${paramCount}`;
            queryParams.push(`%${search}%`);
        }
        
        if (metal) {
            paramCount++;
            whereClause += ` AND metal = $${paramCount}`;
            queryParams.push(metal);
        }
        
        if (condition) {
            paramCount++;
            whereClause += ` AND condition = $${paramCount}`;
            queryParams.push(condition);
        }
        
        if (year) {
            paramCount++;
            whereClause += ` AND year = $${paramCount}`;
            queryParams.push(year);
        }
        
        if (minPrice) {
            paramCount++;
            whereClause += ` AND winning_bid >= $${paramCount}`;
            queryParams.push(parseFloat(minPrice));
        }
        
        if (maxPrice) {
            paramCount++;
            whereClause += ` AND winning_bid <= $${paramCount}`;
            queryParams.push(parseFloat(maxPrice));
        }
        
        const query = `
            SELECT 
                id, lot_number, coin_description, avers_image_url, revers_image_url,
                winner_login, winning_bid, auction_end_date, bids_count,
                metal, condition, year
            FROM auction_lots 
            ${whereClause}
            ORDER BY lot_number::int
            LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
        `;
        
        queryParams.push(parseInt(limit), offset);
        
        const result = await pool.query(query, queryParams);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка получения лотов:', error);
        res.status(500).json({ error: 'Ошибка получения данных о лотах' });
    }
});

// Получить детальную информацию о лоте
app.get('/api/lots/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const query = `
            SELECT 
                id, lot_number, auction_number, coin_description,
                avers_image_url, revers_image_url, winner_login,
                winning_bid, auction_end_date, bids_count,
                metal, condition, year
            FROM auction_lots 
            WHERE id = $1
        `;
        
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Лот не найден' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка получения лота:', error);
        res.status(500).json({ error: 'Ошибка получения данных о лоте' });
    }
});

// Получить статистику аукциона
app.get('/api/auctions/:auctionNumber/stats', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        const query = `
            SELECT 
                COUNT(*) as total_lots,
                SUM(winning_bid) as total_value,
                AVG(winning_bid) as avg_bid,
                MAX(winning_bid) as max_bid,
                MIN(winning_bid) as min_bid,
                COUNT(DISTINCT winner_login) as unique_winners,
                COUNT(DISTINCT metal) as unique_metals,
                COUNT(DISTINCT condition) as unique_conditions
            FROM auction_lots 
            WHERE auction_number = $1
        `;
        
        const result = await pool.query(query, [auctionNumber]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка получения статистики:', error);
        res.status(500).json({ error: 'Ошибка получения статистики аукциона' });
    }
});

// Получить доступные фильтры
app.get('/api/filters', async (req, res) => {
    try {
        const { auctionNumber } = req.query;
        let whereClause = '';
        const queryParams = [];
        
        if (auctionNumber) {
            whereClause = 'WHERE auction_number = $1';
            queryParams.push(auctionNumber);
        }
        
        const query = `
            SELECT 
                metal,
                condition,
                year
            FROM auction_lots 
            ${whereClause}
            GROUP BY metal, condition, year
            ORDER BY metal, condition, year
        `;
        
        const result = await pool.query(query, queryParams);
        
        const filters = {
            metals: [...new Set(result.rows.map(row => row.metal).filter(Boolean))],
            conditions: [...new Set(result.rows.map(row => row.condition).filter(Boolean))],
            years: [...new Set(result.rows.map(row => row.year).filter(Boolean))].sort()
        };
        
        res.json(filters);
    } catch (error) {
        console.error('Ошибка получения фильтров:', error);
        res.status(500).json({ error: 'Ошибка получения фильтров' });
    }
});
EOF
        
        echo "📝 Добавляем API endpoints в server.js..."
        # Добавляем API endpoints в server.js
        # Находим место для вставки (перед catch-all route)
        sed -i '/app.get('\''\*'\'',/i\
// API endpoints для аукционов\
' server.js
        
        # Вставляем содержимое temp файла
        sed -i '/\/\/ API endpoints для аукционов/r temp_api_endpoints.js' server.js
        
        # Удаляем временный файл
        rm temp_api_endpoints.js
        
        echo "✅ API endpoints добавлены в server.js"
    fi
fi

echo ""
echo "🔄 Перезапуск основного сервера..."
pm2 restart wolmar-parser

if [ $? -eq 0 ]; then
    echo "✅ Основной сервер перезапущен"
else
    echo "❌ Ошибка перезапуска основного сервера"
    exit 1
fi

echo ""
echo "🔍 Проверка работы API..."
sleep 3

curl -s http://localhost:3001/api/auctions > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ API аукционов работает"
else
    echo "❌ API аукционов не работает"
fi

echo ""
echo "✅ ВОССТАНОВЛЕНИЕ ЗАВЕРШЕНО!"
echo "🌐 Основной сервер: http://46.173.19.68:3001"
echo "📊 API аукционов: http://46.173.19.68:3001/api/auctions"
