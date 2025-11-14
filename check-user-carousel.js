const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkUserCarousel(login) {
    try {
        console.log(`\n🔍 Проверяем пользователя: ${login}\n`);
        
        // 1. Проверяем скоринг в winner_ratings
        const ratingQuery = `
            SELECT 
                winner_login,
                carousel_score,
                suspicious_score,
                linked_accounts_score,
                self_boost_score,
                decoy_tactics_score,
                pricing_strategies_score,
                circular_buyers_score,
                abandonment_score,
                technical_bidders_score,
                last_analysis_date
            FROM winner_ratings
            WHERE winner_login = $1
        `;
        
        const ratingResult = await pool.query(ratingQuery, [login]);
        
        if (ratingResult.rows.length === 0) {
            console.log('❌ Пользователь не найден в winner_ratings');
            return;
        }
        
        const user = ratingResult.rows[0];
        console.log('📊 Скоринг пользователя:');
        console.log(`   carousel_score: ${user.carousel_score || 0}`);
        console.log(`   suspicious_score: ${user.suspicious_score || 0}`);
        console.log(`   last_analysis_date: ${user.last_analysis_date || 'не указана'}`);
        console.log('');
        
        // 2. Находим все лоты, где пользователь был победителем
        const lotsQuery = `
            SELECT 
                al.id,
                al.auction_number,
                al.lot_number,
                al.coin_description,
                al.year,
                al.condition,
                al.winning_bid,
                al.auction_end_date
            FROM auction_lots al
            WHERE al.winner_login = $1
              AND al.winning_bid IS NOT NULL
              AND al.winning_bid > 0
              AND al.auction_end_date >= NOW() - INTERVAL '6 months'
            ORDER BY al.auction_end_date DESC
            LIMIT 50
        `;
        
        const lotsResult = await pool.query(lotsQuery, [login]);
        console.log(`📦 Найдено ${lotsResult.rows.length} лотов за последние 6 месяцев\n`);
        
        // 3. Группируем по монетам и ищем карусели
        const coinGroups = new Map();
        
        for (const lot of lotsResult.rows) {
            const key = `${lot.coin_description}|${lot.year}|${lot.condition}`;
            if (!coinGroups.has(key)) {
                coinGroups.set(key, []);
            }
            coinGroups.get(key).push(lot);
        }
        
        console.log(`🪙 Найдено ${coinGroups.size} уникальных монет\n`);
        
        // 4. Проверяем каждую монету на признаки карусели
        const carouselCoins = [];
        
        for (const [key, lots] of coinGroups) {
            if (lots.length < 2) continue; // Нужно минимум 2 продажи
            
            const [coin_description, year, condition] = key.split('|');
            const auctions = [...new Set(lots.map(l => l.auction_number))];
            const dates = lots.map(l => new Date(l.auction_end_date)).sort((a, b) => a - b);
            const prices = lots.map(l => parseFloat(l.winning_bid)).sort((a, b) => a - b);
            
            const firstSale = dates[0];
            const lastSale = dates[dates.length - 1];
            const timeSpanWeeks = (lastSale - firstSale) / (1000 * 60 * 60 * 24 * 7);
            
            // Проверяем признаки карусели
            let carouselScore = 0;
            let reasons = [];
            
            // Короткий период между продажами
            if (timeSpanWeeks < 4) {
                carouselScore += 25;
                reasons.push(`Короткий период: ${timeSpanWeeks.toFixed(1)} недель`);
            }
            
            // Рост цены
            if (prices.length > 1) {
                const firstPrice = prices[0];
                const lastPrice = prices[prices.length - 1];
                const priceGrowth = ((lastPrice - firstPrice) / firstPrice) * 100;
                
                if (priceGrowth > 50) {
                    carouselScore += 20;
                    reasons.push(`Рост цены: ${priceGrowth.toFixed(1)}%`);
                } else if (priceGrowth > 20) {
                    carouselScore += 10;
                    reasons.push(`Рост цены: ${priceGrowth.toFixed(1)}%`);
                }
            }
            
            // Количество аукционов
            if (auctions.length >= 4) {
                carouselScore += 25;
                reasons.push(`Много аукционов: ${auctions.length}`);
            } else if (auctions.length >= 3) {
                carouselScore += 15;
                reasons.push(`Несколько аукционов: ${auctions.length}`);
            }
            
            // Проверяем участников торгов
            const lotIds = lots.map(l => l.id);
            const biddersQuery = `
                SELECT DISTINCT lb.bidder_login
                FROM lot_bids lb
                WHERE lb.lot_id = ANY($1)
            `;
            const biddersResult = await pool.query(biddersQuery, [lotIds]);
            const uniqueBidders = biddersResult.rows.map(r => r.bidder_login);
            const participantsConcentration = uniqueBidders.length > 0 ? (uniqueBidders.length / auctions.length) : 1;
            const overlapRatio = participantsConcentration < 1 ? (1 - Math.min(1, participantsConcentration)) : 0;
            
            if (overlapRatio > 0.8) {
                carouselScore += 20;
                reasons.push(`Высокая концентрация участников: ${overlapRatio.toFixed(2)}`);
            } else if (overlapRatio > 0.6) {
                carouselScore += 10;
                reasons.push(`Средняя концентрация участников: ${overlapRatio.toFixed(2)}`);
            }
            
            let riskLevel = 'НОРМА';
            if (carouselScore >= 80) {
                riskLevel = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО';
            } else if (carouselScore >= 50) {
                riskLevel = 'ПОДОЗРИТЕЛЬНО';
            } else if (carouselScore >= 30) {
                riskLevel = 'ВНИМАНИЕ';
            }
            
            if (riskLevel !== 'НОРМА') {
                carouselCoins.push({
                    coin_description,
                    year,
                    condition,
                    sales_count: lots.length,
                    auctions_count: auctions.length,
                    carousel_score: carouselScore,
                    risk_level: riskLevel,
                    reasons,
                    lots: lots.map(l => ({
                        auction_number: l.auction_number,
                        lot_number: l.lot_number,
                        winning_bid: l.winning_bid,
                        auction_end_date: l.auction_end_date
                    }))
                });
            }
        }
        
        console.log(`\n🎠 Найдено ${carouselCoins.length} подозрительных каруселей для этого пользователя:\n`);
        
        for (const coin of carouselCoins) {
            console.log(`📌 ${coin.coin_description} ${coin.year} (${coin.condition})`);
            console.log(`   Продаж: ${coin.sales_count}, Аукционов: ${coin.auctions_count}`);
            console.log(`   Балл карусели: ${coin.carousel_score}, Уровень риска: ${coin.risk_level}`);
            console.log(`   Причины: ${coin.reasons.join(', ')}`);
            console.log(`   Лоты:`);
            coin.lots.forEach(lot => {
                console.log(`      - Аукцион ${lot.auction_number}, лот ${lot.lot_number}, ${lot.winning_bid}₽, ${new Date(lot.auction_end_date).toLocaleDateString('ru-RU')}`);
            });
            console.log('');
        }
        
        // 5. Проверяем, почему эти карусели не попадают в отчет
        console.log('\n🔍 Проверяем, почему эти карусели не попадают в отчет "Круговые покупки":\n');
        
        if (carouselCoins.length === 0) {
            console.log('⚠️  Не найдено каруселей с riskLevel !== "НОРМА"');
            console.log('   Возможные причины:');
            console.log('   1. Карусели были найдены ранее, но сейчас не проходят фильтры (min_sales, max_weeks, months)');
            console.log('   2. Скоринг был обновлен вручную или другим отчетом');
            console.log('   3. Данные изменились (новые лоты, удаленные лоты)');
        } else {
            console.log('✅ Найдены карусели, которые должны попадать в отчет');
            console.log('   Проверьте параметры отчета: min_sales, max_weeks, months');
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

// Запускаем проверку
const login = process.argv[2] || 'ursulus';
checkUserCarousel(login);

