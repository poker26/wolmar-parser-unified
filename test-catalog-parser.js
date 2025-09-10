const CatalogParser = require('./catalog-parser');

// Создаем экземпляр парсера без инициализации базы данных
const parser = new CatalogParser();

// Тестируем парсер
console.log('=== Тестирование парсера каталога ===\n');

const testDescription = "Альбертусталер 1753г. Ag. RR, Ильин - 15 рублей, Петров - 30 рублей | В слабе NRG. Привлекательный экземпляр в отличной кондиции, редкость на рынке. Мангеймский монетный двор. Биткин редкость - R1, №# 628.61, тираж 1 043, Уздеников редкость - \"точка с чертой\", №# 4922, Ильин - 15 рублей, Петров - 30 рублей, Северин - \"черта\" # 1890, Дьяков# 46 (R1)";

console.log('Исходное описание:');
console.log(testDescription);
console.log('\n' + '='.repeat(80) + '\n');

const result = parser.parseLotDescription(testDescription);

console.log('Результат парсинга:');
console.log(JSON.stringify(result, null, 2));

console.log('\n' + '='.repeat(80) + '\n');

// Тестируем еще несколько примеров
const testCases = [
    "1 рубль 1898г. Ag. R, Биткин - 25 рублей, Уздеников - 30 рублей",
    "5 копеек 1924г. Cu. RR, тираж 50 000, Ленинградский монетный двор",
    "Полтина 1701г. Ag. RRR, Биткин - 100 рублей, Петров - 150 рублей",
    "Денга 1720г. Cu, Биткин - 10 рублей, Уздеников - 15 рублей, тираж 1 000 000"
];

console.log('Дополнительные тесты:');
testCases.forEach((testCase, index) => {
    console.log(`\nТест ${index + 1}:`);
    console.log('Описание:', testCase);
    const parsed = parser.parseLotDescription(testCase);
    console.log('Результат:', JSON.stringify(parsed, null, 2));
    console.log('-'.repeat(60));
});
