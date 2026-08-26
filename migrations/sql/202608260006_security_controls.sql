CREATE TABLE security_rate_limit (
    action TEXT NOT NULL
        CHECK (action ~ '^[a-z][a-z0-9_.]{2,63}$'),
    key_hash CHAR(64) NOT NULL
        CHECK (key_hash ~ '^[0-9a-f]{64}$'),
    window_started_at TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count > 0),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (action, key_hash, window_started_at),
    CHECK (expires_at > window_started_at)
);

CREATE INDEX security_rate_limit_expiry_idx
    ON security_rate_limit(expires_at);

CREATE TABLE security_audit_event (
    id UUID PRIMARY KEY,
    actor_pseudonym CHAR(64) NOT NULL
        CHECK (actor_pseudonym ~ '^[0-9a-f]{64}$'),
    actor_kind TEXT NOT NULL
        CHECK (actor_kind IN ('user', 'login', 'anonymous')),
    action TEXT NOT NULL
        CHECK (action IN (
            'auth.login',
            'auth.register',
            'auth.logout',
            'auth.logout_all',
            'security.csrf',
            'photo.upload_intent',
            'photo.upload_complete',
            'valuation.recalculate',
            'collection.export',
            'account.deletion'
        )),
    outcome TEXT NOT NULL
        CHECK (outcome IN ('succeeded', 'denied', 'failed', 'rate_limited')),
    reason_code TEXT
        CHECK (reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_]{1,63}$'),
    request_id UUID,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '400 days'
);

CREATE INDEX security_audit_event_time_idx
    ON security_audit_event(occurred_at DESC, action, outcome);

CREATE INDEX security_audit_event_actor_idx
    ON security_audit_event(actor_pseudonym, occurred_at DESC);

CREATE INDEX security_audit_event_expiry_idx
    ON security_audit_event(expires_at);

ALTER TABLE security_rate_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_audit_event ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE security_rate_limit IS
    'Persistent fixed-window counters keyed only by purpose-specific hashes';
COMMENT ON TABLE security_audit_event IS
    'Privacy-minimized security audit without email, IP, URLs, request bodies, cookies or tokens';
