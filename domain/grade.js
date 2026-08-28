'use strict';

const GRADE_ALIASES = new Map([
    ['PROOF', 'PF'],
    ['ПРУФ', 'PF'],
    ['АНЦ', 'UNC'],
    ['AUNC', 'AU/UNC'],
]);

function normalizeGrade(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().normalize('NFKC').toUpperCase().replace(/\s+/g, '');
    if (!normalized) return null;
    return GRADE_ALIASES.get(normalized) || normalized;
}

module.exports = { normalizeGrade };
