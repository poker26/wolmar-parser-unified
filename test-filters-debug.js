#!/usr/bin/env node

const http = require('http');

async function testFiltersDebug() {
    console.log('🔍 Отладка API фильтров...\n');
    
    try {
        const response = await makeRequest('http://localhost:3000/api/catalog/filters');
        console.log('   Статус:', response.status);
        
        const data = response.data;
        console.log('\n📊 Анализ данных:');
        console.log('   metals:', data.metals?.length || 0, 'элементов');
        console.log('   countries:', data.countries?.length || 0, 'элементов');
        console.log('   rarities:', data.rarities?.length || 0, 'элементов');
        console.log('   conditions:', data.conditions?.length || 0, 'элементов');
        
        console.log('\n🔍 Первые 5 элементов:');
        console.log('   metals:', data.metals?.slice(0, 5));
        console.log('   countries:', data.countries?.slice(0, 5));
        console.log('   rarities:', data.rarities?.slice(0, 5));
        console.log('   conditions:', data.conditions?.slice(0, 5));
        
        console.log('\n🔍 Null значения:');
        console.log('   countries null:', data.countries?.filter(x => x === null).length || 0);
        console.log('   rarities null:', data.rarities?.filter(x => x === null).length || 0);
        
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

testFiltersDebug();
