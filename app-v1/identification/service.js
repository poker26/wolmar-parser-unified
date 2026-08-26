'use strict';

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_IDENTIFY_BYTES = 12 * 1024 * 1024;

class IdentificationError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

class CoinIdentificationService {
    constructor({
        endpoint = process.env.COIN_IDENTIFY_URL || 'http://127.0.0.1:8077/identify',
        fetchImpl = globalThis.fetch,
        timeoutMs = 120_000,
    } = {}) {
        if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
        this.endpoint = endpoint;
        this.fetch = fetchImpl;
        this.timeoutMs = timeoutMs;
    }

    async identify(image, mimeType) {
        const type = String(mimeType || '').split(';', 1)[0].trim().toLowerCase();
        if (!ALLOWED_IMAGE_TYPES.has(type)) {
            throw new IdentificationError('unsupported_image_type', 'Unsupported image type', 415);
        }
        if (!Buffer.isBuffer(image) || image.length === 0) {
            throw new IdentificationError('empty_image', 'Image is empty');
        }
        if (image.length > MAX_IDENTIFY_BYTES) {
            throw new IdentificationError('image_too_large', 'Image is larger than 12 MB', 413);
        }

        const body = new FormData();
        body.append('image', new Blob([image], { type }), `coin.${extensionFor(type)}`);
        let response;
        try {
            response = await this.fetch(this.endpoint, {
                method: 'POST',
                body,
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch (_) {
            throw new IdentificationError('recognition_unavailable', 'Recognition service is unavailable', 503);
        }

        let payload;
        try {
            payload = await response.json();
        } catch (_) {
            throw new IdentificationError('invalid_recognition_response', 'Recognition service returned invalid data', 502);
        }
        if (!response.ok) {
            throw new IdentificationError(
                'recognition_failed',
                typeof payload?.detail === 'string' ? payload.detail : 'Recognition failed',
                response.status >= 500 ? 502 : 422,
            );
        }
        return normalizeResult(payload);
    }
}

function extensionFor(type) {
    return ({
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/heic': 'heic',
        'image/heif': 'heif',
    })[type];
}

function normalizeResult(payload) {
    const extracted = payload && typeof payload.extracted === 'object' && payload.extracted
        ? payload.extracted
        : {};
    const candidates = Array.isArray(payload?.candidates)
        ? payload.candidates.slice(0, 18).map((candidate) => ({
            id: Number(candidate.id),
            name: String(candidate.name || ''),
            country: candidate.country == null ? null : String(candidate.country),
            year: integerOrNull(candidate.year),
            denomination: candidate.denom == null ? null : String(candidate.denom),
            bitkinNumber: candidate.bitkin == null ? null : String(candidate.bitkin),
            score: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : 0,
        })).filter((candidate) => Number.isSafeInteger(candidate.id) && candidate.id > 0 && candidate.name)
        : [];
    return {
        extracted: {
            country: nullableString(extracted.country),
            denominationValue: nullableString(extracted.denomination_value),
            denominationUnit: nullableString(extracted.denomination_unit),
            year: integerOrNull(extracted.year),
            metal: nullableString(extracted.metal),
            ruler: nullableString(extracted.ruler),
            mint: nullableString(extracted.mint),
            confidence: Number.isFinite(Number(extracted.confidence)) ? Number(extracted.confidence) : null,
        },
        candidates,
    };
}

function nullableString(value) {
    return value == null || String(value).trim() === '' ? null : String(value).trim();
}

function integerOrNull(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    if (typeof value === 'string' && /^\d{3,4}$/.test(value.trim())) {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) ? parsed : null;
    }
    return null;
}

module.exports = {
    ALLOWED_IMAGE_TYPES,
    MAX_IDENTIFY_BYTES,
    CoinIdentificationService,
    IdentificationError,
    normalizeResult,
};
