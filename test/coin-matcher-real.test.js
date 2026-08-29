'use strict';

// Регрессии на НАСТОЯЩИХ заголовках с прода — по контракту смежной задачи: тесты должны проходить
// тем же путём, что и живые строки, вместе с их пунктуацией и порядком слов. Фикстура
// test/fixtures-real-titles.json снята с прода: заголовок лота, реальные кандидаты того же
// номинала и года и ожидаемое решение. Заглушка отвечает по смыслу запроса, поэтому матчер
// работает ровно как на проде, но без базы.

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseTitle, matchType } = require('../catalog/coin-matcher');
const CASES = require('./fixtures-real-titles.json');

// Словари стран собираем из самих фикстур: у матчера они кешируются на модуль, поэтому заглушка
// должна отвечать одинаково для всех случаев файла, а не для первого попавшегося.
const ALL_COUNTRIES = [...new Set(CASES.flatMap((c) => c.candidates.map((x) => x.country).filter(Boolean)))];
const RU_NAMES = { 'Netherlands East Indies': ['Нидерландская Индия'] };

const stubPool = (candidates, bitkin = null) => ({
    query: async (sql, args) => {
        const s = String(sql);
        // Отдельная ветка матчера ищет тип по номеру Биткина вместе с номиналом и двором.
        // Заглушка условий WHERE не понимает, поэтому фильтр по номеру повторяем здесь.
        if (/bitkin_number=/.test(s)) {
            return { rows: candidates.filter((c) => bitkin && String(c.bitkin_number || '') === String(bitkin)) };
        }
        if (/FROM numis_country_map/.test(s)) return { rows: [] };
        if (/FROM numis_country_ru/.test(s)) {
            return { rows: ALL_COUNTRIES.map((country) => ({ country, ru: RU_NAMES[country] || [] })) };
        }
        if (/GROUP BY/.test(s) && /FROM coin_type/.test(s)) {
            return { rows: ALL_COUNTRIES.map((country) => ({ country, c: 10 })) };
        }
        if (/count\(\*\)::int c FROM coin_type/.test(s)) return { rows: [{ c: candidates.length }] };
        if (/FROM coin_type/.test(s)) return { rows: candidates };
        return { rows: [] };
    },
});

// В иностранной ветке отбор по номиналу делает SQL, а заглушка условий WHERE не понимает.
// Повторяем ровно его: ведущее число (для дроби — как она напечатана) в начале denomination_text.
const byDenom = (cands, p) => {
    if (!p.denom || p.denom.isRf) return cands;
    const lead = p.denom.fraction && p.denom.raw ? p.denom.raw : String(p.denom.num);
    const re = new RegExp('^' + lead.replace(/[.\/]/g, (m) => '\\' + m) + '([^0-9]|$)', 'i');
    const hit = cands.filter((c) => re.test(String(c.denomination_text || '')));
    return hit.length ? hit : cands;
};

for (const c of CASES) {
    const short = c.title.replace(/\s+/g, ' ').slice(0, 56);
    test(`лот ${c.lot}: ${short}`, async () => {
        const p = parseTitle(c.title);
        const r = await matchType(stubPool(byDenom(c.candidates, p), p.bitkin), p);
        if (c.expect === null) assert.equal(r, null, 'ожидалось воздержание');
        else {
            assert.ok(r, 'ожидалась привязка, получено воздержание');
            assert.equal(r.id, c.expect);
        }
    });
}
