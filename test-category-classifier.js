const { classifyItem, CATEGORIES } = require('./category-classifier');

// Тестовые примеры из анализа
const testItems = [
    {
        description: "Лот из двух медалей в память 50-летия и 60-летия Военно-воздушной инженерной академии имени профессора Н.Е. Жуковского",
        denomination: "1",
        metal: "",
        weight: null
    },
    {
        description: "Тетрадрахма. Греко-Бактрия. Евкратид I Ag 16,17. | 175-145 г.г. до н.э.",
        denomination: "1",
        metal: "AG",
        weight: 16.170
    },
    {
        description: "Подборка 5 копеек, 3 шт Cu-Al",
        denomination: "5 копейка",
        metal: "Cu",
        weight: null
    },
    {
        description: "Знак Хоровое общество Lt",
        denomination: "1",
        metal: "",
        weight: null
    },
    {
        description: "Лот из восьми сувенирных жетонов, посвященных достопримечательностям Санкт-Петербурга и Петергофа",
        denomination: "1",
        metal: "",
        weight: null
    },
    {
        description: "Денарий. Римская империя. Луций Ag",
        denomination: "1",
        metal: "Ag",
        weight: null
    },
    {
        description: "Серебряный подсвечник Ag. | Серебряный подсвечник. Серебро 813 пробы. Вес - 182 гр., высота - 5,5 см",
        denomination: "1",
        metal: "Ag",
        weight: 182.000
    },
    {
        description: "Жетон Татарстан Cu",
        denomination: "1",
        metal: "Cu",
        weight: null
    },
    {
        description: "Монета. Османская империя Au 0,76. | Отверстие",
        denomination: "1",
        metal: "AU",
        weight: 0.760
    },
    {
        description: "Знак 16-го пехотного Ладожского полка",
        denomination: "1",
        metal: "",
        weight: null
    }
];

console.log('🧪 Тестируем классификатор категорий...\n');

testItems.forEach((item, index) => {
    const category = classifyItem(item.description, item.denomination, item.metal, item.weight);
    console.log(`${index + 1}. Категория: ${category}`);
    console.log(`   Описание: "${item.description.substring(0, 80)}..."`);
    console.log(`   Номинал: "${item.denomination}", Металл: ${item.metal}, Вес: ${item.weight}g`);
    console.log('');
});

console.log('📊 Статистика по категориям:');
const categoryStats = {};
testItems.forEach(item => {
    const category = classifyItem(item.description, item.denomination, item.metal, item.weight);
    categoryStats[category] = (categoryStats[category] || 0) + 1;
});

Object.entries(categoryStats)
    .sort(([,a], [,b]) => b - a)
    .forEach(([category, count]) => {
        console.log(`  ${category}: ${count} предметов`);
    });
