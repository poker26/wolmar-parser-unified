/**
 * Универсальная функция извлечения номинала и валюты из описания монеты/боны
 * Поддерживает все основные валюты: рубли, копейки, доллары, центы, фунты, шиллинги и т.д.
 */

/**
 * Извлекает номинал и валюту из описания
 * @param {string} description - Описание монеты/боны
 * @returns {Object|null} - { denomination: number, currency: string, fullText: string } или null
 */
function extractDenominationAndCurrency(description) {
    if (!description || typeof description !== 'string') {
        return null;
    }
    
    const desc = description.trim();
    
    // Расширенный список паттернов для валют с приоритетом (более специфичные сначала)
    const currencyPatterns = [
        // Российские валюты
        { pattern: /(\d+(?:[.,]\d+)?)\s*(копеек?|коп\.?)/i, currency: 'копейка', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(рублей?|руб\.?)/i, currency: 'рубль', multiplier: 100 },
        
        // Американские валюты
        { pattern: /(\d+(?:[.,]\d+)?)\s*(центов?|cent|¢)/i, currency: 'цент', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(долларов?|\$|дол\.?|dollar)/i, currency: 'доллар', multiplier: 100 },
        
        // Британские валюты
        { pattern: /(\d+(?:[.,]\d+)?)\s*(пенсов?|пенни|penny|pence)/i, currency: 'пенни', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(шиллингов?|shilling)/i, currency: 'шиллинг', multiplier: 12 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(фунтов?|pound|£)/i, currency: 'фунт', multiplier: 240 },
        
        // Европейские валюты
        { pattern: /(\d+(?:[.,]\d+)?)\s*(евро|€|eur)/i, currency: 'евро', multiplier: 100 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(центов?\s*евро|евроцентов?)/i, currency: 'евроцент', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(франков?|franc)/i, currency: 'франк', multiplier: 100 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(сантимов?|centime)/i, currency: 'сантим', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(марок?|mark)/i, currency: 'марка', multiplier: 100 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(пфеннигов?|pfennig)/i, currency: 'пфенниг', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(лир?|lira)/i, currency: 'лира', multiplier: 100 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(сольдо|soldo)/i, currency: 'сольдо', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(песет?|peseta)/i, currency: 'песета', multiplier: 100 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(центаво|centavo)/i, currency: 'центаво', multiplier: 1 },
        
        // Скандинавские валюты
        { pattern: /(\d+(?:[.,]\d+)?)\s*(крон?|krone|krona)/i, currency: 'крона', multiplier: 100 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(эре|ore)/i, currency: 'эре', multiplier: 1 },
        
        // Исторические валюты
        { pattern: /(\d+(?:[.,]\d+)?)\s*(экю|ecu)/i, currency: 'экю', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(талеров?|thaler)/i, currency: 'талер', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(флоринов?|florin)/i, currency: 'флорин', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(дукатов?|ducat)/i, currency: 'дукат', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(реалов?|real)/i, currency: 'реал', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(стюверов?|stuiver)/i, currency: 'стювер', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(гульденов?|gulden)/i, currency: 'гульден', multiplier: 1 },
        
        // Азиатские валюты
        { pattern: /(\d+(?:[.,]\d+)?)\s*(йен?|yen|¥)/i, currency: 'йена', multiplier: 100 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(сен|sen)/i, currency: 'сен', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(юаней?|yuan)/i, currency: 'юань', multiplier: 100 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(фэней?|fen)/i, currency: 'фэнь', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(вон?|won)/i, currency: 'вона', multiplier: 100 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(чонов?|chon)/i, currency: 'чон', multiplier: 1 },
        
        // Другие валюты
        { pattern: /(\d+(?:[.,]\d+)?)\s*(злотых?|zloty)/i, currency: 'злотый', multiplier: 100 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(грошей?|grosz)/i, currency: 'грош', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(динаров?|dinar)/i, currency: 'динар', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(драхм?|drachma)/i, currency: 'драхма', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(риалов?|rial)/i, currency: 'риал', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(батов?|baht)/i, currency: 'бат', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(гривен?|hryvnia)/i, currency: 'гривна', multiplier: 100 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(копеек?|коп\.?)/i, currency: 'копейка', multiplier: 1 }, // Дубликат для надежности
        { pattern: /(\d+(?:[.,]\d+)?)\s*(дирхамов?|dirham)/i, currency: 'дирхам', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(донгов?|dong)/i, currency: 'донг', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(драмов?|dram)/i, currency: 'драм', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(гуарани|guarani)/i, currency: 'гуарани', multiplier: 1 },
        { pattern: /(\d+(?:[.,]\d+)?)\s*(инти|inti)/i, currency: 'инти', multiplier: 1 }
    ];
    
    // Пробуем найти совпадение по каждому паттерну
    for (const { pattern, currency, multiplier } of currencyPatterns) {
        const match = desc.match(pattern);
        if (match) {
            const denomination = parseFloat(match[1].replace(',', '.'));
            const fullText = `${denomination} ${currency}`;
            
            return {
                denomination: denomination,
                currency: currency,
                multiplier: multiplier, // Для конвертации в базовую единицу (копейки, центы и т.д.)
                fullText: fullText,
                originalMatch: match[0] // Полный текст совпадения для отладки
            };
        }
    }
    
    // Если ничего не найдено, возвращаем null
    return null;
}

/**
 * Создает SQL-условие для поиска по номиналу и валюте
 * @param {Object} denominationData - Результат extractDenominationAndCurrency
 * @param {Array} params - Массив параметров для SQL-запроса
 * @returns {string} - SQL условие (например, "AND coin_description ~ $5")
 */
function createDenominationSQLCondition(denominationData, params) {
    if (!denominationData) {
        return '';
    }
    
    const { denomination, currency } = denominationData;
    
    // Создаем паттерн для поиска: номинал + валюта
    // Используем границы слов для точного совпадения
    const currencyPatterns = {
        'копейка': 'копеек?|коп\\.?',
        'рубль': 'рублей?|руб\\.?',
        'цент': 'центов?|cent|¢',
        'доллар': 'долларов?|\\$|дол\\.?|dollar',
        'пенни': 'пенсов?|пенни|penny|pence',
        'шиллинг': 'шиллингов?|shilling',
        'фунт': 'фунтов?|pound|£',
        'евро': 'евро|€|eur',
        'евроцент': 'центов?\\s*евро|евроцентов?',
        'франк': 'франков?|franc',
        'сантим': 'сантимов?|centime',
        'марка': 'марок?|mark',
        'пфенниг': 'пфеннигов?|pfennig',
        'лира': 'лир?|lira',
        'сольдо': 'сольдо|soldo',
        'песета': 'песет?|peseta',
        'центаво': 'центаво|centavo',
        'крона': 'крон?|krone|krona',
        'эре': 'эре|ore',
        'экю': 'экю|ecu',
        'талер': 'талеров?|thaler',
        'флорин': 'флоринов?|florin',
        'дукат': 'дукатов?|ducat',
        'реал': 'реалов?|real',
        'стювер': 'стюверов?|stuiver',
        'гульден': 'гульденов?|gulden',
        'йена': 'йен?|yen|¥',
        'сен': 'сен|sen',
        'юань': 'юаней?|yuan',
        'фэнь': 'фэней?|fen',
        'вона': 'вон?|won',
        'чон': 'чонов?|chon',
        'злотый': 'злотых?|zloty',
        'грош': 'грошей?|grosz',
        'динар': 'динаров?|dinar',
        'драхма': 'драхм?|drachma',
        'риал': 'риалов?|rial',
        'бат': 'батов?|baht',
        'гривна': 'гривен?|hryvnia',
        'дирхам': 'дирхамов?|dirham',
        'донг': 'донгов?|dong',
        'драм': 'драмов?|dram',
        'гуарани': 'гуарани|guarani',
        'инти': 'инти|inti'
    };
    
    const currencyRegex = currencyPatterns[currency] || currency;
    
    // Создаем regex паттерн для PostgreSQL: номинал + валюта
    // Используем границы слов \m и \M для точного совпадения
    const sqlPattern = `\\m${denomination}\\s*(${currencyRegex})\\M`;
    
    params.push(sqlPattern);
    return ` AND coin_description ~* $${params.length}`;
}

module.exports = {
    extractDenominationAndCurrency,
    createDenominationSQLCondition
};

