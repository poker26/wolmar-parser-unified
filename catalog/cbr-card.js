'use strict';

function decodeHtml(value) {
    const named = {
        amp: '&', apos: "'", gt: '>', laquo: '«', lt: '<', nbsp: ' ', quot: '"', raquo: '»',
    };
    return String(value || '')
        .replace(/&#(x[0-9a-f]+|\d+);/giu, (_, code) => {
            const point = code[0].toLowerCase() === 'x'
                ? Number.parseInt(code.slice(1), 16)
                : Number.parseInt(code, 10);
            return Number.isSafeInteger(point) ? String.fromCodePoint(point) : ' ';
        })
        .replace(/&([a-z]+);/giu, (_, name) => named[name.toLowerCase()] ?? ' ');
}

function cardText(html) {
    return decodeHtml(String(html || '')
        .replace(/<script\b[\s\S]*?<\/script>/giu, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/giu, ' ')
        .replace(/<[^>]*>/gu, ' '))
        .replace(/\s+/gu, ' ')
        .trim();
}

function parseCbrCardMetadata(html) {
    const text = cardText(html);
    const dateMatch = text.match(/дата\s+выпуска\s+(\d{2})\.(\d{2})\.(\d{4})/iu);
    const issueDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;
    const coinYears = [...text.matchAll(
        /(?:дата|год)\s+выпуска(?:\s+монеты)?\s*[:—-]?\s*["«„]?\s*(1[5-9]\d{2}|20[0-3]\d)(?:\s*г\.?)?/giu,
    )].map((match) => Number(match[1]));
    const obverse = text.match(/(?:^|\s)аверс\s+([\s\S]*?)\s+реверс(?:\s|$)/iu)?.[1] || '';
    const obverseYears = [...obverse.matchAll(/(?<!\d)(1[5-9]\d{2}|20[0-3]\d)(?!\d)/gu)]
        .map((match) => Number(match[1]));
    return {
        issueDate,
        issueYear: issueDate ? Number(issueDate.slice(0, 4)) : null,
        coinYear: coinYears[0] ?? obverseYears[0] ?? null,
    };
}

module.exports = { cardText, decodeHtml, parseCbrCardMetadata };
