'use strict';

const crypto = require('node:crypto');

const EVENT_PROPERTIES = Object.freeze({
    signup_completed: Object.freeze({ source: new Set(['invite']) }),
    collection_item_created: Object.freeze({ linked: 'boolean' }),
    collection_photo_ready: Object.freeze({ side: new Set(['obverse', 'reverse', 'edge', 'other']) }),
    collection_type_linked: Object.freeze({}),
    collection_valuation_ready: Object.freeze({ comparableBucket: new Set(['3-4', '5-9', '10-19', '20+']) }),
    collection_valuation_abstained: Object.freeze({
        reason: new Set(['type_required', 'grade_required', 'not_enough_exact_grade_sales', 'other']),
        comparableBucket: new Set(['0', '1-2', '3-4', '5-9', '10-19', '20+']),
    }),
    collection_valuation_viewed: Object.freeze({ status: new Set(['ready', 'insufficient_data']) }),
    collection_item_sold: Object.freeze({}),
    collection_export_completed: Object.freeze({
        itemCountBucket: new Set(['0', '1-2', '3-9', '10-49', '50+']),
        photoCountBucket: new Set(['0', '1-2', '3-9', '10-49', '50+']),
    }),
});

function hashNamespace(namespace, value) {
    return crypto.createHash('sha256').update(`${namespace}:${value}`, 'utf8').digest('hex');
}

function pseudonymizeUser(userId) {
    return hashNamespace('product-user-v1', userId);
}

function comparableBucket(value) {
    const count = Number(value) || 0;
    if (count === 0) return '0';
    if (count < 3) return '1-2';
    if (count < 5) return '3-4';
    if (count < 10) return '5-9';
    if (count < 20) return '10-19';
    return '20+';
}

function countBucket(value) {
    const count = Number(value) || 0;
    if (count === 0) return '0';
    if (count < 3) return '1-2';
    if (count < 10) return '3-9';
    if (count < 50) return '10-49';
    return '50+';
}

function sanitizeProperties(eventName, input = {}) {
    const schema = EVENT_PROPERTIES[eventName];
    if (!schema) throw new TypeError(`Unsupported product event: ${eventName}`);
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('Product event properties must be an object');
    }
    const output = {};
    for (const [key, value] of Object.entries(input)) {
        const rule = schema[key];
        if (!rule) throw new TypeError(`Property is not allowed for ${eventName}: ${key}`);
        if (rule === 'boolean') {
            if (typeof value !== 'boolean') throw new TypeError(`${key} must be boolean`);
        } else if (!rule.has(value)) {
            throw new TypeError(`${key} has an unsupported value`);
        }
        output[key] = value;
    }
    return output;
}

class ProductAnalytics {
    constructor({ pool, now = () => new Date(), cleanupIntervalMs = 24 * 60 * 60 * 1000 }) {
        if (!pool || typeof pool.query !== 'function') throw new TypeError('A pg-compatible pool is required');
        this.pool = pool;
        this.now = now;
        this.cleanupIntervalMs = cleanupIntervalMs;
        this.nextCleanupAt = 0;
    }

    async record({ userId, eventName, properties = {}, sourceId = null, occurredAt = this.now() }) {
        if (typeof userId !== 'string' || !userId) throw new TypeError('userId is required');
        const safeProperties = sanitizeProperties(eventName, properties);
        const deduplicationKey = sourceId == null
            ? null
            : hashNamespace(`product-event-v1:${eventName}`, sourceId);
        const result = await this.pool.query(
            `INSERT INTO product_event (
                id, user_pseudonym, event_name, properties, deduplication_key, occurred_at
             ) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
                crypto.randomUUID(), pseudonymizeUser(userId), eventName,
                JSON.stringify(safeProperties), deduplicationKey, occurredAt,
            ],
        );
        const timestamp = this.now().getTime();
        if (timestamp >= this.nextCleanupAt) {
            this.nextCleanupAt = timestamp + this.cleanupIntervalMs;
            await this.pool.query(`DELETE FROM product_event WHERE expires_at < now()`);
        }
        return { recorded: Boolean(result.rows[0]) };
    }
}

function safeRecorder(analytics, logger = console) {
    if (!analytics || typeof analytics.record !== 'function') return async () => ({ recorded: false });
    return async (event) => {
        try {
            return await analytics.record(event);
        } catch (error) {
            logger.error(`[product-analytics] ${event.eventName} failed: ${error.message}`);
            return { recorded: false };
        }
    };
}

module.exports = {
    EVENT_PROPERTIES,
    ProductAnalytics,
    comparableBucket,
    countBucket,
    pseudonymizeUser,
    safeRecorder,
    sanitizeProperties,
};
