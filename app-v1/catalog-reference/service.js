'use strict';

function numericPriceMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
        .map(([grade, amount]) => [String(grade), Number(amount)])
        .filter(([, amount]) => Number.isSafeInteger(amount) && amount >= 0));
}

const CIRCULATED_BASIS_ORDER = [
    'XF40', 'XF', 'XF45',
    'VF20', 'VF',
    'F12', 'F',
    'VG8', 'VG',
    'G4', 'GOOD',
    'AU50', 'AU',
];

function selectCirculatedBasis(prices) {
    return CIRCULATED_BASIS_ORDER.find((grade) => Object.hasOwn(prices, grade)) || null;
}

function krauseReferenceFromIssue(row, pricesValue = row?.catalog_prices) {
    if (!row?.catalog_issue_id && !row?.issue_id) return null;
    const prices = numericPriceMap(pricesValue);
    const basisGradeCode = selectCirculatedBasis(prices);
    const mintStatePrices = Object.entries(prices)
        .filter(([grade]) => /^MS\d{2}/i.test(grade) || ['MS', 'UNC', 'BU'].includes(grade))
        .map(([, amount]) => amount);
    return {
        source: row.catalog_issue_source || row.source || 'scwc',
        issueId: Number(row.catalog_issue_id || row.issue_id),
        year: row.catalog_issue_year ?? row.year ?? null,
        yearLabel: row.catalog_issue_year_label ?? row.year_label ?? null,
        mint: row.catalog_issue_mint ?? row.mint ?? null,
        variety: row.catalog_issue_variety ?? row.variety ?? null,
        mintage: row.catalog_issue_mintage == null && row.mintage == null
            ? null
            : Number(row.catalog_issue_mintage ?? row.mintage),
        currency: 'USD',
        basisGradeCode,
        basisAmountMinor: basisGradeCode ? prices[basisGradeCode] : null,
        uncirculatedLowMinor: mintStatePrices.length ? Math.min(...mintStatePrices) : null,
        uncirculatedHighMinor: mintStatePrices.length ? Math.max(...mintStatePrices) : null,
        prices,
        refPdfSrc: row.catalog_issue_ref_pdf_src ?? row.ref_pdf_src ?? null,
        refPdfPage: row.catalog_issue_ref_pdf_page ?? row.ref_pdf_page ?? null,
    };
}

function krauseRangeFromIssues(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const references = rows.map((row) => krauseReferenceFromIssue(row));
    if (references.some((reference) => !reference?.basisGradeCode || reference.basisAmountMinor == null)) {
        return null;
    }
    const basisGrades = new Set(references.map((reference) => reference.basisGradeCode));
    if (basisGrades.size !== 1) return null;
    const amounts = references.map((reference) => reference.basisAmountMinor);
    return {
        source: references[0].source,
        year: references[0].year,
        currency: references[0].currency,
        variantCount: references.length,
        basisGradeCode: references[0].basisGradeCode,
        lowMinor: Math.min(...amounts),
        highMinor: Math.max(...amounts),
    };
}

async function enrichIdentificationCandidates(pool, identification) {
    if (!pool || !identification?.extracted?.year || !identification.candidates.length) return identification;
    const typeIds = identification.candidates.map((candidate) => candidate.id);
    const result = await pool.query(
        `SELECT issue.type_id,
                issue.id issue_id,
                issue.year,
                issue.year_label,
                issue.mint,
                issue.variety,
                issue.mintage,
                issue.source,
                issue.ref_pdf_src,
                issue.ref_pdf_page,
                COALESCE(
                    jsonb_object_agg(price.grade_code, price.amount_minor)
                        FILTER (WHERE price.grade_code IS NOT NULL),
                    '{}'::jsonb
                ) catalog_prices
         FROM catalog_issue issue
         LEFT JOIN catalog_issue_price price
           ON price.issue_id = issue.id
          AND price.price_kind = 'grade'
          AND price.grade_code IS NOT NULL
         WHERE issue.type_id = ANY($1::int[])
           AND issue.year = $2
         GROUP BY issue.id
         ORDER BY issue.type_id, issue.id`,
        [typeIds, identification.extracted.year],
    );
    const byType = new Map();
    for (const row of result.rows) {
        const rows = byType.get(row.type_id) || [];
        rows.push(row);
        byType.set(row.type_id, rows);
    }
    const wantedMint = String(identification.extracted.mint || '').trim().toLocaleLowerCase('ru');
    const candidates = identification.candidates.map((candidate) => {
        const issues = byType.get(candidate.id) || [];
        let matches = issues;
        if (issues.length > 1 && wantedMint) {
            const mintMatches = issues.filter((issue) => String(issue.mint || '').trim().toLocaleLowerCase('ru') === wantedMint);
            if (mintMatches.length) matches = mintMatches;
        }
        const exact = matches.length === 1 ? matches[0] : null;
        const range = !exact && matches.length > 1 ? krauseRangeFromIssues(matches) : null;
        return {
            ...candidate,
            issueId: exact ? Number(exact.issue_id) : null,
            issueYear: identification.extracted.year,
            issueMatch: exact ? 'exact' : (issues.length ? 'ambiguous' : 'not_found'),
            krauseReference: exact ? krauseReferenceFromIssue(exact) : null,
            krauseRange: range,
        };
    });
    return { ...identification, candidates };
}

module.exports = {
    enrichIdentificationCandidates,
    krauseReferenceFromIssue,
    numericPriceMap,
    selectCirculatedBasis,
    krauseRangeFromIssues,
};
