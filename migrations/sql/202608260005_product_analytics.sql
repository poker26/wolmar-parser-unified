CREATE TABLE product_event (
    id UUID PRIMARY KEY,
    user_pseudonym CHAR(64) NOT NULL
        CHECK (user_pseudonym ~ '^[0-9a-f]{64}$'),
    event_name TEXT NOT NULL
        CHECK (event_name IN (
            'signup_completed',
            'collection_item_created',
            'collection_photo_ready',
            'collection_type_linked',
            'collection_valuation_ready',
            'collection_valuation_abstained',
            'collection_valuation_viewed',
            'collection_item_sold',
            'collection_export_completed'
        )),
    properties JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(properties) = 'object')
        CHECK (octet_length(properties::text) <= 1024),
    deduplication_key CHAR(64)
        CHECK (deduplication_key IS NULL OR deduplication_key ~ '^[0-9a-f]{64}$'),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '400 days'
);

CREATE UNIQUE INDEX product_event_deduplication_idx
    ON product_event(event_name, deduplication_key)
    WHERE deduplication_key IS NOT NULL;

CREATE INDEX product_event_time_idx
    ON product_event(occurred_at DESC, event_name);

CREATE INDEX product_event_user_time_idx
    ON product_event(user_pseudonym, occurred_at DESC);

CREATE INDEX product_event_expiry_idx
    ON product_event(expires_at);

ALTER TABLE product_event ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE product_event IS
    'Allowlisted privacy-minimized product events; contains no account UUID, email, coin type, prices, notes or photo references';
