const { Pool } = require('pg');
const config = require('./config');
const MetalsPriceService = require('./metals-price-service');

const pool = new Pool(config.dbConfig);

async function debugPremiumCalculation() {
    const service = new MetalsPriceService();
    
    try {
        console.log('🔍 Отладка расчета нумизматической наценки...');
        
        const lotId = 29823;
        
        // Получаем данные лота
        const lotQuery = `
            SELECT id, lot_number, auction_number, coin_description, 
                   winning_bid, auction_end_date, metal, weight
            FROM auction_lots 
            WHERE id = $1
        `;
        
        const lotResult = await pool.query(lotQuery, [lotId]);
        
        if (lotResult.rows.length === 0) {
            console.log('❌ Лот не найден');
            return;
        }
        
        const lot = lotResult.rows[0];
        console.log('📋 Данные лота:');
        console.log(`   ID: ${lot.id}`);
        console.log(`   Металл: ${lot.metal}`);
        console.log(`   Вес: ${lot.weight} г`);
        console.log(`   Цена: ${lot.winning_bid} ₽`);
        console.log(`   Дата аукциона: ${lot.auction_end_date}`);
        
        // Форматируем дату
        const auctionDate = new Date(lot.auction_end_date).toISOString().split('T')[0];
        console.log(`   Форматированная дата: ${auctionDate}`);
        
        // Определяем тип металла
        const metalType = lot.metal.toLowerCase() + '_price';
        console.log(`   Тип металла для поиска: ${metalType}`);
        
        // Получаем цену металла
        console.log('\n🔍 Получаем цену металла...');
        const priceData = await service.getMetalPriceFromDB(auctionDate, metalType);
        console.log('Результат:', priceData);
        
        if (priceData) {
            // Вычисляем нумизматическую наценку
            console.log('\n💰 Вычисляем нумизматическую наценку...');
            const premium = service.calculateNumismaticPremium(
                lot.winning_bid,
                lot.weight,
                priceData.price,
                priceData.usdRate
            );
            console.log('Результат расчета:', premium);
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await service.close();
        await pool.end();
    }
}

debugPremiumCalculation();
