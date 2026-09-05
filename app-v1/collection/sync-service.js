'use strict';

const { MinioPhotoStorage } = require('../photos/storage');
const { photoFromRow } = require('../photos/service');
const { valuationFromRow } = require('../valuation/service');
const { ITEM_SELECT, itemFromRow } = require('./service');
const { encodeSyncCursor } = require('./validation');

class CollectionSyncError extends Error {
    constructor(status, code, message, details = null) {
        super(message);
        this.name = 'CollectionSyncError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

function uniqueIds(changes, entityKind) {
    return [...new Set(
        changes
            .filter((change) => change.entity_kind === entityKind && change.operation === 'upsert')
            .map((change) => change.entity_id),
    )];
}

class CollectionSyncService {
    constructor({ pool, storage = null, originalUrlTtlSeconds = 3600 }) {
        if (!pool || typeof pool.query !== 'function') throw new TypeError('A pg-compatible pool is required');
        this.pool = pool;
        this.storage = storage || new MinioPhotoStorage();
        this.originalUrlTtlSeconds = originalUrlTtlSeconds;
    }

    async sync(userId, { cursor, limit }) {
        const state = await this.pool.query(
            `SELECT minimum_available_seq
             FROM collection_sync_state
             WHERE singleton = true`,
        );
        const minimumAvailable = BigInt(state.rows[0]?.minimum_available_seq || 0);
        if (BigInt(cursor) < minimumAvailable) {
            throw new CollectionSyncError(
                410,
                'cursor_expired',
                'Synchronization cursor has expired; download a new baseline',
                { resetRequired: true },
            );
        }

        const result = await this.pool.query(
            `SELECT seq, entity_kind, entity_id, item_id, operation, changed_at
             FROM collection_sync_change
             WHERE user_id = $1 AND seq > $2::bigint
             ORDER BY seq
             LIMIT $3`,
            [userId, cursor, limit + 1],
        );
        const hasMore = result.rows.length > limit;
        const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
        const knownKinds = new Set(['item', 'photo', 'valuation']);
        const unknown = rows.find((row) => !knownKinds.has(row.entity_kind));
        if (unknown) {
            throw new CollectionSyncError(
                500,
                'unknown_sync_event',
                `Unsupported synchronization entity kind: ${unknown.entity_kind}`,
            );
        }

        const [items, photos, valuations] = await Promise.all([
            this.loadItems(userId, uniqueIds(rows, 'item')),
            this.loadPhotos(userId, uniqueIds(rows, 'photo')),
            this.loadValuations(userId, uniqueIds(rows, 'valuation')),
        ]);
        const changes = [];
        for (const row of rows) {
            const source = row.entity_kind === 'item'
                ? items.get(row.entity_id)
                : row.entity_kind === 'photo'
                    ? photos.get(row.entity_id)
                    : valuations.get(row.entity_id);
            const operation = row.operation === 'delete' || !source ? 'delete' : 'upsert';
            const change = {
                seq: String(row.seq),
                entityKind: row.entity_kind,
                entityId: row.entity_id,
                itemId: row.item_id,
                operation,
                changedAt: row.changed_at,
            };
            if (operation === 'upsert' && row.entity_kind === 'item') {
                const { createdIdempotencyKey, ...publicItem } = source;
                change.item = publicItem;
                change.clientMutationId = createdIdempotencyKey;
            } else if (operation === 'upsert') {
                change[row.entity_kind] = source;
            }
            changes.push(change);
        }

        const lastSeq = rows.length ? String(rows.at(-1).seq) : cursor;
        return {
            changes,
            nextCursor: encodeSyncCursor(lastSeq),
            hasMore,
        };
    }

    async loadItems(userId, ids) {
        if (!ids.length) return new Map();
        const result = await this.pool.query(
            `${ITEM_SELECT}
             WHERE ci.user_id = $1
               AND ci.id = ANY($2::uuid[])
               AND ci.deleted_at IS NULL`,
            [userId, ids],
        );
        return new Map(result.rows.map((row) => [row.id, {
            ...itemFromRow(row),
            createdIdempotencyKey: row.created_idempotency_key || null,
        }]));
    }

    async loadPhotos(userId, ids) {
        if (!ids.length) return new Map();
        const result = await this.pool.query(
            `SELECT photo.*, item.version item_version
             FROM collection_item_photo photo
             JOIN collection_item item ON item.id = photo.item_id
             WHERE item.user_id = $1
               AND photo.id = ANY($2::uuid[])
               AND item.deleted_at IS NULL
               AND photo.deleted_at IS NULL
               AND photo.status = 'ready'`,
            [userId, ids],
        );
        const expiresAt = new Date(Date.now() + this.originalUrlTtlSeconds * 1000).toISOString();
        const entries = await Promise.all(result.rows.map(async (row) => [
            row.id,
            {
                ...photoFromRow(row),
                itemVersion: Number(row.item_version),
                sha256: row.sha256,
                originalUrl: await this.storage.downloadUrl(
                    row.object_key_original,
                    this.originalUrlTtlSeconds,
                ),
                originalUrlExpiresAt: expiresAt,
            },
        ]));
        return new Map(entries);
    }

    async loadValuations(userId, ids) {
        if (!ids.length) return new Map();
        const result = await this.pool.query(
            `SELECT valuation.*
             FROM collection_valuation valuation
             JOIN collection_item item ON item.id = valuation.item_id
             WHERE item.user_id = $1
               AND valuation.id = ANY($2::uuid[])
               AND item.deleted_at IS NULL`,
            [userId, ids],
        );
        return new Map(result.rows.map((row) => [row.id, valuationFromRow(row)]));
    }
}

module.exports = {
    CollectionSyncError,
    CollectionSyncService,
    uniqueIds,
};
