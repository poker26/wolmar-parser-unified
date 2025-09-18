const { Client } = require('pg');

const dbConfig = {
    user: 'postgres.xkwgspqwebfeteoblayu',        
    host: 'aws-0-eu-north-1.pooler.supabase.com',
    database: 'postgres',   
    password: 'Gopapopa326+',    
    port: 6543,
    ssl: {
        rejectUnauthorized: false
    }
};

async function analyzeConditionData() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключение к базе данных успешно');
        
        // 1. Проверяем структуру таблицы
        console.log('\n📊 Структура таблицы auction_lots:');
        const structureQuery = `
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'auction_lots' 
            AND column_name IN ('condition', 'metal', 'weight')
            ORDER BY column_name;
        `;
        const structureResult = await client.query(structureQuery);
        console.table(structureResult.rows);
        
        // 2. Общая статистика по полю condition
        console.log('\n📈 Общая статистика по полю condition:');
        const totalQuery = `
            SELECT 
                COUNT(*) as total_lots,
                COUNT(condition) as lots_with_condition,
                COUNT(*) - COUNT(condition) as lots_without_condition
            FROM auction_lots;
        `;
        const totalResult = await client.query(totalQuery);
        console.table(totalResult.rows);
        
        // 3. Топ-20 самых частых значений condition
        console.log('\n🏆 Топ-20 самых частых значений condition:');
        const topQuery = `
            SELECT condition, COUNT(*) as count
            FROM auction_lots 
            WHERE condition IS NOT NULL 
            GROUP BY condition 
            ORDER BY count DESC 
            LIMIT 20;
        `;
        const topResult = await client.query(topQuery);
        console.table(topResult.rows);
        
        // 4. Ищем записи, которые уже содержат градации (цифры)
        console.log('\n🔍 Записи с градациями (содержат цифры):');
        const gradeQuery = `
            SELECT condition, COUNT(*) as count
            FROM auction_lots 
            WHERE condition ~ '[0-9]{2,3}' 
            GROUP BY condition 
            ORDER BY count DESC
            LIMIT 15;
        `;
        const gradeResult = await client.query(gradeQuery);
        console.table(gradeResult.rows);
        
        // 5. Ищем записи с типичными состояниями без градаций
        console.log('\n📋 Типичные состояния без градаций:');
        const noGradeQuery = `
            SELECT condition, COUNT(*) as count
            FROM auction_lots 
            WHERE condition IS NOT NULL 
            AND condition !~ '[0-9]{2,3}'
            AND condition IN ('MS', 'AU', 'XF', 'VF', 'F', 'VG', 'G', 'AG', 'FA', 'PR')
            GROUP BY condition 
            ORDER BY count DESC;
        `;
        const noGradeResult = await client.query(noGradeQuery);
        console.table(noGradeResult.rows);
        
        // 6. Анализ форматов с пробелами (например "MS 61")
        console.log('\n🔤 Записи с пробелами между состоянием и градацией:');
        const spaceQuery = `
            SELECT condition, COUNT(*) as count
            FROM auction_lots 
            WHERE condition ~ '[A-Z]{2,3}\\s+[0-9]{2,3}'
            GROUP BY condition 
            ORDER BY count DESC
            LIMIT 10;
        `;
        const spaceResult = await client.query(spaceQuery);
        console.table(spaceResult.rows);
        
        // 7. Примеры записей для анализа
        console.log('\n📝 Примеры записей для анализа:');
        const examplesQuery = `
            SELECT id, lot_number, auction_number, condition, metal, coin_description
            FROM auction_lots 
            WHERE condition IS NOT NULL 
            ORDER BY RANDOM() 
            LIMIT 10;
        `;
        const examplesResult = await client.query(examplesQuery);
        console.table(examplesResult.rows);
        
    } catch (error) {
        console.error('❌ Ошибка при анализе данных:', error);
    } finally {
        await client.end();
        console.log('\n✅ Анализ завершен');
    }
}

analyzeConditionData();
