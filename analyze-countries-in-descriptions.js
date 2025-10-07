#!/usr/bin/env node

const http = require('http');

async function analyzeCountriesInDescriptions() {
    console.log('🔍 Анализируем страны в описаниях монет...\n');
    
    try {
        // Получаем больше монет для анализа
        const response = await makeRequest('http://localhost:3000/api/catalog/coins?limit=100');
        
        if (response.status === 200) {
            const coins = response.data.coins;
            console.log(`📊 Анализируем ${coins.length} монет...\n`);
            
            // Собираем все уникальные слова из описаний
            const allWords = new Set();
            const countryCandidates = new Set();
            
            coins.forEach((coin, index) => {
                const description = coin.original_description || '';
                
                // Разбиваем на слова и собираем потенциальные страны
                const words = description.split(/[\s,\.\|]+/).filter(word => 
                    word.length > 2 && 
                    /[А-Яа-я]/.test(word) && 
                    !/^\d+$/.test(word)
                );
                
                words.forEach(word => {
                    allWords.add(word);
                    
                    // Ищем слова, которые могут быть странами
                    if (word.length > 3 && /^[А-Я]/.test(word)) {
                        countryCandidates.add(word);
                    }
                });
            });
            
            console.log('🌍 Потенциальные страны (слова с заглавной буквы):');
            const sortedCandidates = Array.from(countryCandidates).sort();
            sortedCandidates.forEach((country, index) => {
                console.log(`${index + 1}. ${country}`);
            });
            
            console.log(`\n📈 Статистика:`);
            console.log(`   Всего уникальных слов: ${allWords.size}`);
            console.log(`   Потенциальных стран: ${countryCandidates.size}`);
            
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
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
    });
}

analyzeCountriesInDescriptions();






