'use strict';

const { InputError, uuid } = require('../collection/validation');

const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const PHOTO_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
]);
const PHOTO_SIDES = new Set(['obverse', 'reverse', 'other']);

function plainObject(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new InputError(400, 'invalid_body', 'JSON object is required');
    }
    return body;
}

function side(value, { required = true } = {}) {
    if ((value === undefined || value === null) && !required) return undefined;
    if (!PHOTO_SIDES.has(value)) {
        throw new InputError(400, 'invalid_photo_side', 'Photo side must be obverse, reverse or other');
    }
    return value;
}

function sortOrder(value, { required = false } = {}) {
    if ((value === undefined || value === null) && !required) return undefined;
    if (!Number.isInteger(value) || value < 0 || value > 3) {
        throw new InputError(400, 'invalid_sort_order', 'Photo order must be an integer from 0 to 3');
    }
    return value;
}

function normalizeUploadIntent(body) {
    body = plainObject(body);
    const mimeType = String(body.mimeType || '').trim().toLowerCase();
    if (!PHOTO_MIME_TYPES.has(mimeType)) {
        throw new InputError(415, 'unsupported_photo_type', 'Supported photo types: JPEG, PNG, WebP and HEIC');
    }
    if (!Number.isInteger(body.byteSize) || body.byteSize < 1 || body.byteSize > MAX_PHOTO_BYTES) {
        throw new InputError(413, 'photo_too_large', 'Photo size must be between 1 byte and 20 MB');
    }
    return {
        side: side(body.side),
        mimeType,
        byteSize: body.byteSize,
        sortOrder: sortOrder(body.sortOrder),
    };
}

function normalizeComplete(body) {
    body = plainObject(body);
    return { photoId: uuid(body.photoId) };
}

function normalizePhotoPatch(body) {
    body = plainObject(body);
    const allowed = new Set(['side', 'sortOrder']);
    for (const key of Object.keys(body)) {
        if (!allowed.has(key)) throw new InputError(400, 'unknown_field', `Unknown field: ${key}`);
    }
    const patch = {};
    if (body.side !== undefined) patch.side = side(body.side);
    if (body.sortOrder !== undefined) patch.sortOrder = sortOrder(body.sortOrder, { required: true });
    if (Object.keys(patch).length === 0) {
        throw new InputError(400, 'empty_patch', 'At least one photo field is required');
    }
    return patch;
}

module.exports = {
    MAX_PHOTO_BYTES,
    PHOTO_MIME_TYPES,
    PHOTO_SIDES,
    normalizeComplete,
    normalizePhotoPatch,
    normalizeUploadIntent,
};
