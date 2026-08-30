CREATE TABLE valuation_shadow_result (
    id BIGSERIAL PRIMARY KEY,
    run_id UUID NOT NULL,
    target_kind TEXT NOT NULL
        CHECK (target_kind IN ('auction_lot', 'collection_item')),
    target_id TEXT NOT NULL,
    input JSONB NOT NULL,
    result JSONB NOT NULL,
    status TEXT NOT NULL
        CHECK (status IN ('ready', 'insufficient_data', 'failed')),
    low_minor BIGINT CHECK (low_minor IS NULL OR low_minor >= 0),
    median_minor BIGINT CHECK (median_minor IS NULL OR median_minor >= 0),
    high_minor BIGINT CHECK (high_minor IS NULL OR high_minor >= 0),
    confidence TEXT NOT NULL
        CHECK (confidence IN ('low', 'medium', 'high')),
    basis_level TEXT,
    exact_comparable_count INTEGER NOT NULL DEFAULT 0
        CHECK (exact_comparable_count >= 0),
    expanded_comparable_count INTEGER NOT NULL DEFAULT 0
        CHECK (expanded_comparable_count >= 0),
    method_version TEXT NOT NULL,
    legacy_median_minor BIGINT CHECK (legacy_median_minor IS NULL OR legacy_median_minor >= 0),
    legacy_method TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, target_kind, target_id),
    CHECK (
        (status = 'ready'
            AND low_minor IS NOT NULL
            AND median_minor IS NOT NULL
            AND high_minor IS NOT NULL
            AND low_minor <= median_minor
            AND median_minor <= high_minor)
        OR
        (status <> 'ready'
            AND low_minor IS NULL
            AND median_minor IS NULL
            AND high_minor IS NULL)
    )
);

CREATE INDEX valuation_shadow_result_run_idx
    ON valuation_shadow_result(run_id, target_kind, created_at, id);

COMMENT ON TABLE valuation_shadow_result IS
    'Isolated slab-aware shadow calculations; never read by user-facing price APIs';
