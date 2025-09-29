#!/usr/bin/env node

const http = require('http');

async function testServerYearFilter() {
    console.log('🔍 Тестирование фильтра по годам на сервере...\n');
    
    try {
        // Тестируем базовый API
        console.log('1. Тестируем /api/catalog/coins (без фильтров):');
        const response1 = await makeRequest('http://46.173.19.68:3000/api/catalog/coins?limit=5');
        console.log('   Статус:', response1.status);
        console.log('   Количество записей:', response1.data.coins?.length || 0);
        console.log('   Первая запись:', JSON.stringify(response1.data.coins?.[0], null, 2));
        
        // Тестируем фильтр по годам
        console.log('\n2. Тестируем фильтр по годам (1900-1950):');
        const response2 = await makeRequest('http://46.173.19.68:3000/api/catalog/coins?yearFrom=1900&yearTo=1950&limit=5');
        console.log('   Статус:', response2.status);
        console.log('   Количество записей:', response2.data.coins?.length || 0);
        console.log('   Первая запись:', JSON.stringify(response2.data.coins?.[0], null, 2));
        
        // Тестируем фильтр по годам (1800-1900)
        console.log('\n3. Тестируем фильтр по годам (1800-1900):');
        const response3 = await makeRequest('http://46.173.19.68:3000/api/catalog/coins?yearFrom=1800&yearTo=1900&limit=5');
        console.log('   Статус:', response3.status);
        console.log('   Количество записей:', response3.data.coins?.length || 0);
        console.log('   Первая запись:', JSON.stringify(response3.data.coins?.[0], null, 2));
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }
}

function makeRequest(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });
        
        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
    });
}

testServerYearFilter();
