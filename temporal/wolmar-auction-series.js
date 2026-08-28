'use strict';

const SERIES = Object.freeze({
    vip: Object.freeze({ key: 'vip', label: 'VIP', auctionPrefix: '' }),
    standart: Object.freeze({ key: 'standart', label: 'Standart', auctionPrefix: 's' }),
});

const STANDART_COIN_CATEGORY_SLUGS = new Set([
    'monety-antika-srednevekove',
    'dopetrovskie-monety',
    'monety-rossii-do-1917-zoloto',
    'monety-rossii-do-1917-serebro',
    'monety-rossii-do-1917-med',
    'monety-rsfsr-sssr-rossii',
    'monety-inostrannye',
]);

function normalizeSeries(value) {
    const key = String(value || 'vip').trim().toLowerCase();
    if (key === 'standard') return 'standart';
    if (!SERIES[key]) throw new Error(`Unknown Wolmar auction series: ${value}`);
    return key;
}

function localAuctionNumber(series, displayNumber) {
    const key = normalizeSeries(series);
    const number = String(displayNumber || '').trim();
    if (!/^\d+$/.test(number)) throw new Error(`Invalid Wolmar auction number: ${displayNumber}`);
    return `${SERIES[key].auctionPrefix}${number}`;
}

function parseCurrentAuctions(html) {
    const source = String(html || '');
    const menuBlocks = [...source.matchAll(/<div\s+class=["'][^"']*\bdot_menu\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
        .map((match) => match[1]);
    const currentArea = menuBlocks.length ? menuBlocks.join('\n') : source;
    const found = [];
    const seen = new Set();
    const pattern = /href=["']\/auction\/(\d+)["'][^>]*>\s*Аукцион\s+(VIP|Standart)\s*№\s*(\d+)\s*</gi;
    let match;
    while ((match = pattern.exec(currentArea)) !== null) {
        const series = match[2].toLowerCase() === 'vip' ? 'vip' : 'standart';
        const key = `${series}:${match[1]}:${match[3]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({
            series,
            wolmarId: match[1],
            displayNumber: match[3],
            auctionNumber: localAuctionNumber(series, match[3]),
        });
    }
    return found;
}

function categorySlug(href, wolmarId) {
    const match = String(href || '').match(new RegExp(`^/auction/${String(wolmarId)}/([^/?#]+)(?:[?#].*)?$`));
    if (!match || /^\d+$/.test(match[1])) return null;
    return match[1];
}

function selectStandartCoinCategories(categories, wolmarId) {
    const selected = [];
    const seen = new Set();
    for (const category of categories || []) {
        const href = category && (category.url || category.href);
        const slug = categorySlug(href, wolmarId);
        if (!slug || !STANDART_COIN_CATEGORY_SLUGS.has(slug) || seen.has(slug)) continue;
        seen.add(slug);
        selected.push({
            name: String(category.name || '').trim(),
            url: String(href).startsWith('http') ? String(href) : `https://www.wolmar.ru${href}`,
            slug,
        });
    }
    return selected;
}

module.exports = {
    SERIES,
    STANDART_COIN_CATEGORY_SLUGS,
    normalizeSeries,
    localAuctionNumber,
    parseCurrentAuctions,
    categorySlug,
    selectStandartCoinCategories,
};
