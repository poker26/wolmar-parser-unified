const { Pool } = require('pg');
const config = require('./config');
const fs = require('fs');
const path = require('path');

async function updateImagePaths() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🖼️ Обновление путей к изображениям в БД...\n');
        
        // Получаем все записи из каталога
        const result = await pool.query('SELECT id, auction_number, lot_number FROM coin_catalog ORDER BY id');
        console.log(`📊 Найдено записей: ${result.rows.length}`);
        
        let updatedCount = 0;
        let notFoundCount = 0;
        
        for (const row of result.rows) {
            const auctionNumber = row.auction_number;
            const lotNumber = row.lot_number;
            
            // Формируем пути к изображениям
            const aversPath = `catalog-images/avers_${auctionNumber}_${lotNumber}.jpg`;
            const reversPath = `catalog-images/revers_${auctionNumber}_${lotNumber}.jpg`;
            
            // Проверяем существование файлов
            const aversExists = fs.existsSync(aversPath);
            const reversExists = fs.existsSync(reversPath);
            
            if (aversExists || reversExists) {
                // Обновляем пути в базе данных
                await pool.query(`
                    UPDATE coin_catalog 
                    SET avers_image_path = $1, revers_image_path = $2
                    WHERE id = $3
                `, [
                    aversExists ? aversPath : null,
                    reversExists ? reversPath : null,
                    row.id
                ]);
                
                updatedCount++;
                console.log(`✅ ID ${row.id}: Аукцион ${auctionNumber}, Лот ${lotNumber} - ${aversExists ? 'аверс' : ''} ${reversExists ? 'реверс' : ''}`);
            } else {
                notFoundCount++;
                if (notFoundCount <= 5) { // Показываем только первые 5 примеров
                    console.log(`❌ ID ${row.id}: Аукцион ${auctionNumber}, Лот ${lotNumber} - изображения не найдены`);
                }
            }
        }
        
        console.log(`\n📈 Статистика обновления:`);
        console.log(`✅ Обновлено записей: ${updatedCount}`);
        console.log(`❌ Не найдено изображений: ${notFoundCount}`);
        
        // Проверяем результат
        const checkResult = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(avers_image_path) as with_avers,
                COUNT(revers_image_path) as with_revers
            FROM coin_catalog
        `);
        
        console.log(`\n📊 Итоговая статистика:`);
        console.log(`📋 Всего записей: ${checkResult.rows[0].total}`);
        console.log(`🖼️ С аверсом: ${checkResult.rows[0].with_avers}`);
        console.log(`🖼️ С реверсом: ${checkResult.rows[0].with_revers}`);
        
    } catch (error) {
        console.error('❌ Ошибка при обновлении путей:', error.message);
    } finally {
        await pool.end();
    }
}

updateImagePaths();


