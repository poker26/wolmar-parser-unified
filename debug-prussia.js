#!/usr/bin/env node

const testName = "Монета Пруссии 1871 года";
const countries = ['СССР', 'РСФСР', 'Пруссия'];

console.log(`🔍 Отладка: "${testName}"`);
console.log(`Список стран: ${countries.join(', ')}`);

countries.forEach(country => {
    const found = testName.includes(country);
    console.log(`"${country}": ${found ? 'НАЙДЕНО' : 'НЕ НАЙДЕНО'}`);
});
