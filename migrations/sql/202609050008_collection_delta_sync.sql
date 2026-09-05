ALTER TABLE collection_item
    ADD COLUMN version BIGINT NOT NULL DEFAULT 1
        CHECK (version > 0);

CREATE FUNCTION collection_item_bump_version() RETURNS TRIGGER AS $$
BEGIN
    IF (to_jsonb(NEW) - 'version') IS DISTINCT FROM (to_jsonb(OLD) - 'version') THEN
        NEW.version := OLD.version + 1;
    ELSE
        NEW.version := OLD.version;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER collection_item_bump_version_trigger
    BEFORE UPDATE ON collection_item
    FOR EACH ROW
    EXECUTE FUNCTION collection_item_bump_version();

CREATE TABLE collection_sync_change (
    seq BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    entity_kind TEXT NOT NULL
        CHECK (entity_kind IN ('item', 'photo', 'valuation')),
    entity_id UUID NOT NULL,
    item_id UUID NOT NULL,
    operation TEXT NOT NULL
        CHECK (operation IN ('upsert', 'delete')),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX collection_sync_change_user_seq_idx
    ON collection_sync_change(user_id, seq);

CREATE TABLE collection_sync_state (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    minimum_available_seq BIGINT NOT NULL DEFAULT 0
        CHECK (minimum_available_seq >= 0)
);

INSERT INTO collection_sync_state (singleton, minimum_available_seq)
VALUES (true, 0);

CREATE FUNCTION collection_sync_log_item() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO collection_sync_change (
        user_id, entity_kind, entity_id, item_id, operation
    ) VALUES (
        NEW.user_id,
        'item',
        NEW.id,
        NEW.id,
        CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER collection_sync_log_item_trigger
    AFTER INSERT OR UPDATE ON collection_item
    FOR EACH ROW
    EXECUTE FUNCTION collection_sync_log_item();

CREATE FUNCTION collection_sync_log_photo() RETURNS TRIGGER AS $$
DECLARE
    owner_id UUID;
BEGIN
    IF NEW.deleted_at IS NULL AND NEW.status <> 'ready' THEN
        RETURN NEW;
    END IF;

    SELECT user_id INTO owner_id
    FROM collection_item
    WHERE id = NEW.item_id;

    IF owner_id IS NOT NULL THEN
        UPDATE collection_item
        SET updated_at = now()
        WHERE id = NEW.item_id
          AND deleted_at IS NULL;

        INSERT INTO collection_sync_change (
            user_id, entity_kind, entity_id, item_id, operation
        ) VALUES (
            owner_id,
            'photo',
            NEW.id,
            NEW.item_id,
            CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER collection_sync_log_photo_trigger
    AFTER INSERT OR UPDATE ON collection_item_photo
    FOR EACH ROW
    EXECUTE FUNCTION collection_sync_log_photo();

CREATE FUNCTION collection_sync_log_valuation() RETURNS TRIGGER AS $$
DECLARE
    owner_id UUID;
BEGIN
    SELECT user_id INTO owner_id
    FROM collection_item
    WHERE id = NEW.item_id;

    IF owner_id IS NOT NULL THEN
        INSERT INTO collection_sync_change (
            user_id, entity_kind, entity_id, item_id, operation
        ) VALUES (
            owner_id, 'valuation', NEW.id, NEW.item_id, 'upsert'
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER collection_sync_log_valuation_trigger
    AFTER INSERT ON collection_valuation
    FOR EACH ROW
    EXECUTE FUNCTION collection_sync_log_valuation();

-- Seed one complete current-state baseline. New installations have empty source
-- tables, while upgrades get every item tombstone and every live dependent row.
INSERT INTO collection_sync_change (
    user_id, entity_kind, entity_id, item_id, operation, changed_at
)
SELECT ci.user_id,
       'item',
       ci.id,
       ci.id,
       CASE WHEN ci.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END,
       COALESCE(ci.deleted_at, ci.updated_at, ci.created_at, now())
FROM collection_item ci
ORDER BY ci.created_at, ci.id;

INSERT INTO collection_sync_change (
    user_id, entity_kind, entity_id, item_id, operation, changed_at
)
SELECT ci.user_id,
       'photo',
       photo.id,
       photo.item_id,
       CASE WHEN photo.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END,
       COALESCE(photo.deleted_at, photo.updated_at, photo.created_at, now())
FROM collection_item_photo photo
JOIN collection_item ci ON ci.id = photo.item_id
WHERE ci.deleted_at IS NULL
  AND (photo.deleted_at IS NOT NULL OR photo.status = 'ready')
ORDER BY photo.created_at, photo.id;

INSERT INTO collection_sync_change (
    user_id, entity_kind, entity_id, item_id, operation, changed_at
)
SELECT ci.user_id,
       'valuation',
       valuation.id,
       valuation.item_id,
       'upsert',
       valuation.calculated_at
FROM collection_item ci
JOIN LATERAL (
    SELECT cv.id, cv.item_id, cv.calculated_at
    FROM collection_valuation cv
    WHERE cv.item_id = ci.id
      AND (ci.valuation_invalidated_at IS NULL
           OR cv.calculated_at >= ci.valuation_invalidated_at)
    ORDER BY cv.calculated_at DESC, cv.id DESC
    LIMIT 1
) valuation ON true
WHERE ci.deleted_at IS NULL
ORDER BY valuation.calculated_at, valuation.id;

ALTER TABLE collection_sync_change ENABLE ROW LEVEL SECURITY;

CREATE POLICY collection_sync_change_owner_policy ON collection_sync_change
    USING (
        user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    );

COMMENT ON TABLE collection_sync_change IS
    'Append-only per-owner collection change journal for explicit client synchronization';
