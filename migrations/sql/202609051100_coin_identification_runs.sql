CREATE TABLE coin_identification_run (
    request_id UUID PRIMARY KEY,
    image_sha256 TEXT[] NOT NULL DEFAULT '{}',
    observer_strategy TEXT NOT NULL DEFAULT 'unknown',
    observer_model TEXT,
    observer_prompt_sha256 CHAR(64)
        CHECK (observer_prompt_sha256 IS NULL OR observer_prompt_sha256 ~ '^[0-9a-f]{64}$'),
    matcher_version TEXT,
    catalog_version TEXT,
    catalog_fingerprint CHAR(64)
        CHECK (catalog_fingerprint IS NULL OR catalog_fingerprint ~ '^[0-9a-f]{64}$'),
    extracted JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(extracted) = 'object'),
    matcher_candidates JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(matcher_candidates) = 'array'),
    response_candidates JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(response_candidates) = 'array'),
    catalog_match TEXT
        CHECK (catalog_match IS NULL OR catalog_match IN ('exact', 'ambiguous', 'not_found')),
    status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
    embedding_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (embedding_status IN (
            'pending', 'ok', 'error', 'disabled', 'cancelled',
            'skipped_no_pool', 'skipped_image_count'
        )),
    embedding_protocol TEXT,
    embedding_model TEXT,
    embedding_index_version TEXT,
    embedding_adapter TEXT,
    embedding_candidates JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(embedding_candidates) = 'array'),
    timings_ms JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(timings_ms) = 'object'),
    error_code TEXT,
    embedding_error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (cardinality(image_sha256) BETWEEN 1 AND 2),
    CHECK (array_to_string(image_sha256, ',') ~ '^[0-9a-f]{64}(,[0-9a-f]{64})?$')
);

CREATE INDEX coin_identification_run_created_idx
    ON coin_identification_run(created_at DESC);

CREATE INDEX coin_identification_run_outcome_idx
    ON coin_identification_run(catalog_match, embedding_status, created_at DESC);

ALTER TABLE coin_identification_run ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE coin_identification_run IS
    'Internal reproducibility record for photo identification; stores image hashes, observations, candidate features, versions and timings, but no image bytes';

