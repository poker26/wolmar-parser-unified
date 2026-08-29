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

test('счёт монет словом — тоже набор', () => {
    // «Лот из 5 монет» ловилось, а «Лот из двух монет» нет: счёт бывает и словом.
    const isSet = (t) => parseTitle(t).isSet;
    assert.equal(isSet('Лот из двух монет. 15 и 10 копеек 1916 г.'), true);
    assert.equal(isSet('Лот из четырех монет. 20, 15, 2, 1 копейка 1946 г.'), true);
    assert.equal(isSet('Лот из трех монет. 20 копеек 1931 года.'), true);
    assert.equal(isSet('Лот из 5 монет СССР'), true);
    assert.equal(isSet('20 копеек 1931г. Ni.'), false);
});

test('номер по Биткину читается только когда он есть', () => {
    assert.equal(parseTitle('Полуполтинник 1770г. ММД ДМ. Ag. Биткин №# 638.147, тираж 780 000').bitkin, '638.147');
    assert.equal(parseTitle('5 рублей 1817 СПБ ФГ. Биткин №# 737.18').bitkin, '737.18');
    // «Биткин редкость - R» — оценка редкости, а не номер типа
    assert.equal(parseTitle('1 рубль 1817г. Ag. Биткин редкость - R').bitkin, null);
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

// ── Контракт с задачей качества связей (хендофф 28-29.08.2026) ─────────────────────────────────
// Каждый случай ниже — реальная неверная привязка с прода. Общее правило: воздержаться лучше, чем
// угадать, потому что неверная связь попадает в медиану цены и в оценку предмета коллекции.

const { matchType } = require('../catalog/coin-matcher');

// Заглушка базы. Матчер делает несколько разных запросов (словари стран, счётчики, кандидаты),
// поэтому отвечаем по смыслу запроса, а не одним списком на всё.
const stubPool = (candidates) => ({
    query: async (sql) => {
        const s = String(sql);
        if (/numis_country_map|numis_country_ru/.test(s)) return { rows: [] };          // словарей нет
        if (/count\(\*\)::int c FROM coin_type/.test(s)) return { rows: [{ c: 0 }] };    // счётчики
        if (/FROM coin_type/.test(s)) return { rows: candidates };                       // кандидаты
        return { rows: [] };
    },
});

test('единица номинала — жёсткий гейт даже при единственном кандидате', async () => {
    // «1/2 доллара. США 1972» садилось на «1/2 PENNY», «5 пенни. Финляндия» — на «5 MARKKAA».
    const pool = stubPool([{ id: 1, name_full: '1/2 PENNY. NY', denomination_text: '1/2 PENNY', metal: null, links: 0 }]);
    assert.equal(await matchType(pool, parseTitle('1/2 доллара. США 1972г. Cu-Ni.')), null);
});

test('одинаково подходящие РАЗНЫЕ сюжеты — воздержание', async () => {
    // «25 рублей. Оружие великой Победы 2019» одинаково похоже на всю серию: Кошкин, Дегтярёв,
    // Шпагин. Число проходов тут не аргумент — заголовок их не различает.
    const pool = stubPool([
        { id: 1, name_full: '25 рублей. Конструктор оружия М.И. Кошкин', theme_ru: '', metal: null, mint: 'ММД', links: 9 },
        { id: 2, name_full: '25 рублей. Конструктор оружия В.А. Дегтярёв', theme_ru: '', metal: null, mint: 'ММД', links: 1 },
    ]);
    assert.equal(await matchType(pool, parseTitle('25 рублей. Оружие великой Победы 2019г. ММД. Cu-Ni.')), null);
});

test('названный сюжет не даёт подставить тиражный тип', async () => {
    // Иначе generic «1 рубль 1990» собирает в одну ценовую корзину Чехова, Райниса и Чайковского.
    const pool = stubPool([
        { id: 1, name_full: '1 рубль', theme_ru: '', metal: null, mint: null, links: 40 },
        { id: 2, name_full: '1 рубль. Я. Райнис', theme_ru: '', metal: null, mint: null, links: 3 },
    ]);
    assert.equal(await matchType(pool, parseTitle('1 рубль 1990 года. А.П. Чехов. Медно-никелевый сплав')), null);
});

test('двор, названный в заголовке, отсекает чужой двор', async () => {
    // «3 рубля. Партизанское движение 1994 ММД» садилось на ленинградский тип.
    const pool = stubPool([
        { id: 1, name_full: '3 рубля. 50-летие разгрома немецко-фашистских войск', theme_ru: '', metal: null, mint: 'ЛМД', links: 12 },
    ]);
    assert.equal(await matchType(pool, parseTitle('3 рубля. Партизанское движение 1994г. ММД. Cu-Ni.')), null);
});

// ── Смешанные ценовые корзины (хендофф 29.08, разбор пилота s840) ──────────────────────────────
// Общее у этих случаев: идентичности монеты в каталоге НЕТ, поэтому единственный честный ответ —
// воздержаться. Иначе разные монеты одной серии складываются в одну корзину цен.

test('одинаковые имена типов ЦБ: город из заголовка не с чем сверить', async () => {
    // Вся серия городов-героев у ЦБ называется «2 рубля. 55-я годовщина Победы», записи отличаются
    // только двором. «Москва» и «Тула» в каталоге не различимы.
    const pool = stubPool([
        { id: 365, name_full: '2 рубля. 55-я годовщина Победы в Великой Отечественной войне', theme_ru: '', metal: null, mint: 'СПМД', links: 40 },
        { id: 367, name_full: '2 рубля. 55-я годовщина Победы в Великой Отечественной войне', theme_ru: '', metal: null, mint: 'ММД', links: 30 },
    ]);
    assert.equal(await matchType(pool, parseTitle('2 рубля. Москва. 55-я годовщина Победы 2000г. ММД.')), null);
});

test('сюжет типа противоречит сюжету лота', async () => {
    // «Бородино (барельеф)» и «обелиск» — разные монеты 1987 года.
    const pool = stubPool([
        { id: 45596, name_full: '1 рубль. 175 лет Бородино (барельеф)', theme_ru: '', metal: null, mint: null, links: 141 },
    ]);
    assert.equal(await matchType(pool, parseTitle('1 рубль 1987 года. 175 лет Бородино. Обелиск. Cu-Ni.')), null);
});

test('новодел не ложится на обычную монету', async () => {
    const pool = stubPool([
        { id: 45595, name_full: '1 рубль. 30 лет Победы в войне 1941-1945', theme_ru: '', metal: null, mint: null, links: 91 },
    ]);
    assert.equal(await matchType(pool, parseTitle('1 рубль 1975 года. 30 лет Победы. Новодел. Cu-Ni.')), null);
});

test('брак чекана — тоже разновидность', async () => {
    const pool = stubPool([
        { id: 536060, name_full: '10 рублей', theme_ru: 'обиходная монета', metal: null, mint: null, links: 12 },
    ]);
    assert.equal(await matchType(pool, parseTitle('10 рублей 2015 года. Соосность 90 градусов. Ст.')), null);
});
