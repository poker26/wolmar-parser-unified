#!/usr/bin/env node

const http = require('http');

async function testFiltersAPI() {
    console.log('🔍 Тестирование API фильтров...\n');
    
    try {
        const response = await makeRequest('http://localhost:3000/api/catalog/filters');
        console.log('   Статус:', response.status);
        console.log('   Данные:', JSON.stringify(response.data, null, 2));
        
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

testFiltersAPI();
