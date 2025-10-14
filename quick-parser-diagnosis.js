const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function quickDiagnosis() {
    try {
        console.log('🔍 БЫСТРАЯ ДИАГНОСТИКА ПАРСЕРА');
        console.log('================================');
        
        // 1. Проверяем, есть ли процесс парсера
        console.log('\n1️⃣ ПРОВЕРЯЕМ ПРОЦЕССЫ:');
        const { exec } = require('child_process');
        
        exec('ps aux | grep node | grep -v grep', (error, stdout, stderr) => {
            if (stdout) {
                console.log('✅ Найдены процессы Node.js:');
                console.log(stdout);
            } else {
                console.log('❌ Процессы Node.js не найдены');
            }
        });
        
        // 2. Проверяем файлы прогресса
        console.log('\n2️⃣ ПРОВЕРЯЕМ ФАЙЛЫ ПРОГРЕССА:');
        const fs = require('fs');
        const path = require('path');
        
        const progressFiles = [
            'parser_progress_2099.json',
            'category-parser-2099.json',
            'logs/category-parser.log'
        ];
        
        progressFiles.forEach(file => {
            const fullPath = path.join(__dirname, file);
            if (fs.existsSync(fullPath)) {
                const stats = fs.statSync(fullPath);
                console.log(`✅ ${file} - существует (${stats.size} байт, ${stats.mtime})`);
                
                if (file.endsWith('.json')) {
                    try {
                        const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                        console.log(`   📊 Содержимое:`, JSON.stringify(content, null, 2));
                    } catch (e) {
                        console.log(`   ❌ Ошибка чтения JSON: ${e.message}`);
                    }
                } else if (file.endsWith('.log')) {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const lines = content.split('\n').filter(line => line.trim());
                    console.log(`   📋 Последние 5 строк лога:`);
                    lines.slice(-5).forEach(line => console.log(`      ${line}`));
                }
            } else {
                console.log(`❌ ${file} - не существует`);
            }
        });
        
        // 3. Проверяем записи в БД для аукциона 2099
        console.log('\n3️⃣ ПРОВЕРЯЕМ БД ДЛЯ АУКЦИОНА 2099:');
        const dbQuery = `
            SELECT 
                COUNT(*) as total_lots,
                COUNT(CASE WHEN parsed_at > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_lots,
                MAX(parsed_at) as last_parsed
            FROM auction_lots 
            WHERE auction_number = '2099';
        `;
        
        const dbResult = await pool.query(dbQuery);
        const row = dbResult.rows[0];
        
        console.log(`📊 Всего лотов в БД: ${row.total_lots}`);
        console.log(`🕐 Лотов за последний час: ${row.recent_lots}`);
        console.log(`📅 Последний парсинг: ${row.last_parsed || 'никогда'}`);
        
        // 4. Проверяем API endpoint
        console.log('\n4️⃣ ПРОВЕРЯЕМ API:');
        const http = require('http');
        
        const apiOptions = {
            hostname: 'localhost',
            port: 3001,
            path: '/api/admin/category-parser/status',
            method: 'GET'
        };
        
        const req = http.request(apiOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                console.log(`📡 API статус: ${res.statusCode}`);
                try {
                    const jsonData = JSON.parse(data);
                    console.log('📊 Ответ API:', JSON.stringify(jsonData, null, 2));
                } catch (e) {
                    console.log('❌ Ошибка парсинга API ответа:', data);
                }
            });
        });
        
        req.on('error', (error) => {
            console.log('❌ Ошибка API запроса:', error.message);
        });
        
        req.end();
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
    } finally {
        setTimeout(() => {
            pool.end();
        }, 2000);
    }
}

quickDiagnosis();
