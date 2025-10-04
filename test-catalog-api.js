#!/usr/bin/env node

const http = require('http');

async function testCatalogAPI() {
    console.log('🔍 Тестирование API каталога...\n');
    
    try {
        // Тестируем базовый API
        console.log('1. Тестируем /api/catalog/coins (без фильтров):');
        const response1 = await makeRequest('http://localhost:3000/api/catalog/coins');
        console.log('   Статус:', response1.status);
        console.log('   Данные:', JSON.stringify(response1.data, null, 2));
        
        // Тестируем фильтр по годам
        console.log('\n2. Тестируем фильтр по годам (1900-1950):');
        const response2 = await makeRequest('http://localhost:3000/api/catalog/coins?yearFrom=1900&yearTo=1950');
        console.log('   Статус:', response2.status);
        console.log('   Данные:', JSON.stringify(response2.data, null, 2));
        
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
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
    });
}

testCatalogAPI();




