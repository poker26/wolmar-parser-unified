'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    extractSlabInfo,
    normalizeGradingCompany,
    normalizeSlabInfo,
} = require('../domain/slab-info');

test('grading-company normalizer preserves source spelling and maps RFC aliases', () => {
    assert.deepEqual(normalizeGradingCompany(' ННР '), {
        gradingCompanyCode: 'NNR',
        gradingCompanyRaw: 'ННР',
    });
    assert.deepEqual(normalizeGradingCompany('H.H.P.'), {
        gradingCompanyCode: 'NNR',
        gradingCompanyRaw: 'H.H.P.',
    });
    assert.equal(normalizeGradingCompany('NGС').gradingCompanyCode, 'NGC');
    assert.equal(normalizeGradingCompany('PСGS').gradingCompanyCode, 'PCGS');
    assert.equal(normalizeGradingCompany('РCGS').gradingCompanyCode, 'PCGS');
    assert.equal(normalizeGradingCompany('РCGС').gradingCompanyCode, 'PCGS');
    assert.equal(normalizeGradingCompany('PCGС').gradingCompanyCode, 'PCGS');
    assert.equal(normalizeGradingCompany('РСGS').gradingCompanyCode, 'PCGS');
    assert.equal(normalizeGradingCompany('HHР').gradingCompanyCode, 'NNR');
    assert.deepEqual(normalizeGradingCompany('РНГА'), {
        gradingCompanyCode: 'RNGA',
        gradingCompanyRaw: 'РНГА',
    });
    assert.deepEqual(normalizeGradingCompany('new holder co'), {
        gradingCompanyCode: 'OTHER',
        gradingCompanyRaw: 'new holder co',
    });
    assert.deepEqual(normalizeGradingCompany(null), {
        gradingCompanyCode: null,
        gradingCompanyRaw: null,
    });
});

test('unknown slab status is the default and never implies raw', () => {
    assert.deepEqual(normalizeSlabInfo(), {
        slabStatus: 'unknown',
        gradingCompanyCode: null,
        gradingCompanyRaw: null,
        gradeCode: null,
        gradeSource: 'unknown',
    });
});

test('raw and unknown statuses cannot retain a grading company', () => {
    assert.deepEqual(normalizeSlabInfo({
        slabStatus: 'raw',
        gradingCompanyRaw: 'NGC',
        gradeCode: 'XF',
        gradeSource: 'user',
    }), {
        slabStatus: 'raw',
        gradingCompanyCode: null,
        gradingCompanyRaw: null,
        gradeCode: 'XF',
        gradeSource: 'user',
    });
});

test('slab label grade requires an explicitly slabbed specimen', () => {
    assert.throws(
        () => normalizeSlabInfo({
            slabStatus: 'unknown',
            gradeCode: 'MS65',
            gradeSource: 'slab_label',
        }),
        /requires slabStatus slabbed/,
    );

    assert.deepEqual(normalizeSlabInfo({
        slabStatus: 'slabbed',
        gradingCompanyRaw: 'ngc',
        gradingCompanyCode: 'NGC',
        gradeCode: 'ms65',
        gradeSource: 'slab_label',
    }), {
        slabStatus: 'slabbed',
        gradingCompanyCode: 'NGC',
        gradingCompanyRaw: 'ngc',
        gradeCode: 'MS65',
        gradeSource: 'slab_label',
    });
});

test('conflicting raw and canonical company values are rejected', () => {
    assert.throws(
        () => normalizeSlabInfo({
            slabStatus: 'slabbed',
            gradingCompanyRaw: 'PCGS',
            gradingCompanyCode: 'NGC',
        }),
        /conflicts/,
    );
});

test('extractor reads a company and grade only from explicit slab context', () => {
    assert.deepEqual(extractSlabInfo({
        description: '5 рублей 1898 года. В слабе ННР MS65. Редкий год.',
        condition: 'AU',
    }), {
        slabStatus: 'slabbed',
        gradingCompanyCode: 'NNR',
        gradingCompanyRaw: 'ННР',
        gradeCode: 'MS65',
        gradeSource: 'slab_label',
        extractorVersion: 'slab-info-v1',
        evidenceText: '5 рублей 1898 года. В слабе ННР MS65. Редкий год.',
    });
});

test('extractor accepts certificate context but rejects a lone company token', () => {
    const certified = extractSlabInfo({
        description: 'Russia 1 rouble, PCGS MS64, cert. 12345678',
    });
    assert.equal(certified.slabStatus, 'slabbed');
    assert.equal(certified.gradingCompanyCode, 'PCGS');
    assert.equal(certified.gradeCode, 'MS64');
    assert.equal(certified.gradeSource, 'slab_label');

    assert.deepEqual(extractSlabInfo({
        description: 'Редкая монета, аналог отмечен в каталоге NGC',
        condition: 'MS65',
    }), {
        slabStatus: 'unknown',
        gradingCompanyCode: null,
        gradingCompanyRaw: null,
        gradeCode: 'MS65',
        gradeSource: 'auction_house',
        extractorVersion: 'slab-info-v1',
        evidenceText: null,
    });
});

test('an unknown explicit holder company is retained as OTHER for audit', () => {
    const result = extractSlabInfo({
        description: '10 рублей 1904 года. В слабе ANACS. Состояние отличное.',
        condition: 'MS64',
    });
    assert.equal(result.slabStatus, 'slabbed');
    assert.equal(result.gradingCompanyCode, 'OTHER');
    assert.equal(result.gradingCompanyRaw, 'ANACS');
    assert.equal(result.gradeSource, 'auction_house');
});

test('a generic slab mention without a company does not capture the next sentence', () => {
    const result = extractSlabInfo({
        description: '5 копеек 1891 года. В слабе. Санкт-Петербургский монетный двор.',
        condition: 'MS60',
    });
    assert.equal(result.slabStatus, 'slabbed');
    assert.equal(result.gradingCompanyCode, null);
    assert.equal(result.gradingCompanyRaw, null);
});

test('grade abbreviations after a slab mention are not treated as companies', () => {
    for (const grade of ['MS', 'MS65', 'PF', 'UNC', 'AU']) {
        const result = extractSlabInfo({ description: `В слабе ${grade}` });
        assert.equal(result.gradingCompanyCode, null, grade);
    }
});

test('a grade before slab evidence is not misread from the holder label', () => {
    const result = extractSlabInfo({
        description: 'Состояние XF. В слабе NGC, номер не указан.',
        condition: 'XF',
    });
    assert.equal(result.slabStatus, 'slabbed');
    assert.equal(result.gradingCompanyCode, 'NGC');
    assert.equal(result.gradeCode, 'XF');
    assert.equal(result.gradeSource, 'auction_house');
});

test('a catalog grade later in the description is not misread from the slab label', () => {
    const result = extractSlabInfo({
        description: 'В слабе NGC. По каталогу редкость R для сохранности XF.',
        condition: 'MS64',
    });
    assert.equal(result.gradingCompanyCode, 'NGC');
    assert.equal(result.gradeCode, 'MS64');
    assert.equal(result.gradeSource, 'auction_house');
});

test('Numismat capsule wording yields company and directly adjacent label grade', () => {
    const result = extractSlabInfo({
        description: 'Монета в пластиковой капсуле (слабе) NGC, AU 53. Биткин № 262.',
    });
    assert.equal(result.slabStatus, 'slabbed');
    assert.equal(result.gradingCompanyCode, 'NGC');
    assert.equal(result.gradeCode, 'AU53');
    assert.equal(result.gradeSource, 'slab_label');
});

test('a packaging word between slab context and company is skipped', () => {
    const result = extractSlabInfo({
        description: 'Состояние UNC, в слабе-коробке PCCB лот 5.',
        condition: 'UNC',
    });
    assert.equal(result.slabStatus, 'slabbed');
    assert.equal(result.gradingCompanyCode, 'OTHER');
    assert.equal(result.gradingCompanyRaw, 'PCCB');
    assert.equal(result.gradeSource, 'auction_house');
});

test('a named multiword company is preserved without inventing a canonical code', () => {
    const result = extractSlabInfo({
        description: 'В слабе Premium Grading. Номер 123.',
    });
    assert.equal(result.gradingCompanyCode, 'OTHER');
    assert.equal(result.gradingCompanyRaw, 'Premium Grading');
});

test('holder substrings inside unrelated words are not slab evidence', () => {
    assert.equal(extractSlabInfo({
        description: 'Shareholder catalogue reference only',
    }).slabStatus, 'unknown');
});

test('condition is retained as auction-house grade, never a slab-label grade', () => {
    const result = extractSlabInfo({ description: 'Обычная монета', condition: ' pf 69 ' });
    assert.equal(result.slabStatus, 'unknown');
    assert.equal(result.gradeCode, 'PF69');
    assert.equal(result.gradeSource, 'auction_house');
    assert.equal(result.gradingCompanyCode, null);
});

test('missing slab mention remains unknown and explicit raw wording is required', () => {
    assert.equal(extractSlabInfo({ description: 'Монета без упаковки' }).slabStatus, 'unknown');
    const raw = extractSlabInfo({ description: 'Монета без слаба, состояние XF', condition: 'XF' });
    assert.equal(raw.slabStatus, 'raw');
    assert.equal(raw.gradeSource, 'auction_house');
    assert.equal(raw.gradingCompanyCode, null);
});

test('structured source fields can prove slab status and a label grade', () => {
    const result = extractSlabInfo({
        description: 'Описание без упаковки',
        condition: 'XF',
        sourceFields: {
            slabStatus: 'slabbed',
            gradingCompany: 'NGC',
            labelGradeCode: 'PF 69 Ultra Cameo',
        },
    });
    assert.equal(result.slabStatus, 'slabbed');
    assert.equal(result.gradingCompanyCode, 'NGC');
    assert.equal(result.gradeCode, 'PF69ULTRACAMEO');
    assert.equal(result.gradeSource, 'slab_label');
});

test('false boolean defaults do not prove that a coin is raw', () => {
    assert.equal(extractSlabInfo({
        sourceFields: { isSlabbed: false },
    }).slabStatus, 'unknown');
});

test('every active price-source writer uses the common slab extractor', () => {
    const writers = [
        'wolmar-category-parser.js',
        'wolmar-parser5.js',
        'catalog/numismat-core.js',
        'catalog/ingest-meshok.js',
        'catalog/ingest-auctionru-active.js',
        'catalog/poll-auctionru.js',
    ];
    for (const writer of writers) {
        const source = fs.readFileSync(path.join(__dirname, '..', writer), 'utf8');
        assert.match(source, /extractSlabInfo\(/, writer);
        assert.match(source, /slab_status/, writer);
        assert.match(source, /slab_extractor_version/, writer);
        assert.match(source, /slab_evidence_text/, writer);
    }
});
