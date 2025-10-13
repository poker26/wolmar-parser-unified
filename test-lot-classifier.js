const LotClassifier = require('./lot-classifier');

// Создаем экземпляр классификатора
const classifier = new LotClassifier();

// Тестовые лоты
const testLots = [
    {
        id: 1,
        coin_description: '1 рубль 1898 года, серебро, император Николай II',
        letters: 'АГ',
        denomination: '1 рубль',
        metal: 'серебро',
        year: 1898
    },
    {
        id: 2,
        coin_description: 'Банкнота 100 рублей 1997 года, государственный банк России',
        letters: null,
        denomination: '100 рублей',
        metal: null,
        year: 1997
    },
    {
        id: 3,
        coin_description: 'Жетон "Московский метрополитен", металлический',
        letters: null,
        denomination: null,
        metal: 'металл',
        year: null
    },
    {
        id: 4,
        coin_description: 'Медаль "За отвагу", бронза, советский период',
        letters: null,
        denomination: null,
        metal: 'бронза',
        year: null
    },
    {
        id: 5,
        coin_description: 'Орден Красной Звезды, эмаль, знак отличия',
        letters: null,
        denomination: null,
        metal: null,
        year: null
    },
    {
        id: 6,
        coin_description: 'Кольцо с драгоценным камнем, золото 585 пробы',
        letters: null,
        denomination: null,
        metal: 'золото',
        year: null
    },
    {
        id: 7,
        coin_description: '1 копейка 1924 года, медь, СССР',
        letters: null,
        denomination: '1 копейка',
        metal: 'медь',
        year: 1924
    },
    {
        id: 8,
        coin_description: 'Доллар США 1921 года, серебро, Морган',
        letters: null,
        denomination: '1 доллар',
        metal: 'серебро',
        year: 1921
    }
];

console.log('🧪 Тестирование классификатора лотов...\n');

testLots.forEach((lot, index) => {
    console.log(`--- Тест ${index + 1} ---`);
    console.log(`Описание: ${lot.coin_description}`);
    console.log(`Номинал: ${lot.denomination || 'не указан'}`);
    console.log(`Металл: ${lot.metal || 'не указан'}`);
    console.log(`Год: ${lot.year || 'не указан'}`);
    
    // Простая классификация
    const category = classifier.classify(lot);
    console.log(`🎯 Категория: ${category || 'не определена'}`);
    
    // Детальная классификация
    const detailed = classifier.classifyDetailed(lot);
    console.log(`📊 Уверенность: ${(detailed.confidence * 100).toFixed(1)}%`);
    console.log(`📈 Максимальный счет: ${detailed.maxScore.toFixed(2)}`);
    
    if (detailed.category) {
        console.log(`🏆 Лучшие совпадения:`);
        Object.entries(detailed.fieldAnalysis).forEach(([field, analysis]) => {
            if (analysis.matches[detailed.category] && analysis.matches[detailed.category].length > 0) {
                console.log(`  ${field}: ${analysis.matches[detailed.category].join(', ')}`);
            }
        });
    }
    
    console.log('');
});

// Тестируем доступные категории
console.log('📋 Доступные категории:');
classifier.getAvailableCategories().forEach(category => {
    const keywords = classifier.getCategoryKeywords(category);
    console.log(`  ${category}: ${keywords.keywords.length} ключевых слов, ${keywords.negativeKeywords.length} отрицательных`);
});

console.log('\n✅ Тестирование завершено!');
