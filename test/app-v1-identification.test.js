'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { registerIdentificationRoutes } = require('../app-v1/identification/routes');
const { CoinIdentificationService, IdentificationError, MAX_IDENTIFY_BYTES, normalizeResult } = require('../app-v1/identification/service');

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
        recognizedName: '1 рубль, Российская империя, 1913, Николай II',
        catalogMatch: 'exact',
        extracted: { country: 'RU', denominationValue: '1', denominationUnit: 'рубль', year: 1913, metal: 'серебро', ruler: 'Николай II', mint: 'СПБ', confidence: 0.92, slabStatus: 'slabbed', gradingCompanyCode: 'NGC', gradingCompanyRaw: 'NGC', gradeCode: 'MS66', gradeSource: 'slab_label', slabCertificateNumber: '1234567-001' },
        candidates: [{ id: 42, name: '1 рубль 1913', country: 'RU', year: 1913, denomination: '1 рубль', bitkinNumber: 'ОК-123', score: 8 }],
    });
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
