CREATE TABLE collection_export (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'ready', 'failed', 'expired')),
    object_key TEXT NOT NULL UNIQUE,
    byte_size BIGINT CHECK (byte_size IS NULL OR byte_size > 0),
    sha256 CHAR(64) CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
    item_count INTEGER CHECK (item_count IS NULL OR item_count >= 0),
    photo_count INTEGER CHECK (photo_count IS NULL OR photo_count >= 0),
    error_code TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CHECK (status <> 'ready' OR (
        byte_size IS NOT NULL AND sha256 IS NOT NULL
        AND item_count IS NOT NULL AND photo_count IS NOT NULL
        AND expires_at IS NOT NULL AND completed_at IS NOT NULL
    ))
);

CREATE INDEX collection_export_user_created_idx
    ON collection_export(user_id, created_at DESC);

CREATE UNIQUE INDEX collection_export_user_active_idx
    ON collection_export(user_id)
    WHERE status IN ('queued', 'running');

CREATE TABLE account_deletion_request (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
    user_pseudonym CHAR(64) NOT NULL
        CHECK (user_pseudonym ~ '^[0-9a-f]{64}$'),
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'processing', 'completed', 'failed', 'cancelled')),
    execute_after TIMESTAMPTZ NOT NULL,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CHECK (execute_after >= created_at)
);

CREATE UNIQUE INDEX account_deletion_user_active_idx
    ON account_deletion_request(user_id)
    WHERE user_id IS NOT NULL AND status IN ('scheduled', 'processing', 'failed');

ALTER TABLE collection_export ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_deletion_request ENABLE ROW LEVEL SECURITY;

CREATE POLICY collection_export_owner_policy ON collection_export
    USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY account_deletion_owner_policy ON account_deletion_request
    USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

COMMENT ON TABLE collection_export IS 'Private user-requested collection archives with short-lived downloads';
COMMENT ON TABLE account_deletion_request IS 'Controlled delayed erasure queue; contains no email after user deletion';
