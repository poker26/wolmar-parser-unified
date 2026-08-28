'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    localAuctionNumber,
    parseCurrentAuctions,
    categorySlug,
    selectStandartCoinCategories,
} = require('../temporal/wolmar-auction-series');

test('discovers VIP and Standart auctions and namespaces Standart numbers', () => {
    const html = `
      <div class="dot_menu"><a href="/auction/2242">Аукцион VIP №1016</a></div>
      <div class="dot_menu"><a href="/auction/2241">Аукцион Standart №841</a></div>
      <footer><a href="/auction/2241">Аукцион Standart №841</a></footer>`;

    assert.deepEqual(parseCurrentAuctions(html), [
        { series: 'vip', wolmarId: '2242', displayNumber: '1016', auctionNumber: '1016' },
        { series: 'standart', wolmarId: '2241', displayNumber: '841', auctionNumber: 's841' },
    ]);
    assert.equal(localAuctionNumber('standard', 800), 's800');
});

test('recognizes category paths but rejects lot and image paths', () => {
    assert.equal(categorySlug('/auction/2147/monety-rsfsr-sssr-rossii', '2147'), 'monety-rsfsr-sssr-rossii');
    assert.equal(
        categorySlug('https://www.wolmar.ru/auction/2147/monety-inostrannye?sort=price', '2147'),
        'monety-inostrannye',
    );
    assert.equal(categorySlug('/auction/2147/7645602', '2147'), null);
    assert.equal(categorySlug('/auction/2147/7645602/1', '2147'), null);
    assert.equal(categorySlug('/auction/9999/monety-inostrannye', '2147'), null);
});

test('keeps only deduplicated Standart coin categories', () => {
    const categories = [
        { name: 'СССР', href: '/auction/2147/monety-rsfsr-sssr-rossii' },
        { name: 'СССР duplicate', href: '/auction/2147/monety-rsfsr-sssr-rossii' },
        { name: 'Иностранные', url: 'https://www.wolmar.ru/auction/2147/monety-inostrannye' },
        { name: 'Боны', href: '/auction/2147/bony' },
        { name: 'Лот', href: '/auction/2147/7645602' },
    ];

    assert.deepEqual(selectStandartCoinCategories(categories, '2147'), [
        {
            name: 'СССР',
            url: 'https://www.wolmar.ru/auction/2147/monety-rsfsr-sssr-rossii',
            slug: 'monety-rsfsr-sssr-rossii',
        },
        {
            name: 'Иностранные',
            url: 'https://www.wolmar.ru/auction/2147/monety-inostrannye',
            slug: 'monety-inostrannye',
        },
    ]);
});
