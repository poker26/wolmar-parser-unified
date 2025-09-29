#!/usr/bin/env node

const http = require('http');

async function testYearFilterFixed() {
    console.log('🔍 Тестирование исправленного фильтра по годам...\n');
    
    try {
        // Тестируем базовый API
        console.log('1. Тестируем /api/catalog/coins (без фильтров):');
        const response1 = await makeRequest('http://localhost:3000/api/catalog/coins?limit=3');
        console.log('   Статус:', response1.status);
        console.log('   Количество записей:', response1.data.coins?.length || 0);
        if (response1.data.coins?.length > 0) {
            console.log('   Первая запись:', {
                id: response1.data.coins[0].id,
                denomination: response1.data.coins[0].denomination,
                year: response1.data.coins[0].year,
                original_description: response1.data.coins[0].original_description
            });
        }
        
        // Тестируем фильтр по годам (1900-1950)
        console.log('\n2. Тестируем фильтр по годам (1900-1950):');
        const response2 = await makeRequest('http://localhost:3000/api/catalog/coins?yearFrom=1900&yearTo=1950&limit=3');
        console.log('   Статус:', response2.status);
        console.log('   Количество записей:', response2.data.coins?.length || 0);
        if (response2.data.coins?.length > 0) {
            console.log('   Первая запись:', {
                id: response2.data.coins[0].id,
                denomination: response2.data.coins[0].denomination,
                year: response2.data.coins[0].year,
                original_description: response2.data.coins[0].original_description
            });
        }
        
        // Тестируем фильтр по годам (1800-1900)
        console.log('\n3. Тестируем фильтр по годам (1800-1900):');
        const response3 = await makeRequest('http://localhost:3000/api/catalog/coins?yearFrom=1800&yearTo=1900&limit=3');
        console.log('   Статус:', response3.status);
        console.log('   Количество записей:', response3.data.coins?.length || 0);
        if (response3.data.coins?.length > 0) {
            console.log('   Первая запись:', {
                id: response3.data.coins[0].id,
                denomination: response3.data.coins[0].denomination,
                year: response3.data.coins[0].year,
                original_description: response3.data.coins[0].original_description
            });
        }
        
        // Тестируем фильтр по годам (2000-2020)
        console.log('\n4. Тестируем фильтр по годам (2000-2020):');
        const response4 = await makeRequest('http://localhost:3000/api/catalog/coins?yearFrom=2000&yearTo=2020&limit=3');
        console.log('   Статус:', response4.status);
        console.log('   Количество записей:', response4.data.coins?.length || 0);
        if (response4.data.coins?.length > 0) {
            console.log('   Первая запись:', {
                id: response4.data.coins[0].id,
                denomination: response4.data.coins[0].denomination,
                year: response4.data.coins[0].year,
                original_description: response4.data.coins[0].original_description
            });
        }
        
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

testYearFilterFixed();
