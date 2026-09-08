'use strict';

async function captureIdentificationCandidate(pool, { userId, itemId }) {
    if (!pool || typeof pool.query !== 'function') {
        throw new TypeError('A pg-compatible pool is required');
    }
    const result = await pool.query(
        `WITH capture AS (
            SELECT label.item_id, label.user_id, label.selected_type_id,
                   label.decision, label.strategy, label.catalog_match,
                   label.proposed_type_ids, label.recognized_name, label.extracted,
                   label.confirmed_at, label.source_request_id,
                   obverse.sha256 AS obverse_sha256,
                   reverse.sha256 AS reverse_sha256
            FROM collection_identification_label label
            JOIN collection_item item
              ON item.id = label.item_id
             AND item.user_id = label.user_id
             AND item.deleted_at IS NULL
            JOIN coin_identification_run run
              ON run.request_id = label.source_request_id
             AND run.user_id = label.user_id
             AND run.status = 'ok'
            JOIN collection_item_photo obverse
              ON obverse.item_id = item.id
             AND obverse.side = 'obverse'
             AND obverse.status = 'ready'
             AND obverse.deleted_at IS NULL
            JOIN collection_item_photo reverse
              ON reverse.item_id = item.id
             AND reverse.side = 'reverse'
             AND reverse.status = 'ready'
             AND reverse.deleted_at IS NULL
            WHERE label.user_id = $1
              AND label.item_id = $2
              AND obverse.sha256 <> reverse.sha256
              AND cardinality(run.image_sha256) = 2
              AND run.image_sha256 @> ARRAY[obverse.sha256::text, reverse.sha256::text]
              AND ARRAY[obverse.sha256::text, reverse.sha256::text] @> run.image_sha256
        )
        INSERT INTO collection_identification_review_event (
            item_id, user_id, obverse_sha256, reverse_sha256,
            source_request_id, source_label_snapshot,
            batch_id, case_id, review_status, label_scope,
            reviewed_type_id, candidate_type_ids,
            review_method, reviewer, evidence, usage_scope, reviewed_at
        )
        SELECT item_id, user_id, obverse_sha256, reverse_sha256,
               source_request_id,
               jsonb_build_object(
                   'selected_type_id', selected_type_id,
                   'decision', decision,
                   'strategy', strategy,
                   'catalog_match', catalog_match,
                   'proposed_type_ids', proposed_type_ids,
                   'recognized_name', recognized_name,
                   'extracted', extracted,
                   'confirmed_at', confirmed_at,
                   'source_request_id', source_request_id
               ),
               'user-confirmation-v1', source_request_id::text,
               'candidate', 'exact_type', selected_type_id, ARRAY[selected_type_id],
               'user_confirmation_after_identification', 'authenticated_user',
               jsonb_build_object(
                   'photo_hashes_match_source_request', true,
                   'side_labels', 'capture_order_unverified'
               ),
               'evaluation_only', confirmed_at
        FROM capture
        ON CONFLICT (batch_id, case_id) DO NOTHING
        RETURNING id`,
        [userId, itemId],
    );
    return { captured: result.rowCount === 1, eventId: result.rows[0]?.id || null };
}

module.exports = { captureIdentificationCandidate };
