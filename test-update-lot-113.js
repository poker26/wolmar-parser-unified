const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

// Функция для парсинга ставки одного лота (точная копия из server.js)
async function parseSingleLotBid(lotUrl) {
    const puppeteer = require('puppeteer-core');
    
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox',
            '--user-data-dir=/tmp/chrome-temp-9g8ln',
            '--disable-metrics',
            '--disable-metrics-reporting',
            '--disable-background-mode',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            '--disable-logging',
            '--disable-gpu-logging',
            '--disable-features=TranslateUI,BlinkGenPropertyTrees,VizDisplayCompositor']
    });
    
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        console.log(`📄 Загружаем лот: ${lotUrl}`);
        await page.goto(lotUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const lotData = await page.evaluate(() => {
            const data = {};
            
            // Номер лота - из заголовка h5
            const lotTitle = document.querySelector('h5');
            if (lotTitle) {
                const match = lotTitle.textContent.match(/Лот\s*№\s*(\d+)/i);
                if (match) {
                    data.lotNumber = parseInt(match[1]);
                }
            }
            
            // Информация о торгах
            const valuesDiv = document.querySelectorAll('.values')[1];
            if (valuesDiv) {
                const valuesText = valuesDiv.textContent;
                
                // Текущая ставка
                const bidMatch = valuesText.match(/Ставка:\s*(\d+(?:\s?\d+)*(?:[.,]\d+)?)\s*руб/i);
                if (bidMatch) {
                    data.winningBid = bidMatch[1].replace(/\s/g, '').replace(',', '.');
                }
                
                // Лидер
                const leaderMatch = valuesText.match(/Лидер:\s*([a-zA-Z0-9_А-Яа-я]+)/i);
                if (leaderMatch) {
                    data.winnerLogin = leaderMatch[1];
                }
            }
            
            return data;
        });
        
        console.log(`📊 Парсинг лота завершен:`, lotData);
        return lotData;
        
    } catch (error) {
        console.error('❌ Ошибка парсинга лота:', error);
        return null;
    } finally {
        await browser.close();
    }
}

async function testUpdateLot113() {
    try {
        // Получаем информацию о лоте
        const lotResult = await pool.query(`
            SELECT id, lot_number, auction_number, source_url, winning_bid, winner_login
            FROM auction_lots 
            WHERE lot_number = '113' AND auction_number = '970'
            LIMIT 1
        `);
        
        if (lotResult.rows.length === 0) {
            console.log('❌ Лот не найден');
            return;
        }
        
        const lot = lotResult.rows[0];
        console.log('📊 Текущие данные лота:', {
            id: lot.id,
            lot_number: lot.lot_number,
            auction_number: lot.auction_number,
            winning_bid: lot.winning_bid,
            winner_login: lot.winner_login,
            source_url: lot.source_url
        });
        
        // Парсим новые данные
        console.log('🔄 Парсим новые данные...');
        const bidData = await parseSingleLotBid(lot.source_url);
        
        if (bidData) {
            console.log('📊 Новые данные:', bidData);
            
            // Обновляем в базе данных
            const updateResult = await pool.query(`
                UPDATE auction_lots 
                SET winning_bid = $1, 
                    winner_login = $2
                WHERE id = $3
            `, [bidData.winningBid, bidData.winnerLogin, lot.id]);
            
            if (updateResult.rowCount > 0) {
                console.log('✅ Лот успешно обновлен!');
                
                // Проверяем обновленные данные
                const checkResult = await pool.query(`
                    SELECT winning_bid, winner_login
                    FROM auction_lots 
                    WHERE id = $1
                `, [lot.id]);
                
                console.log('📊 Обновленные данные:', checkResult.rows[0]);
            } else {
                console.log('❌ Не удалось обновить лот');
            }
        } else {
            console.log('❌ Не удалось получить новые данные');
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

testUpdateLot113();
