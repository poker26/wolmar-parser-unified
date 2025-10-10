/**
 * Классификатор категорий для каталога
 */

const CATEGORIES = {
    COIN: 'coin',           // Монеты
    MEDAL: 'medal',         // Медали и медальоны  
    BADGE: 'badge',         // Значки и знаки
    ORDER: 'order',         // Ордена и награды
    BANKNOTE: 'banknote',   // Банкноты и боны
    JEWELRY: 'jewelry',     // Ювелирные изделия (кольца, браслеты, цепочки)
    WATCH: 'watch',         // Часы
    TABLEWARE: 'tableware', // Столовые приборы (подсвечники, ложки)
    TOKEN: 'token',         // Жетоны и сувениры
    OTHER: 'other'          // Прочее
};

/**
 * Правила классификации по ключевым словам
 */
const CLASSIFICATION_RULES = {
    [CATEGORIES.COIN]: [
        'монета', 'копейка', 'рубль', 'доллар', 'евро', 'франк', 'марка', 'крона',
        'денарий', 'дирхем', 'динар', 'драхма', 'ауреус', 'солид', 'фоллис',
        'монетный двор', 'тираж', 'чеканка'
    ],
    
    [CATEGORIES.MEDAL]: [
        'медаль', 'медальон', 'памятная медаль', 'юбилейная медаль',
        'медаль в память', 'медаль в честь', 'медаль за'
    ],
    
    [CATEGORIES.BADGE]: [
        'значок', 'знак', 'эмблема', 'символ', 'отличительный знак',
        'знак отличия', 'нагрудный знак', 'знак общества'
    ],
    
    [CATEGORIES.ORDER]: [
        'орден', 'награда', 'крест', 'звезда', 'лента', 'орденская',
        'орден святого', 'орден красного знамени', 'орден трудового'
    ],
    
    [CATEGORIES.BANKNOTE]: [
        'банкнот', 'купюра', 'бона', 'ассигнация', 'бумага', 'бумажный',
        'банковский билет', 'денежный знак'
    ],
    
    [CATEGORIES.JEWELRY]: [
        'кольцо', 'браслет', 'цепочка', 'подвеска', 'серьги', 'ожерелье',
        'кулон', 'перстень', 'печатка', 'ювелирное изделие'
    ],
    
    [CATEGORIES.WATCH]: [
        'часы', 'карманные часы', 'наручные часы', 'хронометр', 'будильник'
    ],
    
    [CATEGORIES.TABLEWARE]: [
        'подсвечник', 'ложка', 'вилка', 'нож', 'тарелка', 'чашка', 'стакан',
        'кубок', 'кувшин', 'сахарница', 'молочник', 'столовое серебро'
    ],
    
    [CATEGORIES.TOKEN]: [
        'жетон', 'сувенирный жетон', 'памятный жетон', 'жетон метро',
        'игровой жетон', 'жетон казино', 'сувенир'
    ]
};

/**
 * Классифицирует предмет по описанию
 * @param {string} description - Описание предмета
 * @param {string} denomination - Номинал
 * @param {string} metal - Металл
 * @param {number} weight - Вес
 * @returns {string} Категория предмета
 */
function classifyItem(description, denomination, metal, weight) {
    if (!description) return CATEGORIES.OTHER;
    
    const desc = description.toLowerCase();
    
    // Проверяем правила классификации
    for (const [category, keywords] of Object.entries(CLASSIFICATION_RULES)) {
        for (const keyword of keywords) {
            if (desc.includes(keyword.toLowerCase())) {
                return category;
            }
        }
    }
    
    // Дополнительные правила на основе других полей
    
    // Если есть номинал с валютой - скорее всего монета
    if (denomination && (
        denomination.includes('рубль') || 
        denomination.includes('копейка') || 
        denomination.includes('доллар') ||
        denomination.includes('евро') ||
        denomination.includes('франк') ||
        denomination.includes('марка')
    )) {
        return CATEGORIES.COIN;
    }
    
    // Если есть вес драгметалла и нет номинала - возможно ювелирное изделие
    if (weight && weight > 0 && metal && ['Au', 'Ag', 'Pt', 'Pd'].includes(metal) && !denomination) {
        return CATEGORIES.JEWELRY;
    }
    
    // Если описание содержит "лот из" - возможно прочее
    if (desc.includes('лот из')) {
        return CATEGORIES.OTHER;
    }
    
    return CATEGORIES.OTHER;
}

/**
 * Получает правила дедупликации для категории
 * @param {string} category - Категория предмета
 * @returns {object} Правила дедупликации
 */
function getDeduplicationRules(category) {
    const rules = {
        [CATEGORIES.COIN]: {
            fields: ['original_description'],
            description: 'Монеты: только по описанию (номинал, металл, вес, год уже в описании)'
        },
        
        [CATEGORIES.MEDAL]: {
            fields: ['original_description'],
            description: 'Медали: только по описанию'
        },
        
        [CATEGORIES.BADGE]: {
            fields: ['original_description'],
            description: 'Значки: только по описанию'
        },
        
        [CATEGORIES.ORDER]: {
            fields: ['original_description'],
            description: 'Ордена: только по описанию'
        },
        
        [CATEGORIES.BANKNOTE]: {
            fields: ['original_description'],
            description: 'Банкноты: только по описанию'
        },
        
        [CATEGORIES.JEWELRY]: {
            fields: ['original_description'],
            description: 'Ювелирные изделия: только по описанию'
        },
        
        [CATEGORIES.WATCH]: {
            fields: ['original_description'],
            description: 'Часы: только по описанию'
        },
        
        [CATEGORIES.TABLEWARE]: {
            fields: ['original_description'],
            description: 'Столовые приборы: только по описанию'
        },
        
        [CATEGORIES.TOKEN]: {
            fields: ['original_description'],
            description: 'Жетоны: только по описанию'
        },
        
        [CATEGORIES.OTHER]: {
            fields: ['original_description'],
            description: 'Прочее: только по описанию'
        }
    };
    
    return rules[category] || rules[CATEGORIES.OTHER];
}

module.exports = {
    CATEGORIES,
    CLASSIFICATION_RULES,
    classifyItem,
    getDeduplicationRules
};
