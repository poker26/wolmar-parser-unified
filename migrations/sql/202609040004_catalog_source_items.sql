-- Dealer and reference catalog pages are catalog evidence, not auction lots.
-- Keep their structured identity data and images without copying asking prices.

CREATE TABLE catalog_source_item (
    id BIGSERIAL PRIMARY KEY,
    source_key TEXT NOT NULL REFERENCES catalog_source(source_key),
    source_item_key TEXT NOT NULL,
    source_url TEXT NOT NULL,
    item_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (item_status IN ('active', 'archive', 'unknown')),
    title TEXT NOT NULL,
    country TEXT,
    denomination TEXT,
    year INTEGER CHECK (year IS NULL OR year BETWEEN 1000 AND 2100),
    metal TEXT,
    weight_g NUMERIC,
    diameter_mm NUMERIC,
    mintage BIGINT,
    condition TEXT,
    themes TEXT[] NOT NULL DEFAULT '{}',
    avers_image_url TEXT,
    revers_image_url TEXT,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_key, source_item_key)
);

CREATE INDEX catalog_source_item_identity_idx
    ON catalog_source_item(source_key, country, year, denomination);

CREATE TABLE catalog_source_item_type_link (
    source_item_id BIGINT PRIMARY KEY REFERENCES catalog_source_item(id) ON DELETE CASCADE,
    type_id INTEGER NOT NULL REFERENCES coin_type(id) ON DELETE CASCADE,
    match_method TEXT NOT NULL,
    match_confidence NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE catalog_candidate_observation
    ADD COLUMN id BIGSERIAL,
    ADD COLUMN source_item_id BIGINT REFERENCES catalog_source_item(id) ON DELETE CASCADE;

ALTER TABLE catalog_candidate_observation
    DROP CONSTRAINT catalog_candidate_observation_pkey,
    DROP CONSTRAINT catalog_candidate_observation_lot_id_key,
    ALTER COLUMN lot_id DROP NOT NULL,
    ADD CONSTRAINT catalog_candidate_observation_pkey PRIMARY KEY (id),
    ADD CONSTRAINT catalog_candidate_observation_one_origin
        CHECK (num_nonnulls(lot_id, source_item_id) = 1);

CREATE UNIQUE INDEX catalog_candidate_observation_lot_unique
    ON catalog_candidate_observation(lot_id) WHERE lot_id IS NOT NULL;

CREATE UNIQUE INDEX catalog_candidate_observation_source_item_unique
    ON catalog_candidate_observation(source_item_id) WHERE source_item_id IS NOT NULL;

COMMENT ON TABLE catalog_source_item IS
    'Structured non-price catalog evidence collected from shops, mints and reference catalogs.';
COMMENT ON TABLE catalog_source_item_type_link IS
    'Idempotent link from one external catalog card to an existing or reviewed coin type.';

UPDATE catalog_source SET
    adapter_key='numizmat-shop',
    status='probing',
    access_review_status='allowed',
    access_reviewed_at=now(),
    poll_interval=interval '1 day',
    next_poll_at=now(),
    notes=concat_ws(E'\n',NULLIF(notes,''),
        'Official sitemap discovery; all individual coin years and archived cards are in scope. Asking prices are ignored.'),
    updated_at=now()
WHERE source_key='numizm.at';
