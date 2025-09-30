#!/usr/bin/env node

// Тестируем новую логику определения России
function parseLotDescription(description) {
    const result = {
        denomination: '1',
        coin_name: '',
        year: null,
        metal: '',
        rarity: '',
        mint: '',
        mintage: null,
        condition: '',
        country: null,
        bitkin_info: '',
        uzdenikov_info: '',
        ilyin_info: '',
        petrov_info: '',
        severin_info: '',
        dyakov_info: '',
        kazakov_info: '',
        coin_weight: null,
        fineness: null,
        pure_metal_weight: null,
        weight_oz: null
    };

    // Извлекаем номинал
    const denominationMatch = description.match(/^(\d+(?:\.\d+)?)/);
    if (denominationMatch) {
        result.denomination = denominationMatch[1];
    } else {
        result.denomination = "1";
    }

    // Извлекаем металл
    const metalMatch = description.match(/\b(Ag|Au|Cu|Br|Ni|Fe|Pb|Sn|Zn|Pt|Pd)\b/);
    if (metalMatch) {
        result.metal = metalMatch[1];
    }

    // Определяем страну по номиналу (Россия для рублей и копеек)
    if (description.match(/(рублей?|копеек?|руб\.?|коп\.?)/i)) {
        result.country = 'Россия';
        console.log(`🇷🇺 Определена страна: Россия для "${description}"`);
    }

    return result;
}

// Тестовые описания
const testDescriptions = [
    "10 рублей. Грозный - Грозный. Брак Fe 5,73. | Магнитная. Гурт рубчатый.",
    "15 копеек СПБ НI. Ag. | 1866-1877 гг.",
    "20 копеек 1771 года",
    "25 копеек 1828 года",
    "10000 рублей 2003 года",
    "2 копейки Cu. | 1811-1829 гг",
    "10 букш. Йемен Ag.",
    "20 центов. Китай Ag.",
    "2 шу. Япония Au. | 8"
];

console.log('🔍 Тестирование определения России по номиналу...\n');

testDescriptions.forEach((desc, index) => {
    console.log(`${index + 1}. "${desc}"`);
    const result = parseLotDescription(desc);
    console.log(`   Страна: ${result.country || 'не определена'}`);
    console.log(`   Номинал: ${result.denomination}, Металл: ${result.metal}`);
    console.log('');
});
