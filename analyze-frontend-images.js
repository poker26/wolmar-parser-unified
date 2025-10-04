const http = require('http');

async function analyzeFrontendImages() {
    console.log('🔍 Анализ фронтенда с неправильными изображениями:\n');
    
    try {
        // Получаем HTML страницы каталога
        const response = await fetch('http://46.173.19.68:3000');
        const html = await response.text();
        
        console.log('📄 HTML страницы получен');
        console.log(`📊 Размер HTML: ${html.length} символов`);
        
        // Ищем все img теги
        const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/g;
        const images = [];
        let match;
        
        while ((match = imgRegex.exec(html)) !== null) {
            images.push(match[1]);
        }
        
        console.log(`\n🖼️ Найдено изображений: ${images.length}`);
        
        images.forEach((src, index) => {
            console.log(`${index + 1}. ${src}`);
        });
        
        // Ищем API вызовы в JavaScript
        const apiRegex = /\/api\/catalog\/coins\/(\d+)\/image\/(avers|revers)/g;
        const apiCalls = [];
        
        while ((match = apiRegex.exec(html)) !== null) {
            apiCalls.push({
                id: match[1],
                type: match[2],
                url: match[0]
            });
        }
        
        console.log(`\n🔗 Найдено API вызовов: ${apiCalls.length}`);
        
        apiCalls.forEach((call, index) => {
            console.log(`${index + 1}. ID: ${call.id}, Тип: ${call.type}, URL: ${call.url}`);
        });
        
        // Проверим, есть ли проблемы с ID
        const uniqueIds = [...new Set(apiCalls.map(call => call.id))];
        console.log(`\n📊 Уникальных ID: ${uniqueIds.length}`);
        console.log(`ID: ${uniqueIds.join(', ')}`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }
}

analyzeFrontendImages();




