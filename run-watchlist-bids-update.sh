#!/bin/bash

echo "🔄 Запускаем обновление истории ставок для избранного..."
echo "📅 Время: $(date)"
echo ""

cd /var/www/wolmar-parser

# Проверяем аргументы
if [ $# -eq 0 ]; then
    echo "👥 Обновляем избранное для всех пользователей"
    node update-watchlist-bids.js
else
    echo "👤 Обновляем избранное для пользователя $1"
    node update-watchlist-bids.js $1
fi

echo ""
echo "🔍 Проверяем результаты..."
echo ""

# Проверяем количество ставок в БД
node -e "
const { Pool } = require('pg');
const config = require('./config');
const pool = new Pool(config.dbConfig);

async function checkResults() {
    try {
        // Общее количество ставок
        const totalBids = await pool.query('SELECT COUNT(*) as count FROM lot_bids');
        console.log(\`📊 Общее количество ставок в БД: \${totalBids.rows[0].count}\`);
        
        // Количество лотов с ставками
        const lotsWithBids = await pool.query('SELECT COUNT(DISTINCT lot_id) as count FROM lot_bids');
        console.log(\`📊 Количество лотов с историей ставок: \${lotsWithBids.rows[0].count}\`);
        
        // Ставки для лотов из избранного
        const watchlistBids = await pool.query(\`
            SELECT COUNT(*) as count
            FROM lot_bids lb
            JOIN watchlist w ON lb.lot_id = w.lot_id
        \`);
        console.log(\`📊 Ставок для лотов из избранного: \${watchlistBids.rows[0].count}\`);
        
        // Последние добавленные ставки
        const recentBids = await pool.query(\`
            SELECT lb.lot_id, lb.bid_amount, lb.bidder_login, lb.bid_timestamp, al.lot_number
            FROM lot_bids lb
            JOIN auction_lots al ON lb.lot_id = al.id
            ORDER BY lb.bid_timestamp DESC
            LIMIT 5
        \`);
        
        console.log('📊 Последние 5 ставок:');
        recentBids.rows.forEach((bid, index) => {
            console.log(\`   \${index + 1}. Лот \${bid.lot_number}: \${bid.bid_amount}₽ от \${bid.bidder_login} (\${bid.bid_timestamp})\`);
        });
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка проверки:', error.message);
        process.exit(1);
    }
}

checkResults();
"

echo ""
echo "🎉 Обновление завершено!"
