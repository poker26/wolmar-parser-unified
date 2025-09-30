#!/usr/bin/env node

const testName = "Монета Пруссии 1871 года";

console.log(`🔍 Детальная отладка: "${testName}"`);
console.log(`Длина строки: ${testName.length}`);
console.log(`Коды символов:`);
for (let i = 0; i < testName.length; i++) {
    console.log(`  ${i}: "${testName[i]}" (код: ${testName.charCodeAt(i)})`);
}

console.log(`\nПоиск "Пруссия":`);
const prussiaIndex = testName.indexOf('Пруссия');
console.log(`Индекс: ${prussiaIndex}`);

console.log(`\nПоиск "Прус":`);
const prusIndex = testName.indexOf('Прус');
console.log(`Индекс: ${prusIndex}`);


