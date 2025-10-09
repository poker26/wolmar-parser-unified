const puppeteer = require('puppeteer-core');

async function testSingleLotParsing() {
    const lotUrl = 'https://www.wolmar.ru/auction/2137/7590959?page=3';
    
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        console.log(`📄 Загружаем лот: ${lotUrl}`);
        await page.goto(lotUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Получаем весь HTML для анализа
        const html = await page.content();
        console.log('📄 HTML загружен, длина:', html.length);
        
        // Ищем все элементы с классом .values
        const valuesElements = await page.$$('.values');
        console.log(`📊 Найдено элементов .values: ${valuesElements.length}`);
        
        for (let i = 0; i < valuesElements.length; i++) {
            const text = await valuesElements[i].evaluate(el => el.textContent);
            console.log(`📊 .values[${i}]:`, text);
        }
        
        // Парсим данные как в оригинальной функции
        const lotData = await page.evaluate(() => {
            const data = {};
            
            // Номер лота - из заголовка h5
            const lotTitle = document.querySelector('h5');
            if (lotTitle) {
                console.log('📄 Заголовок h5:', lotTitle.textContent);
                const match = lotTitle.textContent.match(/Лот\s*№\s*(\d+)/i);
                if (match) {
                    data.lotNumber = parseInt(match[1]);
                }
            }
            
            // Информация о торгах
            const valuesDiv = document.querySelectorAll('.values')[1];
            if (valuesDiv) {
                const valuesText = valuesDiv.textContent;
                console.log('📊 Текст .values[1]:', valuesText);
                
                // Текущая ставка
                const bidMatch = valuesText.match(/Ставка:\s*(\d+(?:\s?\d+)*(?:[.,]\d+)?)\s*руб/i);
                if (bidMatch) {
                    data.winningBid = bidMatch[1].replace(/\s/g, '').replace(',', '.');
                    console.log('📊 Найдена ставка:', bidMatch[1], '->', data.winningBid);
                } else {
                    console.log('❌ Ставка не найдена в тексте:', valuesText);
                }
                
                // Лидер
                const leaderMatch = valuesText.match(/Лидер:\s*([a-zA-Z0-9_А-Яа-я]+)/i);
                if (leaderMatch) {
                    data.winnerLogin = leaderMatch[1];
                    console.log('📊 Найден лидер:', data.winnerLogin);
                }
            } else {
                console.log('❌ Элемент .values[1] не найден');
            }
            
            return data;
        });
        
        console.log('📊 Результат парсинга:', lotData);
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await browser.close();
    }
}

testSingleLotParsing();
