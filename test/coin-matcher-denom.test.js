'use strict';

// Регрессии разбора номинала. Каждый случай здесь — уже случившаяся на проде ошибка, а не
// гипотеза: дробь читалась знаменателем, зазывалка ставки и оценка по справочнику принимались
// за номинал, у памятных монет годом чеканки становилась историческая дата.

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseDenom, parseTitle } = require('../catalog/coin-matcher');

test('дробный номинал читается дробью, а не знаменателем', () => {
    // Обычная регулярка ищет «число + единица» где угодно в строке и выхватывала из «1/2 копейки»
    // знаменатель — получался номинал вчетверо крупнее, и лот уходил на тип «2 копейки».
    assert.deepEqual(
        { num: parseDenom('1/2 копейки 1840г. ЕМ. Cu.').num, value: parseDenom('1/2 копейки 1840г. ЕМ. Cu.').value },
        { num: 0.5, value: 0.005 });
    assert.deepEqual(
        { num: parseDenom('1/4 копейки 1869г. СПБ. Cu.').num, value: parseDenom('1/4 копейки 1869г. СПБ. Cu.').value },
        { num: 0.25, value: 0.0025 });
    assert.equal(parseDenom('1/2 доллара 1964').value, 0.5);
    assert.equal(parseDenom('3/4 рубля 1758').value, 0.75);
    // целый номинал остаётся целым
    assert.equal(parseDenom('2 копейки 1840').value, 0.02);
});

test('цена по справочнику и стартовая ставка не подменяют номинал', () => {
    assert.equal(parseDenom('1/2 копейки 1840г. ЕМ. Cu. Петров - 1,5 рубля.').value, 0.005);
    assert.equal(parseDenom('Полуполтинник 1770г. ММД ДМ. Ag. Петров - 1,25 рубля.').value, 0.25);
    // «С 1 рубля» и «От 1 рубля» — зазывалка аукциона, а не номинал иностранной монеты
    assert.equal(parseTitle('Замбия 1 квача 2017 года. С 1 рубля.').denom.isRf, false);
    assert.equal(parseTitle('США. 1 цент. 1942 г От 1 рубля!!!!').denom.isRf, false);
});

test('словесный номинал распознаётся', () => {
    assert.equal(parseDenom('Полтинник 1924г. ПЛ. Ag.').value, 0.5);
    assert.equal(parseDenom('Полуполтинник 1770г. ММД ДМ.').value, 0.25);
    assert.equal(parseDenom('Полушка 1735г.').value, 0.0025);
    assert.equal(parseDenom('Гривенник 1746').value, 0.1);
});

test('год чеканки не путается с исторической датой', () => {
    assert.equal(parseTitle('3 рубля. Северный конвой. 1941-1945 гг. 1992г. ЛМД. Cu-Ni.').year, 1992);
    assert.equal(parseTitle('10 рублей 2019 75 лет Победы 1941-1945').year, 2019);
    assert.equal(parseTitle('20 копеек 1975г. Cu-Ni.').year, 1975);
});

test('монеты отделяются от бумаги, наборов и сувениров', () => {
    const coin = (t) => { const p = parseTitle(t); return !p.isNonCoin && !p.isSet; };
    assert.equal(coin('2 марки 1934. Германия. DNC MS66. С рубля!'), true, 'номинал в марках — монета');
    assert.equal(coin('25 рублей. Казань-Верона 2013г. Ag. | С сертификатом.'), true, 'сертификат лежит рядом с монетой');
    assert.equal(coin('Монета Малави 20 квача 2010 год.(Лот Ф576)'), true, '«Лот» — номер лота продавца');
    assert.equal(coin('25 РУБЛЕЙ 2025 ЦВЕТНЫЕ ТИРАЖ - 50 000 шт'), true, 'тираж — не набор');
    assert.equal(coin('100 рублей. РСФСР 1923г. Бумага.'), false);
    assert.equal(coin('Бона 5 рублей'), false);
    assert.equal(coin('Лот из 5 монет СССР'), false);
    assert.equal(coin('Бутылка-копилка, 10 копеек 1961-1991гг'), false);
});
