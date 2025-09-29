#!/usr/bin/env node

const http = require('http');

async function checkDescriptionsViaAPI() {
    console.log('🔍 Анализируем описания через API...\n');
    
    try {
        // Получаем монеты через API
        const response = await makeRequest('http://localhost:3000/api/catalog/coins?limit=20');
        
        if (response.status === 200) {
            const coins = response.data.coins;
            console.log(`📊 Получено ${coins.length} монет:\n`);
            
            // Анализируем описания
            let russianCount = 0;
            let withCountryCount = 0;
            
            coins.forEach((coin, index) => {
                const description = coin.original_description || '';
                const isRussian = /рублей?|копеек?|руб\.?|коп\.?/i.test(description);
                const hasCountry = coin.country && coin.country !== null;
                
                if (isRussian) russianCount++;
                if (hasCountry) withCountryCount++;
                
                console.log(`${index + 1}. ID ${coin.id}: "${description}"`);
                console.log(`   Номинал: ${coin.denomination}, Страна: ${coin.country || 'не указана'}`);
                console.log(`   Российская: ${isRussian ? 'ДА' : 'НЕТ'}`);
                console.log('');
            });
            
            console.log(`📈 Статистика:`);
            console.log(`   Российских монет: ${russianCount}/${coins.length} (${((russianCount/coins.length)*100).toFixed(1)}%)`);
            console.log(`   С указанной страной: ${withCountryCount}/${coins.length} (${((withCountryCount/coins.length)*100).toFixed(1)}%)`);
            
        } else {
            console.error('❌ Ошибка API:', response.status);
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

checkDescriptionsViaAPI();
