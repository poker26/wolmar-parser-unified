#!/bin/bash

# Быстрое восстановление основного сайта
# Возвращает все API эндпоинты которые были удалены

echo "🔧 БЫСТРОЕ ВОССТАНОВЛЕНИЕ ОСНОВНОГО САЙТА..."
echo "========================================="

cd /var/www/wolmar-parser

echo "📊 ЭТАП 1: Проверка текущего server.js..."
echo "======================================="

echo "📋 Поиск API эндпоинтов в server.js:"
grep -n "app.get.*api" server.js || echo "API эндпоинты не найдены"

echo ""
echo "📊 ЭТАП 2: Добавление отсутствующих API эндпоинтов..."
echo "================================================="

# Проверяем есть ли API эндпоинты
if ! grep -q "app.get.*api.*auctions" server.js; then
    echo "❌ API аукционов отсутствует - добавляем"
    
    # Создаем временный файл с API эндпоинтами
    cat > temp_api_endpoints.js << 'EOF'
// API эндпоинты для основного сайта
app.get('/api/auctions', async (req, res) => {
    try {
        console.log('📊 API: Запрос списка аукционов');
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
        console.log(`📊 API: Найдено ${result.rows.length} аукционов`);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ API: Ошибка получения аукционов:', error);
        res.status(500).json({ error: 'Ошибка получения данных об аукционах' });
    }
});

app.get('/api/auctions/:auctionNumber/lots', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        const { page = 1, limit = 20, search, metal, condition, year, minPrice, maxPrice } = req.query;
        
        console.log(`📊 API: Запрос лотов аукциона ${auctionNumber}`);
        
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
        console.log(`📊 API: Найдено ${result.rows.length} лотов для аукциона ${auctionNumber}`);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ API: Ошибка получения лотов:', error);
        res.status(500).json({ error: 'Ошибка получения данных о лотах' });
    }
});

app.get('/api/lots/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`📊 API: Запрос деталей лота ${id}`);
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
        console.error('❌ API: Ошибка получения лота:', error);
        res.status(500).json({ error: 'Ошибка получения данных о лоте' });
    }
});

app.get('/api/auctions/:auctionNumber/stats', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        console.log(`📊 API: Запрос статистики аукциона ${auctionNumber}`);
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
        console.error('❌ API: Ошибка получения статистики:', error);
        res.status(500).json({ error: 'Ошибка получения статистики аукциона' });
    }
});

app.get('/api/filters', async (req, res) => {
    try {
        const { auctionNumber } = req.query;
        console.log(`📊 API: Запрос фильтров для аукциона ${auctionNumber || 'всех'}`);
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
        console.error('❌ API: Ошибка получения фильтров:', error);
        res.status(500).json({ error: 'Ошибка получения фильтров' });
    }
});
EOF

    echo "✅ API эндпоинты созданы"
else
    echo "✅ API эндпоинты уже существуют"
fi

echo ""
echo "📊 ЭТАП 3: Проверка и добавление API в server.js..."
echo "================================================"

# Проверяем есть ли API эндпоинты в server.js
if ! grep -q "app.get.*api.*auctions" server.js; then
    echo "❌ API эндпоинты отсутствуют в server.js"
    
    # Создаем резервную копию
    cp server.js server.js.backup
    
    # Добавляем API эндпоинты перед catch-all route
    echo "📋 Добавление API эндпоинтов в server.js..."
    
    # Находим строку с catch-all route
    CATCH_ALL_LINE=$(grep -n "app.get('*'" server.js | head -1 | cut -d: -f1)
    
    if [ -n "$CATCH_ALL_LINE" ]; then
        echo "📋 Найдена catch-all route на строке $CATCH_ALL_LINE"
        
        # Создаем новый server.js с API эндпоинтами
        head -n $((CATCH_ALL_LINE - 1)) server.js > temp_server.js
        cat temp_api_endpoints.js >> temp_server.js
        tail -n +$CATCH_ALL_LINE server.js >> temp_server.js
        
        mv temp_server.js server.js
        echo "✅ API эндпоинты добавлены в server.js"
    else
        echo "❌ Catch-all route не найден"
    fi
else
    echo "✅ API эндпоинты уже существуют в server.js"
fi

echo ""
echo "📊 ЭТАП 4: Очистка временных файлов..."
echo "===================================="

rm -f temp_api_endpoints.js

echo "✅ Временные файлы удалены"

echo ""
echo "📊 ЭТАП 5: Проверка синтаксиса server.js..."
echo "======================================="

echo "📋 Проверка синтаксиса server.js:"
node -c server.js 2>&1

if [ $? -eq 0 ]; then
    echo "✅ server.js синтаксически корректен"
else
    echo "❌ Ошибка синтаксиса в server.js"
    echo "🔄 Восстановление из резервной копии..."
    cp server.js.backup server.js
    exit 1
fi

echo ""
echo "📊 ЭТАП 6: Перезапуск основного сайта..."
echo "====================================="

pm2 restart wolmar-parser

if [ $? -eq 0 ]; then
    echo "✅ Основной сайт перезапущен"
else
    echo "❌ Ошибка перезапуска основного сайта"
    exit 1
fi

echo ""
echo "⏳ ЭТАП 7: Ожидание запуска..."
echo "============================="

sleep 5

echo ""
echo "📊 ЭТАП 8: Проверка работы API..."
echo "=============================="

echo "🧪 Тестирование API аукционов:"
curl -s http://localhost:3001/api/auctions | jq '.[0:3]' 2>/dev/null || curl -s http://localhost:3001/api/auctions | head -20

echo ""
echo "🧪 Тестирование API фильтров:"
curl -s http://localhost:3001/api/filters | jq . 2>/dev/null || curl -s http://localhost:3001/api/filters

echo ""
echo "🌐 Тестирование внешнего доступа:"
curl -s http://46.173.19.68:3001/api/auctions | jq '.[0:3]' 2>/dev/null || curl -s http://46.173.19.68:3001/api/auctions | head -20

echo ""
echo "📋 Логи основного сайта:"
pm2 logs wolmar-parser --lines 10

echo ""
echo "✅ БЫСТРОЕ ВОССТАНОВЛЕНИЕ ОСНОВНОГО САЙТА ЗАВЕРШЕНО!"
echo "================================================="
echo "🌐 Основной сайт: http://46.173.19.68:3001"
echo "🌐 Каталог монет: http://46.173.19.68:3000"
echo "📊 Мониторинг: pm2 status"
echo "📋 Логи основного сайта: pm2 logs wolmar-parser"
