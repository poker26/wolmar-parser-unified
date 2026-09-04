-- Marketplace and shop listings are evidence for catalog identity even when
-- they never produce a sale. Keep that evidence outside public coin_type until
-- it has been reviewed, and retain the exact source observations behind it.

CREATE TABLE catalog_candidate (
    id BIGSERIAL PRIMARY KEY,
    candidate_key TEXT NOT NULL UNIQUE,
    era TEXT NOT NULL CHECK (era IN ('foreign', 'modern')),
    country TEXT NOT NULL,
    denomination_text TEXT NOT NULL,
    denomination_value NUMERIC,
    year INTEGER NOT NULL,
    theme_core TEXT NOT NULL,
    name_full TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'rejected', 'promoted')),
    promoted_type_id INTEGER REFERENCES coin_type(id) ON DELETE SET NULL,
    review_note TEXT,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (year BETWEEN 1000 AND 2100)
);

CREATE INDEX catalog_candidate_review_idx
    ON catalog_candidate(status, last_seen_at DESC);

CREATE TABLE catalog_candidate_observation (
    candidate_id BIGINT NOT NULL REFERENCES catalog_candidate(id) ON DELETE CASCADE,
    lot_id INTEGER NOT NULL REFERENCES auction_lots(id) ON DELETE CASCADE,
    source_site TEXT NOT NULL,
    source_lot_number TEXT,
    source_url TEXT,
    lot_status TEXT,
    observed_title TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (candidate_id, lot_id),
    UNIQUE (lot_id)
);

CREATE INDEX catalog_candidate_observation_source_idx
    ON catalog_candidate_observation(source_site, observed_at DESC);

COMMENT ON TABLE catalog_candidate IS
    'Non-public catalog identities inferred from source listings; promotion requires an explicit review action.';
COMMENT ON TABLE catalog_candidate_observation IS
    'Exact active, sold, or unsold source listings supporting a catalog candidate; prices are deliberately not copied here.';
