const { Pool } = require('pg');
const config = require('./config');

// Копируем логику парсинга номинала из catalog-parser.js для тестирования
function parseDenomination(description) {
    const denominationMatch = description.match(/^(\d+(?:\.\d+)?)\s+([а-яё\w\s]+?)(?:\s+\d{4}г?\.|\s+[A-Z][a-z]|\s*$)/i);
    if (denominationMatch) {
        const number = denominationMatch[1];
        const currency = denominationMatch[2].trim();
        
        // Определяем валюту по ключевым словам
        let fullDenomination = number;
        if (currency.match(/(рублей?|руб\.?)/i)) {
            fullDenomination = `${number} рубль`;
        } else if (currency.match(/(копеек?|коп\.?)/i)) {
            fullDenomination = `${number} копейка`;
        } else if (currency.match(/(долларов?|\$|дол\.?)/i)) {
            fullDenomination = `${number} доллар`;
        } else if (currency.match(/(евро|€|eur)/i)) {
            fullDenomination = `${number} евро`;
        } else if (currency.match(/(фунтов?|pound)/i)) {
            fullDenomination = `${number} фунт`;
        } else if (currency.match(/(франков?|franc)/i)) {
            fullDenomination = `${number} франк`;
        } else if (currency.match(/(марок?|mark)/i)) {
            fullDenomination = `${number} марка`;
        } else if (currency.match(/(крон?|krone)/i)) {
            fullDenomination = `${number} крона`;
        } else if (currency.match(/(центов?|cent)/i)) {
            fullDenomination = `${number} цент`;
        } else if (currency.length > 0) {
            // Если есть текст после числа, но не распознанная валюта
            fullDenomination = `${number} ${currency}`;
        }
        
        return fullDenomination;
    } else {
        return "1";
    }
}

async function testDenominationParsing() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🧪 Тестируем новую логику парсинга номинала...');
        
        // Получаем примеры описаний из базы данных
        const query = `
            SELECT DISTINCT original_description
            FROM coin_catalog 
            WHERE original_description IS NOT NULL
            AND original_description != ''
            ORDER BY original_description
            LIMIT 50
        `;
        
        const result = await pool.query(query);
        
        console.log(`📋 Тестируем на ${result.rows.length} примерах описаний:\n`);
        
        result.rows.forEach((row, index) => {
            const description = row.original_description;
            const parsedDenomination = parseDenomination(description);
            console.log(`${index + 1}. "${description}"`);
            console.log(`   → Номинал: "${parsedDenomination}"\n`);
        });
        
        // Тестируем на конкретных примерах
        console.log('🔍 Тестируем на конкретных примерах:\n');
        
        const testCases = [
            "1 рубль 1900г. Ag",
            "5 копеек 1850г. Cu", 
            "1 доллар 1921г. Ag",
            "10 евро 2002г. Au",
            "1 фунт 1890г. Ag",
            "2 франка 1870г. Ag",
            "1 марка 1910г. Ag",
            "1 крона 1920г. Ag",
            "50 центов 1950г. Cu",
            "1 1900г. Ag", // Без валюты
            "25 рублей 1900г. Ag",
            "3 копейки 1850г. Cu"
        ];
        
        testCases.forEach((testCase, index) => {
            const parsedDenomination = parseDenomination(testCase);
            console.log(`${index + 1}. "${testCase}"`);
            console.log(`   → Номинал: "${parsedDenomination}"\n`);
        });
        
        // Проверим, как это повлияет на дубликаты
        console.log('📊 Анализ влияния на дубликаты...\n');
        
        const duplicateQuery = `
            SELECT 
                denomination,
                COUNT(*) as count
            FROM coin_catalog 
            WHERE denomination IS NOT NULL
            GROUP BY denomination
            HAVING COUNT(*) > 1
            ORDER BY count DESC
            LIMIT 10
        `;
        
        const duplicateResult = await pool.query(duplicateQuery);
        
        console.log('Текущие дубликаты по номиналу:');
        duplicateResult.rows.forEach((row, index) => {
            console.log(`${index + 1}. "${row.denomination}": ${row.count} записей`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

testDenominationParsing();
