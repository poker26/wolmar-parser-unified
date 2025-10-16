#!/bin/bash

echo "🔧 Настройка таблицы watchlist для избранного..."
echo "📅 Время: $(date)"
echo ""

cd /var/www/wolmar-parser

echo "🚀 Запускаем создание таблицы watchlist..."
node create-watchlist-table.js

echo ""
echo "🔍 Проверяем результат..."
echo ""

# Проверяем, что таблица создана
node -e "
const { Pool } = require('pg');
const config = require('./config');
const pool = new Pool(config.dbConfig);

async function checkTable() {
    try {
        const result = await pool.query(\`
            SELECT COUNT(*) as count 
            FROM information_schema.tables 
            WHERE table_name = 'watchlist'
        \`);
        
        if (result.rows[0].count > 0) {
            console.log('✅ Таблица watchlist существует');
            
            // Проверяем количество записей
            const countResult = await pool.query('SELECT COUNT(*) as count FROM watchlist');
            console.log(\`📊 Количество записей в watchlist: \${countResult.rows[0].count}\`);
        } else {
            console.log('❌ Таблица watchlist не найдена');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка проверки:', error.message);
        process.exit(1);
    }
}

checkTable();
"

echo ""
echo "🎉 Настройка watchlist завершена!"
