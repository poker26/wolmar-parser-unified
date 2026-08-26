CREATE FUNCTION collection_normalize_grade(value TEXT) RETURNS TEXT AS $$
    SELECT CASE normalized
        WHEN 'PROOF' THEN 'PF'
        WHEN 'ПРУФ' THEN 'PF'
        WHEN 'АНЦ' THEN 'UNC'
        WHEN 'AUNC' THEN 'AU/UNC'
        ELSE normalized
    END
    FROM (
        SELECT upper(regexp_replace(btrim(value), '\s+', '', 'g')) normalized
    ) prepared
$$ LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE;

CREATE TABLE collection_valuation (
    id UUID PRIMARY KEY,
    item_id UUID NOT NULL REFERENCES collection_item(id) ON DELETE CASCADE,
    currency CHAR(3) NOT NULL DEFAULT 'RUB'
        CHECK (currency ~ '^[A-Z]{3}$'),
    low_minor BIGINT CHECK (low_minor IS NULL OR low_minor >= 0),
    median_minor BIGINT CHECK (median_minor IS NULL OR median_minor >= 0),
    high_minor BIGINT CHECK (high_minor IS NULL OR high_minor >= 0),
    grade_code TEXT,
    comparable_count INTEGER NOT NULL DEFAULT 0
        CHECK (comparable_count >= 0),
    confidence NUMERIC(4,3)
        CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    status TEXT NOT NULL
        CHECK (status IN ('ready', 'insufficient_data', 'failed')),
    method TEXT NOT NULL,
    model_version TEXT NOT NULL,
    basis JSONB NOT NULL DEFAULT '{}'::jsonb,
    abstain_reason TEXT,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (status = 'ready'
            AND comparable_count >= 3
            AND low_minor IS NOT NULL
            AND median_minor IS NOT NULL
            AND high_minor IS NOT NULL
            AND low_minor <= median_minor
            AND median_minor <= high_minor
            AND abstain_reason IS NULL)
        OR
        (status <> 'ready'
            AND low_minor IS NULL
            AND median_minor IS NULL
            AND high_minor IS NULL)
    )
);

CREATE INDEX collection_valuation_item_history_idx
    ON collection_valuation(item_id, calculated_at DESC, id DESC);

ALTER TABLE collection_valuation ENABLE ROW LEVEL SECURITY;

CREATE POLICY collection_valuation_owner_policy ON collection_valuation
    USING (
        EXISTS (
            SELECT 1
            FROM collection_item ci
            WHERE ci.id = collection_valuation.item_id
              AND ci.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM collection_item ci
            WHERE ci.id = collection_valuation.item_id
              AND ci.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        )
    );

COMMENT ON TABLE collection_valuation IS
    'Immutable collection valuation snapshots based on reproducible completed-sale sets';
