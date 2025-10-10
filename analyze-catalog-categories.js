const { Pool } = require('pg');
const config = require('./config');

async function analyzeCatalogCategories() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Анализируем содержимое каталога...');
        
        // Проверим общую статистику
        const totalQuery = `SELECT COUNT(*) as total FROM coin_catalog`;
        const totalResult = await pool.query(totalQuery);
        console.log(`📊 Всего записей в каталоге: ${totalResult.rows[0].total}`);
        
        // Анализируем по металлам
        console.log('\n🔍 Анализ по металлам:');
        const metalsQuery = `
            SELECT 
                metal,
                COUNT(*) as count,
                ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM coin_catalog), 2) as percentage
            FROM coin_catalog 
            WHERE metal IS NOT NULL
            GROUP BY metal
            ORDER BY count DESC
        `;
        
        const metalsResult = await pool.query(metalsQuery);
        metalsResult.rows.forEach(row => {
            console.log(`  ${row.metal}: ${row.count} записей (${row.percentage}%)`);
        });
        
        // Анализируем по номиналам (ищем не-монетные предметы)
        console.log('\n🔍 Анализ по номиналам (поиск не-монетных предметов):');
        const denominationQuery = `
            SELECT 
                denomination,
                COUNT(*) as count
            FROM coin_catalog 
            WHERE denomination IS NOT NULL
            GROUP BY denomination
            ORDER BY count DESC
            LIMIT 20
        `;
        
        const denominationResult = await pool.query(denominationQuery);
        denominationResult.rows.forEach(row => {
            console.log(`  "${row.denomination}": ${row.count} записей`);
        });
        
        // Ищем предметы без номинала
        console.log('\n🔍 Предметы без номинала:');
        const noDenominationQuery = `
            SELECT COUNT(*) as count
            FROM coin_catalog 
            WHERE denomination IS NULL OR denomination = ''
        `;
        
        const noDenominationResult = await pool.query(noDenominationQuery);
        console.log(`  Без номинала: ${noDenominationResult.rows[0].count} записей`);
        
        // Анализируем описания на предмет ключевых слов
        console.log('\n🔍 Анализ описаний (поиск ключевых слов):');
        
        const keywords = [
            'медаль', 'медальон', 'значок', 'знак', 'орден', 'награда',
            'банкнот', 'купюра', 'бона', 'ассигнация', 'бумага',
            'часы', 'браслет', 'кольцо', 'цепочка', 'подвеска',
            'монета', 'копейка', 'рубль', 'доллар', 'евро'
        ];
        
        for (const keyword of keywords) {
            const keywordQuery = `
                SELECT COUNT(*) as count
                FROM coin_catalog 
                WHERE LOWER(original_description) LIKE LOWER($1)
            `;
            
            const keywordResult = await pool.query(keywordQuery, [`%${keyword}%`]);
            if (keywordResult.rows[0].count > 0) {
                console.log(`  "${keyword}": ${keywordResult.rows[0].count} записей`);
            }
        }
        
        // Анализируем предметы с весом драгметаллов
        console.log('\n🔍 Анализ предметов с весом драгметаллов:');
        const weightQuery = `
            SELECT 
                metal,
                COUNT(*) as count,
                AVG(coin_weight) as avg_weight
            FROM coin_catalog 
            WHERE coin_weight IS NOT NULL 
            AND coin_weight > 0
            AND metal IN ('Au', 'Ag', 'Pt', 'Pd')
            GROUP BY metal
            ORDER BY count DESC
        `;
        
        const weightResult = await pool.query(weightQuery);
        weightResult.rows.forEach(row => {
            console.log(`  ${row.metal}: ${row.count} записей, средний вес: ${parseFloat(row.avg_weight).toFixed(2)}g`);
        });
        
        // Примеры записей для анализа
        console.log('\n🔍 Примеры записей для анализа:');
        const examplesQuery = `
            SELECT 
                id,
                denomination,
                metal,
                coin_weight,
                year,
                original_description
            FROM coin_catalog 
            ORDER BY RANDOM()
            LIMIT 10
        `;
        
        const examplesResult = await pool.query(examplesQuery);
        examplesResult.rows.forEach((row, index) => {
            console.log(`\n${index + 1}. ID: ${row.id}`);
            console.log(`   Номинал: "${row.denomination}"`);
            console.log(`   Металл: ${row.metal}`);
            console.log(`   Вес: ${row.coin_weight}g`);
            console.log(`   Год: ${row.year}`);
            console.log(`   Описание: "${row.original_description?.substring(0, 100)}..."`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

analyzeCatalogCategories();
