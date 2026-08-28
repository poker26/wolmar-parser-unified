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

    async identify(imageOrImages, mimeType = null) {
        const images = Array.isArray(imageOrImages)
            ? imageOrImages
            : [{ buffer: imageOrImages, mimeType }];
        if (images.length < 1 || images.length > 2) {
            throw new IdentificationError('invalid_image_count', 'One or two images are required');
        }
        const body = new FormData();
        let totalBytes = 0;
        images.forEach((image, index) => {
            const type = String(image.mimeType || '').split(';', 1)[0].trim().toLowerCase();
            if (!ALLOWED_IMAGE_TYPES.has(type)) {
                throw new IdentificationError('unsupported_image_type', 'Unsupported image type', 415);
            }
            if (!Buffer.isBuffer(image.buffer) || image.buffer.length === 0) {
                throw new IdentificationError('empty_image', 'Image is empty');
            }
            totalBytes += image.buffer.length;
            if (totalBytes > MAX_IDENTIFY_BYTES) {
                throw new IdentificationError('image_too_large', 'Images are larger than 12 MB', 413);
            }
            body.append('image', new Blob([image.buffer], { type }), `coin-${index + 1}.${extensionFor(type)}`);
        });
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
    const catalogMatch = new Set(['exact', 'ambiguous', 'not_found']).has(payload?.catalog_match)
        ? payload.catalog_match
        : (candidates.length === 1 ? 'exact' : (candidates.length > 1 ? 'ambiguous' : 'not_found'));
    return {
        recognizedName: nullableString(payload?.recognized_name, 200),
        catalogMatch,
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

function nullableString(value, maxLength = null) {
    if (value == null || String(value).trim() === '') return null;
    const normalized = String(value).trim();
    return maxLength == null ? normalized : normalized.slice(0, maxLength);
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
