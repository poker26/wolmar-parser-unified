ALTER TABLE collection_item
    ADD COLUMN slab_certificate_number TEXT,
    ADD COLUMN valuation_invalidated_at TIMESTAMPTZ;

ALTER TABLE collection_item
    ADD CONSTRAINT collection_item_slab_certificate_consistency CHECK (
        slab_status = 'slabbed' OR slab_certificate_number IS NULL
    ),
    ADD CONSTRAINT collection_item_slab_certificate_length CHECK (
        slab_certificate_number IS NULL OR char_length(slab_certificate_number) <= 100
    );

ALTER TABLE collection_valuation
    DROP CONSTRAINT IF EXISTS collection_valuation_grade_source_check;

ALTER TABLE collection_valuation
    ADD CONSTRAINT collection_valuation_grade_source_check CHECK (
        grade_source IN ('slab_label', 'auction_house', 'user', 'heuristic', 'unknown')
    );

DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'collection_valuation'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%comparable_count >= 3%'
    LIMIT 1;

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE collection_valuation DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

ALTER TABLE collection_valuation
    ADD CONSTRAINT collection_valuation_result_consistency_v2 CHECK (
        (status = 'ready'
            AND comparable_count >= 0
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
    );
