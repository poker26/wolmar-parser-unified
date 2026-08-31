'use strict';

const CIRCULATION_GRADE_RANK = new Map([
    ['AG3', 10], ['G4', 20], ['VG', 30], ['VG8', 30], ['F', 40], ['F12', 40],
    ['VF', 50], ['VF20', 50], ['XF', 60], ['XF40', 60], ['AU', 70], ['AU50', 70],
    ['UNC', 80], ['MS60', 80], ['MS63', 83], ['MS65', 85], ['BU', 90],
]);

function normalizeGradeLabel(value) {
    return String(value || '').trim().toUpperCase().replaceAll(' ', '');
}

function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((left, right) => left - right);
    const middle = sorted.length >> 1;
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function issueList(value) {
    return Array.isArray(value) ? value.filter((issue) => issue && typeof issue === 'object') : [];
}

function numericPrice(value) {
    return typeof value === 'number' ? value : parseFloat(value);
}

function finitePriceEntries(prices, { positiveOnly = false } = {}) {
    if (!prices || typeof prices !== 'object' || Array.isArray(prices)) return [];
    return Object.entries(prices)
        .map(([grade, value]) => ({ grade, normalizedGrade: normalizeGradeLabel(grade), value: numericPrice(value) }))
        .filter(({ value }) => Number.isFinite(value) && (!positiveOnly || value > 0));
}

function aggregateReferencePrices(issues) {
    const byGrade = new Map();
    for (const issue of issueList(issues)) {
        for (const entry of finitePriceEntries(issue.prices)) {
            const values = byGrade.get(entry.grade) || [];
            values.push(entry.value);
            byGrade.set(entry.grade, values);
        }
    }
    return [...byGrade.entries()].map(([grade, values]) => ({
        grade,
        usd: Math.round(median(values) * 100) / 100,
        n: values.length,
    }));
}

function referencePriceForGrade(issues, aliases) {
    const normalizedAliases = aliases.map(normalizeGradeLabel);
    const allEntries = issueList(issues).flatMap((issue) => (
        finitePriceEntries(issue.prices, { positiveOnly: true })
    ));
    for (const alias of normalizedAliases) {
        const values = allEntries
            .filter(({ normalizedGrade }) => normalizedGrade === alias)
            .map(({ value }) => value);
        if (values.length) return { grade: alias, usd: median(values), n: values.length };
    }
    return null;
}

function monotonicViolations(entries) {
    const ranked = entries
        .map((entry) => ({
            grade: entry.normalizedGrade ?? normalizeGradeLabel(entry.grade),
            price: Number(entry.value ?? entry.usd),
            rank: CIRCULATION_GRADE_RANK.get(entry.normalizedGrade ?? normalizeGradeLabel(entry.grade)),
        }))
        .filter(({ rank, price }) => rank != null && Number.isFinite(price) && price > 0)
        .sort((left, right) => left.rank - right.rank || left.grade.localeCompare(right.grade));
    const violations = [];
    let maximum = null;
    for (const current of ranked) {
        if (maximum && current.rank > maximum.rank && current.price < maximum.price) {
            violations.push({ lower: maximum, higher: current });
        }
        if (!maximum || current.price > maximum.price) maximum = current;
    }
    return violations;
}

function analyzeKrauseReference(issues) {
    const normalizedIssues = issueList(issues);
    const aggregate = aggregateReferencePrices(normalizedIssues);
    const issueViolations = [];
    let pricedIssueCount = 0;
    let invalidPriceCount = 0;
    for (const [index, issue] of normalizedIssues.entries()) {
        const rawPrices = issue.prices && typeof issue.prices === 'object' && !Array.isArray(issue.prices)
            ? Object.values(issue.prices)
            : [];
        invalidPriceCount += rawPrices.filter((value) => !Number.isFinite(numericPrice(value)) || numericPrice(value) < 0).length;
        const entries = finitePriceEntries(issue.prices, { positiveOnly: true });
        if (entries.length) pricedIssueCount += 1;
        const violations = monotonicViolations(entries);
        if (violations.length) issueViolations.push({ index, violations });
    }
    const aggregateViolations = monotonicViolations(aggregate);
    const xf = referencePriceForGrade(normalizedIssues, ['XF40', 'XF']);
    return {
        issueCount: normalizedIssues.length,
        pricedIssueCount,
        invalidPriceCount,
        aggregate,
        xf,
        issueViolations,
        aggregateViolations,
        usableXf: xf != null
            && invalidPriceCount === 0
            && issueViolations.length === 0
            && aggregateViolations.length === 0,
    };
}

module.exports = {
    aggregateReferencePrices,
    analyzeKrauseReference,
    finitePriceEntries,
    median,
    monotonicViolations,
    normalizeGradeLabel,
    referencePriceForGrade,
};
