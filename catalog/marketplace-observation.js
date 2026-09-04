'use strict';

const AUCTION_TERMINAL = new Set(['OutOfStock', 'SoldOut', 'Discontinued']);
const MESHOK_ORIGIN = 'https://meshok.net';

function normalizeMeshokMode(mode, opt) {
    if (mode === true) return 'sold';
    if (mode === false) return 'active';
    const value = String(mode || '').toLowerCase();
    if (['sold', 'active', 'fixed'].includes(value)) return value;
    if (String(opt) === '3') return 'fixed';
    if (String(opt) === '1') return 'active';
    return 'sold';
}

function absoluteMeshokImageUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    if (/^\/i\/[^?#]+\.(?:jpe?g|png|webp)(?:\?.*)?$/i.test(value)) return `${MESHOK_ORIGIN}${value}`;
    if (/^https?:\/\/(?:www\.)?meshok\.net\/i\/[^?#]+\.(?:jpe?g|png|webp)(?:\?.*)?$/i.test(value)) return value;
    return null;
}

function meshokImageUrls(lot) {
    const pictures = Array.isArray(lot && lot.pictures) ? lot.pictures : [];
    return [...new Set(pictures.map((picture) =>
        absoluteMeshokImageUrl(picture && picture.url)
        || absoluteMeshokImageUrl(picture && picture.thumbnail && picture.thumbnail.x2)
        || absoluteMeshokImageUrl(picture && picture.thumbnail && picture.thumbnail.x1)
    ).filter(Boolean))];
}

function parseAuctionRuPage(html) {
    const availability = (html.match(/"availability":"[^"]*\/(InStock|OutOfStock|SoldOut|Discontinued)"/) || [])[1] || null;
    const priceMatch = (html.match(/"price"\s*:\s*"?(\d+)"?/) || [])[1];
    const title = ((html.match(/og:title"\s+content="([^"]*)"/) || [])[1] || '')
        .replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
    const hasBids = /bid">\s*\d/.test(html);
    const photos = [...new Set(
        [...html.matchAll(/https:\/\/static\.auction\.ru\/offer_images\/[^\s"'\\]+?\.jpe?g/g)].map((match) => match[0]),
    )];
    return { availability, price: priceMatch ? Number(priceMatch) : null, title, hasBids, nPhotos: photos.length, photos };
}

function isAuctionRuCardPage(html, parsed) {
    const documentTitle = ((String(html || '').match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim();
    const challenge = /just a moment|ddos-guard|attention required|checking your browser|проверка браузера/i.test(documentTitle);
    return !challenge && Boolean(parsed && parsed.title && (parsed.availability || parsed.photos?.length));
}

function classifyMeshokObservation({ mode, bidsCount, price, endDate, now = Date.now() }) {
    const nominalMode = mode === 'active' || mode === 'fixed' ? 'active' : 'ended';
    const stillRunning = nominalMode === 'ended' && endDate
        && new Date(endDate).getTime() > now;
    if (nominalMode === 'active' || stillRunning) {
        return { lotStatus: 'active', storedPrice: price || null, isSale: false };
    }
    const isSale = Number(bidsCount || 0) > 0;
    return {
        lotStatus: isSale ? 'sold' : 'ended_unsold',
        storedPrice: isSale ? (price || null) : null,
        isSale,
    };
}

function classifyAuctionRuObservation({ availability, hasBids, price }) {
    const terminal = AUCTION_TERMINAL.has(availability);
    const isSale = terminal && Boolean(hasBids) && Boolean(price);
    if (!terminal) return { lotStatus: 'active', storedPrice: price || null, isSale: false, terminal: false };
    return {
        lotStatus: isSale ? 'sold' : 'ended_unsold',
        storedPrice: isSale ? price : null,
        isSale,
        terminal: true,
    };
}

module.exports = {
    classifyAuctionRuObservation,
    classifyMeshokObservation,
    isAuctionRuCardPage,
    meshokImageUrls,
    normalizeMeshokMode,
    parseAuctionRuPage,
};
