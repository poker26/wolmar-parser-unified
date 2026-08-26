CREATE TABLE app_user (
    id UUID PRIMARY KEY,
    email_normalized TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'invited'
        CHECK (status IN ('invited', 'active', 'blocked', 'deletion_pending')),
    email_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (email_normalized = lower(btrim(email_normalized))),
    CHECK (position('@' IN email_normalized) > 1),
    CHECK (char_length(password_hash) >= 40)
);

CREATE TABLE user_session (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (char_length(token_hash) >= 43),
    CHECK (char_length(csrf_token_hash) = 64),
    CHECK (expires_at > created_at)
);

CREATE INDEX user_session_user_active_idx
    ON user_session(user_id, expires_at DESC)
    WHERE revoked_at IS NULL;

CREATE TABLE collection_item (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    type_id INTEGER REFERENCES coin_type(id) ON DELETE SET NULL,
    type_name_snapshot TEXT,
    user_label TEXT,
    identification_status TEXT NOT NULL DEFAULT 'unlinked'
        CHECK (identification_status IN ('linked', 'unlinked', 'needs_review')),
    grade_system TEXT
        CHECK (grade_system IS NULL OR grade_system IN ('adjectival', 'sheldon', 'proof')),
    grade_code TEXT,
    purchase_price_minor BIGINT CHECK (purchase_price_minor IS NULL OR purchase_price_minor >= 0),
    purchase_currency CHAR(3)
        CHECK (purchase_currency IS NULL OR purchase_currency ~ '^[A-Z]{3}$'),
    purchase_date DATE,
    purchase_source TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'sold', 'archived')),
    sold_price_minor BIGINT CHECK (sold_price_minor IS NULL OR sold_price_minor >= 0),
    sold_currency CHAR(3)
        CHECK (sold_currency IS NULL OR sold_currency ~ '^[A-Z]{3}$'),
    sold_at DATE,
    created_idempotency_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CHECK (
        type_id IS NOT NULL
        OR NULLIF(btrim(user_label), '') IS NOT NULL
        OR NULLIF(btrim(type_name_snapshot), '') IS NOT NULL
    ),
    CHECK ((purchase_price_minor IS NULL) = (purchase_currency IS NULL)),
    CHECK ((sold_price_minor IS NULL) = (sold_currency IS NULL)),
    CHECK (status = 'sold' OR (sold_price_minor IS NULL AND sold_currency IS NULL AND sold_at IS NULL)),
    CHECK (status <> 'sold' OR sold_at IS NOT NULL),
    CHECK (created_idempotency_key IS NULL OR char_length(created_idempotency_key) BETWEEN 8 AND 200)
);

CREATE INDEX collection_item_user_created_idx
    ON collection_item(user_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX collection_item_user_status_idx
    ON collection_item(user_id, status, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX collection_item_type_idx
    ON collection_item(type_id)
    WHERE type_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX collection_item_user_idempotency_idx
    ON collection_item(user_id, created_idempotency_key)
    WHERE created_idempotency_key IS NOT NULL;

CREATE FUNCTION collection_item_sync_type_link() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.type_id IS NULL THEN
        NEW.identification_status := 'unlinked';
    ELSE
        SELECT name_full INTO NEW.type_name_snapshot
        FROM coin_type
        WHERE id = NEW.type_id;

        IF NEW.identification_status = 'unlinked' THEN
            NEW.identification_status := 'linked';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER collection_item_sync_type_link_trigger
    BEFORE INSERT OR UPDATE OF type_id, identification_status
    ON collection_item
    FOR EACH ROW
    EXECUTE FUNCTION collection_item_sync_type_link();

ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_item ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE app_user IS 'MVP application accounts; separate from legacy collection_users';
COMMENT ON TABLE collection_item IS 'One row per physical coin specimen; separate from legacy user_collections';
