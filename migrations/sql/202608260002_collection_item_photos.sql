CREATE TABLE collection_item_photo (
    id UUID PRIMARY KEY,
    item_id UUID NOT NULL REFERENCES collection_item(id) ON DELETE CASCADE,
    side TEXT NOT NULL CHECK (side IN ('obverse', 'reverse', 'other')),
    object_key_original TEXT NOT NULL UNIQUE,
    object_key_display TEXT UNIQUE,
    object_key_thumb TEXT UNIQUE,
    declared_mime_type TEXT NOT NULL
        CHECK (declared_mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
    declared_byte_size BIGINT NOT NULL
        CHECK (declared_byte_size > 0 AND declared_byte_size <= 20971520),
    mime_type TEXT,
    byte_size BIGINT CHECK (byte_size IS NULL OR byte_size > 0),
    width INTEGER CHECK (width IS NULL OR width > 0),
    height INTEGER CHECK (height IS NULL OR height > 0),
    sha256 CHAR(64) CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'ready', 'rejected')),
    sort_order SMALLINT NOT NULL DEFAULT 0
        CHECK (sort_order BETWEEN 0 AND 3),
    upload_expires_at TIMESTAMPTZ NOT NULL,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CHECK (status <> 'ready' OR (
        object_key_display IS NOT NULL AND object_key_thumb IS NOT NULL
        AND mime_type IS NOT NULL AND byte_size IS NOT NULL
        AND width IS NOT NULL AND height IS NOT NULL AND sha256 IS NOT NULL
    ))
);

CREATE INDEX collection_item_photo_item_idx
    ON collection_item_photo(item_id, sort_order, created_at)
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX collection_item_photo_primary_side_idx
    ON collection_item_photo(item_id, side)
    WHERE side IN ('obverse', 'reverse') AND deleted_at IS NULL;

CREATE UNIQUE INDEX collection_item_photo_sort_idx
    ON collection_item_photo(item_id, sort_order)
    WHERE deleted_at IS NULL;

ALTER TABLE collection_item_photo ENABLE ROW LEVEL SECURITY;

CREATE POLICY collection_item_photo_owner_policy ON collection_item_photo
    USING (
        EXISTS (
            SELECT 1
            FROM collection_item ci
            WHERE ci.id = collection_item_photo.item_id
              AND ci.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM collection_item ci
            WHERE ci.id = collection_item_photo.item_id
              AND ci.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        )
    );
