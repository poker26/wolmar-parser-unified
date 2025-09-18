// Простой тест функции извлечения состояний из wolmar-parser5.js

// Функция извлечения состояния с градацией (из wolmar-parser5.js)
function extractConditionWithGrade(conditionText) {
    if (!conditionText) return null;
    return conditionText.replace(/\s+/g, '');
}

// Тестовые данные
const testConditions = [
    "MS 61",
    "PF 70 ULTRA CAMEO", 
    "AU 55",
    "XF 45",
    "VF 30",
    "MS 64RB",
    "PF 63RB",
    "AU 58",
    "UNC",
    "MS",
    "PF",
    "AU",
    "XF",
    "VF",
    "PL",
    "PR",
    "F",
    "Proof",
    "Gem",
    "XX",
    "MS 62 BN",
    "PF 65 CAMEO",
    "AU 53",
    "XF 40",
    "VF 20",
    "MS 67",
    "PF 69 ULTRA CAMEO",
    "AU 50",
    "XF 35",
    "VF 25"
];

console.log('🧪 ТЕСТИРОВАНИЕ ФУНКЦИИ ИЗВЛЕЧЕНИЯ СОСТОЯНИЙ:');
console.log('='.repeat(60));

testConditions.forEach((condition, index) => {
    const processed = extractConditionWithGrade(condition);
    console.log(`${index + 1}. "${condition}" -> "${processed}"`);
});

console.log('\n✅ Тест функции извлечения состояний завершен!');
