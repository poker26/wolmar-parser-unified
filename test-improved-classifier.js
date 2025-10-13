const LotClassifier = require('./lot-classifier');

// Создаем экземпляр улучшенного классификатора
const classifier = new LotClassifier();

// Тестируем проблемный лот
const problemLot = {
    id: 71798,
    coin_description: '3 рубле. Чемпионат мира по футболу FIFA 2018 в России (Самара) 2018г. СПМД. Ag. | В слабе NGC. Выпуск 2017. Изображения картуша с ракетой-носителем "Союз" и надписью "САМАРА" на фоне орнамента, состоящего из элементов, отображающих российскую культуру и фольклорное наследие, а также футбольный мир; выполненной в цвете траектории полета',
    letters: 'СПМД',
    metal: 'Ag',
    year: 2018,
    lot_type: null
};

console.log('🧪 Тестируем улучшенный классификатор на проблемном лоте...\n');

console.log('--- Проблемный лот ---');
console.log(`Описание: ${problemLot.coin_description}`);
console.log(`Буквы: ${problemLot.letters}`);
console.log(`Металл: ${problemLot.metal}`);
console.log(`Год: ${problemLot.year}`);

// Простая классификация
const category = classifier.classify(problemLot);
console.log(`🎯 Категория: ${category || 'не определена'}`);

// Детальная классификация
const detailed = classifier.classifyDetailed(problemLot);
console.log(`📊 Уверенность: ${(detailed.confidence * 100).toFixed(1)}%`);
console.log(`📈 Максимальный счет: ${detailed.maxScore.toFixed(2)}`);

console.log('\n📊 Счета по категориям:');
Object.entries(detailed.scores)
    .sort(([,a], [,b]) => b - a)
    .forEach(([category, score]) => {
        console.log(`  ${category}: ${score.toFixed(2)}`);
    });

if (detailed.category) {
    console.log('\n🏆 Лучшие совпадения:');
    Object.entries(detailed.fieldAnalysis).forEach(([field, analysis]) => {
        if (analysis.matches[detailed.category] && analysis.matches[detailed.category].length > 0) {
            console.log(`  ${field}: ${analysis.matches[detailed.category].join(', ')}`);
        }
    });
}

// Тестируем еще несколько примеров
const testLots = [
    {
        id: 1,
        coin_description: '1 рубль 1898 года, серебро, император Николай II',
        letters: 'АГ',
        metal: 'Ag',
        year: 1898
    },
    {
        id: 2,
        coin_description: 'Банкнота 100 рублей 1997 года, государственный банк России, бумага',
        letters: null,
        metal: null,
        year: 1997
    },
    {
        id: 3,
        coin_description: 'Жетон "Московский метрополитен", металлический',
        letters: null,
        metal: 'металл',
        year: null
    }
];

console.log('\n🧪 Тестируем на дополнительных примерах:');

testLots.forEach((lot, index) => {
    console.log(`\n--- Тест ${index + 1} ---`);
    console.log(`Описание: ${lot.coin_description}`);
    console.log(`Металл: ${lot.metal || 'не указан'}`);
    
    const category = classifier.classify(lot);
    const detailed = classifier.classifyDetailed(lot);
    
    console.log(`🎯 Категория: ${category || 'не определена'}`);
    console.log(`📊 Уверенность: ${(detailed.confidence * 100).toFixed(1)}%`);
});

console.log('\n✅ Тестирование завершено!');
