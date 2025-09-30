const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkAuction968() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Проверка аукциона 968 на наличие лотов с драгоценными металлами...\n');
        
        // Проверяем общее количество лотов в аукционе 968
        const totalQuery = `
            SELECT COUNT(*) as total_lots
            FROM auction_lots
            WHERE auction_number = '968'
            AND coin_description IS NOT NULL 
            AND coin_description != '';
        `;
        
        const totalResult = await client.query(totalQuery);
        console.log(`📊 Всего лотов в аукционе 968: ${totalResult.rows[0].total_lots}`);
        
        // Проверяем лоты с драгоценными металлами в аукционе 968
        const preciousQuery = `
            SELECT COUNT(*) as precious_lots
            FROM auction_lots
            WHERE auction_number = '968'
            AND (coin_description ILIKE '%Au%' OR coin_description ILIKE '%Ag%' OR coin_description ILIKE '%Pt%' OR coin_description ILIKE '%Pd%')
            AND coin_description IS NOT NULL 
            AND coin_description != '';
        `;
        
        const preciousResult = await client.query(preciousQuery);
        console.log(`📊 Лотов с драгоценными металлами в аукционе 968: ${preciousResult.rows[0].precious_lots}`);
        
        // Показываем примеры лотов с драгоценными металлами
        const examplesQuery = `
            SELECT id, lot_number, coin_description
            FROM auction_lots
            WHERE auction_number = '968'
            AND (coin_description ILIKE '%Au%' OR coin_description ILIKE '%Ag%' OR coin_description ILIKE '%Pt%' OR coin_description ILIKE '%Pd%')
            AND coin_description IS NOT NULL 
            AND coin_description != ''
            ORDER BY id
            LIMIT 10;
        `;
        
        const examplesResult = await client.query(examplesQuery);
        
        console.log(`\n📋 Примеры лотов с драгоценными металлами в аукционе 968:`);
        examplesResult.rows.forEach((row, index) => {
            console.log(`${index + 1}. ID: ${row.id}, Лот: ${row.lot_number}`);
            console.log(`   Описание: ${row.coin_description.substring(0, 100)}...`);
            console.log('');
        });
        
        // Проверяем, есть ли лоты с явным указанием веса
        const weightQuery = `
            SELECT COUNT(*) as weight_lots
            FROM auction_lots
            WHERE auction_number = '968'
            AND (coin_description ILIKE '%Au%' OR coin_description ILIKE '%Ag%' OR coin_description ILIKE '%Pt%' OR coin_description ILIKE '%Pd%')
            AND (
                coin_description ILIKE '%вес%' OR 
                coin_description ILIKE '%гр%' OR 
                coin_description ILIKE '%oz%' OR
                coin_description ~* '(Au|Ag|Pt|Pd)\\s+\\d+(?:,\\d+)?' OR
                coin_description ~* '\\d+\\s*проб[аы]'
            )
            AND coin_description IS NOT NULL 
            AND coin_description != '';
        `;
        
        const weightResult = await client.query(weightQuery);
        console.log(`📊 Лотов с драгоценными металлами И весом в аукционе 968: ${weightResult.rows[0].weight_lots}`);
        
    } catch (error) {
        console.error('❌ Ошибка при проверке аукциона 968:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

checkAuction968();
