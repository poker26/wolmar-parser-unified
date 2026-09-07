CREATE TABLE collection_identification_session (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'ready', 'discarding', 'claimed')),
    photos JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(photos) = 'array'),
    claimed_item_id UUID REFERENCES collection_item(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (status = 'claimed' AND claimed_item_id IS NOT NULL)
        OR (status <> 'claimed' AND claimed_item_id IS NULL)
    )
);

CREATE INDEX collection_identification_session_user_idx
    ON collection_identification_session(user_id, created_at DESC);

CREATE INDEX collection_identification_session_expiry_idx
    ON collection_identification_session(expires_at)
    WHERE status <> 'claimed';

ALTER TABLE collection_identification_session ENABLE ROW LEVEL SECURITY;

CREATE POLICY collection_identification_session_owner_policy
    ON collection_identification_session
    USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
