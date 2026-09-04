'use strict';

const AUCTION_TERMINAL = new Set(['OutOfStock', 'SoldOut', 'Discontinued']);

function classifyMeshokObservation({ mode, bidsCount, price, endDate, now = Date.now() }) {
    const nominalMode = mode === 'active' ? 'active' : 'ended';
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

module.exports = { classifyMeshokObservation, classifyAuctionRuObservation };
