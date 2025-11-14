const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkCircularBuyersUser(login) {
    try {
        console.log(`\n🔍 Проверяем пользователя в отчете "Круговые покупки": ${login}\n`);
        
        // 1. Проверяем скоринг в winner_ratings
        const ratingQuery = `
            SELECT 
                winner_login,
                circular_buyers_score,
                carousel_score,
                suspicious_score,
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
        console.log(`   circular_buyers_score: ${user.circular_buyers_score || 0}`);
        console.log(`   carousel_score: ${user.carousel_score || 0}`);
        console.log(`   suspicious_score: ${user.suspicious_score || 0}`);
        console.log(`   last_analysis_date: ${user.last_analysis_date || 'не указана'}`);
        console.log('');
        
        // 2. Сначала показываем все покупки пользователя для понимания паттерна
        const allPurchasesQuery = `
            SELECT 
                al.coin_description,
                al.year,
                al.condition,
                al.auction_number,
                al.lot_number,
                al.winning_bid,
                al.auction_end_date,
                al.bids_count
            FROM auction_lots al
            WHERE al.winner_login = $1
              AND al.winner_login IS NOT NULL
              AND al.winning_bid IS NOT NULL
              AND al.winning_bid > 0
            ORDER BY al.auction_end_date DESC
            LIMIT 50
        `;
        
        const allPurchasesResult = await pool.query(allPurchasesQuery, [login]);
        console.log(`📦 Всего покупок пользователя (последние 50): ${allPurchasesResult.rows.length}\n`);
        
        if (allPurchasesResult.rows.length > 0) {
            console.log('📋 Последние покупки:');
            allPurchasesResult.rows.slice(0, 10).forEach((lot, idx) => {
                console.log(`   ${idx + 1}. ${lot.coin_description} ${lot.year} (${lot.condition}) - ${lot.winning_bid}₽, ${new Date(lot.auction_end_date).toLocaleDateString('ru-RU')}, Аукцион ${lot.auction_number}`);
            });
            if (allPurchasesResult.rows.length > 10) {
                console.log(`   ... и еще ${allPurchasesResult.rows.length - 10} покупок`);
            }
            console.log('');
            
            // Группируем по монетам
            const coinGroups = new Map();
            allPurchasesResult.rows.forEach(lot => {
                const key = `${lot.coin_description}|${lot.year}|${lot.condition}`;
                if (!coinGroups.has(key)) {
                    coinGroups.set(key, []);
                }
                coinGroups.get(key).push(lot);
            });
            
            console.log(`🪙 Уникальных монет: ${coinGroups.size}`);
            console.log('📊 Монеты с несколькими покупками:');
            let hasMultiple = false;
            for (const [key, lots] of coinGroups) {
                if (lots.length >= 2) {
                    hasMultiple = true;
                    const [coin_description, year, condition] = key.split('|');
                    const dates = lots.map(l => new Date(l.auction_end_date)).sort((a, b) => a - b);
                    const firstDate = dates[0];
                    const lastDate = dates[dates.length - 1];
                    const monthsDiff = (lastDate - firstDate) / (1000 * 60 * 60 * 24 * 30);
                    console.log(`   - ${coin_description} ${year} (${condition}): ${lots.length} покупок, период ${monthsDiff.toFixed(1)} месяцев`);
                }
            }
            if (!hasMultiple) {
                console.log('   (нет монет с несколькими покупками)');
            }
            console.log('');
        }
        
        // 3. Находим все покупки одинаковых монет за разные периоды
        const periods = [6, 12, 24, 36];
        const minPurchases = 3;
        
        for (const months of periods) {
            const circularQuery = `
            SELECT 
                al.winner_login,
                al.coin_description,
                al.year,
                al.condition,
                COUNT(*) as purchase_count,
                AVG(al.winning_bid) as avg_price,
                MIN(al.winning_bid) as min_price,
                MAX(al.winning_bid) as max_price,
                STDDEV(al.winning_bid) / NULLIF(AVG(al.winning_bid), 0) * 100 as price_variance_pct,
                AVG(al.bids_count) as avg_competition,
                EXTRACT(DAYS FROM MAX(al.auction_end_date) - MIN(al.auction_end_date)) / 7 as weeks_span,
                STRING_AGG(DISTINCT al.auction_number::text, ', ' ORDER BY al.auction_number::text) as auctions,
                MIN(al.auction_end_date) as first_purchase,
                MAX(al.auction_end_date) as last_purchase
            FROM auction_lots al
            WHERE al.winner_login = $1
              AND al.winner_login IS NOT NULL
              AND al.winning_bid IS NOT NULL
              AND al.winning_bid > 0
              AND al.auction_end_date >= NOW() - INTERVAL '${months} months'
            GROUP BY al.winner_login, al.coin_description, al.year, al.condition
            HAVING COUNT(*) >= $2
            ORDER BY COUNT(*) DESC, AVG(al.winning_bid) DESC
        `;
        
            const circularResult = await pool.query(circularQuery, [login, minPurchases]);
            
            if (circularResult.rows.length > 0) {
                console.log(`\n✅ За период ${months} месяцев найдено ${circularResult.rows.length} случаев повторных покупок (минимум ${minPurchases} покупок)\n`);
                
                // Вычисляем suspicion_score для каждого случая
                for (const row of circularResult.rows) {
                    let suspicionScore = 0;
                    let reasons = [];
                    
                    // Признак 1: Короткий период между покупками
                    if (row.weeks_span < 12) {
                        suspicionScore += 20;
                        reasons.push(`Короткий период: ${row.weeks_span.toFixed(1)} недель`);
                    }
                    
                    // Признак 2: Низкая конкуренция
                    if (row.avg_competition < 5) {
                        suspicionScore += 15;
                        reasons.push(`Низкая конкуренция: ${row.avg_competition.toFixed(1)} ставок`);
                    }
                    
                    // Признак 3: Стабильные цены (низкая вариация)
                    if (row.price_variance_pct < 10) {
                        suspicionScore += 20;
                        reasons.push(`Стабильные цены: вариация ${row.price_variance_pct.toFixed(1)}%`);
                    }
                    
                    // Признак 4: Много покупок
                    if (row.purchase_count >= 5) {
                        suspicionScore += 25;
                        reasons.push(`Много покупок: ${row.purchase_count}`);
                    } else if (row.purchase_count >= 3) {
                        suspicionScore += 15;
                        reasons.push(`Несколько покупок: ${row.purchase_count}`);
                    }
                    
                    // Признак 5: Высокие цены при низкой конкуренции
                    if (row.avg_competition < 3 && row.avg_price > 1000) {
                        suspicionScore += 30;
                        reasons.push(`Высокие цены при низкой конкуренции: ${row.avg_price.toFixed(0)}₽, ${row.avg_competition.toFixed(1)} ставок`);
                    }
                    
                    // Определяем уровень риска
                    let riskLevel = 'НОРМА';
                    if (suspicionScore >= 80) {
                        riskLevel = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО';
                    } else if (suspicionScore >= 50) {
                        riskLevel = 'ПОДОЗРИТЕЛЬНО';
                    } else if (suspicionScore >= 30) {
                        riskLevel = 'ВНИМАНИЕ';
                    }
                    
                    console.log(`📌 ${row.coin_description} ${row.year} (${row.condition})`);
                    console.log(`   Покупок: ${row.purchase_count}`);
                    console.log(`   Средняя цена: ${row.avg_price.toFixed(0)}₽`);
                    console.log(`   Средняя конкуренция: ${row.avg_competition.toFixed(1)} ставок`);
                    console.log(`   Период: ${row.weeks_span.toFixed(1)} недель`);
                    console.log(`   Вариация цены: ${row.price_variance_pct.toFixed(1)}%`);
                    console.log(`   Suspicion Score: ${suspicionScore}`);
                    console.log(`   Risk Level: ${riskLevel}`);
                    console.log(`   Причины: ${reasons.length > 0 ? reasons.join(', ') : 'нет'}`);
                    console.log(`   Аукционы: ${row.auctions}`);
                    console.log(`   Первая покупка: ${new Date(row.first_purchase).toLocaleDateString('ru-RU')}`);
                    console.log(`   Последняя покупка: ${new Date(row.last_purchase).toLocaleDateString('ru-RU')}`);
                    console.log('');
                    
                    if (riskLevel === 'НОРМА') {
                        console.log('   ⚠️  Этот случай НЕ попадет в отчет, т.к. riskLevel = НОРМА');
                    } else {
                        console.log('   ✅ Этот случай ДОЛЖЕН попасть в отчет');
                    }
                    console.log('');
                }
                
                // Проверяем, почему пользователь не попадает в отчет
                const allNormal = circularResult.rows.every(row => {
                    // Повторяем логику вычисления
                    let suspicionScore = 0;
                    if (row.weeks_span < 12) suspicionScore += 20;
                    if (row.avg_competition < 5) suspicionScore += 15;
                    if (row.price_variance_pct < 10) suspicionScore += 20;
                    if (row.purchase_count >= 5) suspicionScore += 25;
                    else if (row.purchase_count >= 3) suspicionScore += 15;
                    if (row.avg_competition < 3 && row.avg_price > 1000) suspicionScore += 30;
                    
                    return suspicionScore < 30; // НОРМА
                });
                
                if (allNormal) {
                    console.log('\n⚠️  ВСЕ случаи имеют riskLevel = НОРМА');
                    console.log('   Пользователь не попадет в отчет, даже если у него есть circular_buyers_score');
                } else {
                    console.log('\n✅ Найдены случаи, которые ДОЛЖНЫ попасть в отчет');
                    console.log(`   Проверьте параметры отчета: min_purchases=${minPurchases}, months=${months}`);
                }
                
                // Если нашли случаи, выходим из цикла
                if (circularResult.rows.length > 0) {
                    break;
                }
            } else {
                console.log(`   За период ${months} месяцев: случаев не найдено`);
            }
        }
        
        // 4. Проверяем отчет "Карусель перепродаж" (carousel_score)
        if (user.carousel_score > 0) {
            console.log('\n🎠 Проверка отчета "Карусель перепродаж":');
            console.log(`   У пользователя carousel_score = ${user.carousel_score}`);
            console.log('   Это означает, что пользователь участвовал в каруселях перепродаж монет');
            console.log('   Отчет "Карусель перепродаж" показывает МОНЕТЫ, а не пользователей');
            console.log('   Чтобы найти этого пользователя, нужно:');
            console.log('   1. Открыть отчет "Карусель перепродаж"');
            console.log('   2. Кликнуть на монету из карусели');
            console.log('   3. В деталях карусели будет список победителей, включая этого пользователя');
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

// Запускаем проверку
const login = process.argv[2] || 'ursulus';
checkCircularBuyersUser(login);

