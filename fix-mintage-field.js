const { Pool } = require('pg');
const config = require('./config');

async function fixMintageField() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔧 Исправление типа поля mintage с INTEGER на BIGINT...\n');
        
        // Проверяем текущий тип поля
        const checkQuery = `
            SELECT column_name, data_type, numeric_precision, numeric_scale
            FROM information_schema.columns 
            WHERE table_name = 'coin_catalog' 
            AND column_name = 'mintage'
        `;
        
        const currentType = await pool.query(checkQuery);
        console.log('📋 Текущий тип поля mintage:', currentType.rows[0]);
        
        // Изменяем тип поля на BIGINT
        await pool.query(`
            ALTER TABLE coin_catalog 
            ALTER COLUMN mintage TYPE BIGINT
        `);
        console.log('✅ Поле mintage изменено на BIGINT');
        
        // Проверяем новый тип поля
        const newType = await pool.query(checkQuery);
        console.log('📋 Новый тип поля mintage:', newType.rows[0]);
        
        // Проверяем, есть ли проблемные записи
        const problemQuery = `
            SELECT COUNT(*) as problem_count
            FROM coin_catalog 
            WHERE mintage > 2147483647
        `;
        
        const problemCount = await pool.query(problemQuery);
        console.log(`⚠️ Записей с тиражом > 2,147,483,647: ${problemCount.rows[0].problem_count}`);
        
        if (problemCount.rows[0].problem_count > 0) {
            console.log('🔍 Найдены проблемные записи. Показываем примеры:');
            
            const examplesQuery = `
                SELECT id, coin_name, mintage, original_description
                FROM coin_catalog 
                WHERE mintage > 2147483647
                LIMIT 5
            `;
            
            const examples = await pool.query(examplesQuery);
            examples.rows.forEach(row => {
                console.log(`  - ID: ${row.id}, Тираж: ${row.mintage}, Название: ${row.coin_name}`);
            });
        }
        
        console.log('\n🎉 Поле mintage успешно исправлено!');
        
    } catch (error) {
        console.error('❌ Ошибка при исправлении поля mintage:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

// Запускаем исправление
fixMintageField()
    .then(() => {
        console.log('✅ Исправление завершено успешно');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Ошибка:', error.message);
        process.exit(1);
    });
