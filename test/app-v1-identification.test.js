'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { registerIdentificationRoutes } = require('../app-v1/identification/routes');
const { CoinIdentificationService, IdentificationError, MAX_IDENTIFY_BYTES, normalizeResult } = require('../app-v1/identification/service');
const {
    enrichIdentificationCandidates,
    krauseRangeFromIssues,
    krauseReferenceFromIssue,
    selectCirculatedBasis,
} = require('../app-v1/catalog-reference/service');

function fakeApp() {
    const routes = [];
    return { routes, post: (path, ...handlers) => routes.push({ path, handlers }) };
}

test('identification route is authenticated, CSRF protected and rate limited before reading image', () => {
    const app = fakeApp();
    const authenticate = () => {};
    const requireCsrf = () => {};
    const limiter = () => {};
    registerIdentificationRoutes(app, { authenticate, requireCsrf, limiter, service: {} });
    const route = app.routes[0];
    assert.equal(route.path, '/api/v1/collection/identify');
    assert.equal(route.handlers[0], authenticate);
    assert.equal(route.handlers[1], requireCsrf);
    assert.equal(route.handlers[2], limiter);
});

test('identification route reads image bytes after the global JSON parser', async (t) => {
    const app = express();
    app.use(express.json());
    let received;
    registerIdentificationRoutes(app, {
        authenticate: (req, _res, next) => { req.appAuth = { userId: 'user-1' }; next(); },
        requireCsrf: (_req, _res, next) => next(),
        service: {
            identify: async (body, mimeType) => {
                received = { body, mimeType };
                return { extracted: {}, candidates: [] };
            },
        },
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => server.close());
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/collection/identify`, {
        method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: Buffer.from('jpeg'),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received.body, [{ buffer: Buffer.from('jpeg'), mimeType: 'image/jpeg' }]);
});

test('identification route accepts both coin sides in one multipart request', async (t) => {
    const app = express();
    let received;
    registerIdentificationRoutes(app, {
        authenticate: (req, _res, next) => { req.appAuth = { userId: 'user-1' }; next(); },
        requireCsrf: (_req, _res, next) => next(),
        service: {
            identify: async (images) => {
                received = images;
                return { extracted: {}, candidates: [] };
            },
        },
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => server.close());
    const { port } = server.address();
    const body = new FormData();
    body.append('images', new Blob([Buffer.from('reverse')], { type: 'image/jpeg' }), 'reverse.jpg');
    body.append('images', new Blob([Buffer.from('obverse')], { type: 'image/png' }), 'obverse.png');
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/collection/identify`, { method: 'POST', body });
    assert.equal(response.status, 200);
    assert.deepEqual(received, [
        { buffer: Buffer.from('reverse'), mimeType: 'image/jpeg' },
        { buffer: Buffer.from('obverse'), mimeType: 'image/png' },
    ]);
});

test('identification response exposes catalog ids and normalized public fields only', () => {
    assert.deepEqual(normalizeResult({
        extracted: { country: 'RU', denomination_value: '1', denomination_unit: 'рубль', year: 1913, metal: 'серебро', ruler: 'Николай II', mint: 'СПБ', confidence: 0.92, slab_status: 'slabbed', grading_company_code: 'NGC', grade_code: 'MS 66', certificate_number: '1234567-001', prompt: 'hidden' },
        candidates: [{ id: 42, name: '1 рубль 1913', country: 'RU', year: '1913', denom: '1 рубль', bitkin: 'ОК-123', score: 8, matched: { hidden: true } }],
        recognized_name: '1 рубль, Российская империя, 1913, Николай II',
        catalog_match: 'exact',
        note: 'internal',
    }), {
        recognizedName: '1 рубль 1913',
        catalogMatch: 'exact',
        extracted: { country: 'RU', denominationValue: '1', denominationUnit: 'рубль', year: 1913, metal: 'серебро', ruler: 'Николай II', mint: 'СПБ', confidence: 0.92, slabStatus: 'slabbed', gradingCompanyCode: 'NGC', gradingCompanyRaw: 'NGC', gradeCode: 'MS66', gradeSource: 'slab_label', slabCertificateNumber: '1234567-001' },
        candidates: [{ id: 42, name: '1 рубль 1913', country: 'RU', year: 1913, denomination: '1 рубль', bitkinNumber: 'ОК-123', score: 8 }],
    });
});

test('slabbed without readable label evidence is downgraded to unknown', () => {
    const result = normalizeResult({
        recognized_name: 'Монета в круглой капсуле',
        catalog_match: 'not_found',
        extracted: { slab_status: 'slabbed' },
        candidates: [],
    });
    assert.equal(result.extracted.slabStatus, 'unknown');
    assert.equal(result.extracted.gradingCompanyCode, null);
    assert.equal(result.extracted.gradeCode, null);
});

test('identification response reports a recognized coin even when the catalog has no type', () => {
    assert.deepEqual(normalizeResult({
        recognized_name: '1 евро, Германия, 2002, федеральный орёл',
        catalog_match: 'not_found',
        extracted: { country: 'Germany', denomination_value: 1, denomination_unit: 'euro', year: 2002 },
        candidates: [],
    }), {
        recognizedName: '1 евро, Германия, 2002, федеральный орёл',
        catalogMatch: 'not_found',
        extracted: {
            country: 'Germany', denominationValue: '1', denominationUnit: 'euro', year: 2002,
            metal: null, ruler: null, mint: null, confidence: null,
            slabStatus: 'unknown', gradingCompanyCode: null, gradingCompanyRaw: null,
            gradeCode: null, gradeSource: 'unknown', slabCertificateNumber: null,
        },
        candidates: [],
    });
});

test('Krause issue enrichment keeps the exact photographed year and every grade price', async () => {
    const pool = {
        query: async (_sql, params) => {
            assert.deepEqual(params, [[376691], 1986]);
            return { rows: [{
                type_id: 376691,
                issue_id: '9001',
                year: 1986,
                year_label: '1986',
                mint: null,
                variety: null,
                mintage: '20353000',
                source: 'scwc',
                catalog_prices: { XF40: 10, MS60: 25, MS63: 75, MS65: 125 },
                ref_pdf_src: 'scwc_p2',
                ref_pdf_page: 1069,
                catalog_publication_year: 2020,
            }] };
        },
    };
    const result = await enrichIdentificationCandidates(pool, {
        extracted: { year: 1986, mint: null },
        candidates: [{ id: 376691, name: '50 DINARA. YUGOSLAVIA' }],
    });
    assert.equal(result.candidates[0].issueId, 9001);
    assert.equal(result.candidates[0].issueMatch, 'exact');
    assert.deepEqual(result.candidates[0].krauseReference, {
        source: 'scwc', issueId: 9001, year: 1986, yearLabel: '1986', mint: null,
        variety: null, mintage: 20353000, currency: 'USD', publicationYear: 2020,
        basisGradeCode: 'XF40',
        basisAmountMinor: 10, uncirculatedLowMinor: 25, uncirculatedHighMinor: 125,
        prices: { XF40: 10, MS60: 25, MS63: 75, MS65: 125 },
        refPdfSrc: 'scwc_p2', refPdfPage: 1069,
    });
});

test('Krause issue enrichment abstains when one type has multiple variants for the year', async () => {
    const pool = { query: async () => ({ rows: [
        { type_id: 7, issue_id: '91', year: 2000, mint: 'A', catalog_prices: { XF40: 100 } },
        { type_id: 7, issue_id: '92', year: 2000, mint: 'D', catalog_prices: { XF40: 120 } },
    ] }) };
    const ambiguous = await enrichIdentificationCandidates(pool, {
        extracted: { year: 2000, mint: null }, candidates: [{ id: 7, name: 'Example' }],
    });
    assert.equal(ambiguous.candidates[0].issueId, null);
    assert.equal(ambiguous.candidates[0].issueMatch, 'ambiguous');
    assert.equal(ambiguous.candidates[0].krauseReference, null);
    assert.deepEqual(ambiguous.candidates[0].krauseRange, {
        source: 'scwc', year: 2000, currency: 'USD', publicationYear: null, variantCount: 2,
        basisGradeCode: 'XF40', lowMinor: 100, highMinor: 120,
    });

    const exactMint = await enrichIdentificationCandidates(pool, {
        extracted: { year: 2000, mint: 'D' }, candidates: [{ id: 7, name: 'Example' }],
    });
    assert.equal(exactMint.candidates[0].issueId, 92);
    assert.equal(exactMint.candidates[0].krauseRange, null);
});

test('Krause default uses XF40 only as a price basis, never as an assigned grade', () => {
    const reference = krauseReferenceFromIssue({ issue_id: '5', year: 1986, catalog_prices: { XF40: '10', MS60: '25' } });
    assert.equal(reference.basisGradeCode, 'XF40');
    assert.equal(reference.basisAmountMinor, 10);
    assert.equal(Object.hasOwn(reference, 'gradeCode'), false);
});

test('Krause basis uses a conservative available circulated grade without assigning it to the coin', () => {
    assert.equal(selectCirculatedBasis({ VF20: 10, AU50: 30 }), 'VF20');
    assert.equal(selectCirculatedBasis({ F: 5, VF: 10, MS60: 40 }), 'VF');
    assert.equal(selectCirculatedBasis({ MS60: 40, PF65: 90 }), null);

    const reference = krauseReferenceFromIssue({
        issue_id: '6', year: 1986, catalog_prices: { VF20: '10', UNC: '25', BU: '35' },
    });
    assert.equal(reference.basisGradeCode, 'VF20');
    assert.equal(reference.basisAmountMinor, 10);
    assert.equal(reference.uncirculatedLowMinor, 25);
    assert.equal(reference.uncirculatedHighMinor, 35);
    assert.equal(Object.hasOwn(reference, 'gradeCode'), false);
});

test('Krause range abstains unless every variant has a comparable circulated basis', () => {
    assert.equal(krauseRangeFromIssues([
        { issue_id: '1', year: 2000, catalog_prices: { XF40: 100 } },
        { issue_id: '2', year: 2000, catalog_prices: { VF20: 80 } },
    ]), null);
    assert.equal(krauseRangeFromIssues([
        { issue_id: '1', year: 2000, catalog_prices: { XF40: 100 } },
        { issue_id: '2', year: 2000, catalog_prices: { MS60: 150 } },
    ]), null);
});

test('identification service forwards one image as multipart and rejects unsafe input', async () => {
    let request;
    const service = new CoinIdentificationService({
        endpoint: 'http://recognition.invalid/identify',
        fetchImpl: async (url, options) => {
            request = { url, options };
            return { ok: true, json: async () => ({ extracted: {}, candidates: [] }) };
        },
    });
    const result = await service.identify(Buffer.from('jpeg bytes'), 'image/jpeg');
    assert.equal(result.candidates.length, 0);
    assert.equal(request.url, 'http://recognition.invalid/identify');
    assert.equal(request.options.method, 'POST');
    assert.ok(request.options.body instanceof FormData);
    assert.equal(request.options.body.getAll('image').length, 1);
    await service.identify([
        { buffer: Buffer.from('front'), mimeType: 'image/jpeg' },
        { buffer: Buffer.from('back'), mimeType: 'image/jpeg' },
    ]);
    assert.equal(request.options.body.getAll('image').length, 2);
    await assert.rejects(service.identify(Buffer.from('svg'), 'image/svg+xml'), (error) => error instanceof IdentificationError && error.status === 415);
    await assert.rejects(service.identify(Buffer.alloc(MAX_IDENTIFY_BYTES + 1), 'image/jpeg'), (error) => error instanceof IdentificationError && error.status === 413);
    await assert.rejects(service.identify([
        { buffer: Buffer.alloc(MAX_IDENTIFY_BYTES / 2), mimeType: 'image/jpeg' },
        { buffer: Buffer.alloc((MAX_IDENTIFY_BYTES / 2) + 1), mimeType: 'image/jpeg' },
    ]), (error) => error instanceof IdentificationError && error.status === 413);
});

test('upstream failures become stable API errors', async () => {
    const unavailable = new CoinIdentificationService({ fetchImpl: async () => { throw new Error('network details'); } });
    await assert.rejects(unavailable.identify(Buffer.from('x'), 'image/jpeg'), (error) => error.code === 'recognition_unavailable' && error.status === 503);
    const failed = new CoinIdentificationService({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ detail: 'provider failed' }) }) });
    await assert.rejects(failed.identify(Buffer.from('x'), 'image/jpeg'), (error) => error.code === 'recognition_failed' && error.status === 502);
});
