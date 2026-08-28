ALTER TABLE auction_lots
    ADD COLUMN slab_status TEXT NOT NULL DEFAULT 'unknown',
    ADD COLUMN grading_company_code TEXT,
    ADD COLUMN grading_company_raw TEXT,
    ADD COLUMN slab_grade_code TEXT,
    ADD COLUMN grade_source TEXT NOT NULL DEFAULT 'unknown',
    ADD COLUMN slab_extractor_version TEXT,
    ADD COLUMN slab_evidence_text TEXT;

-- NOT VALID avoids scanning the 1 GB historical table while the DDL transaction
-- holds its metadata lock. PostgreSQL still enforces these checks for new rows.
ALTER TABLE auction_lots
    ADD CONSTRAINT auction_lots_slab_status_check CHECK (
        slab_status IN ('slabbed', 'raw', 'unknown')
    ) NOT VALID,
    ADD CONSTRAINT auction_lots_grading_company_code_check CHECK (
        grading_company_code IS NULL OR grading_company_code IN (
            'NGC', 'PCGS', 'NNR', 'RNGA', 'NRG', 'NGS', 'OTHER'
        )
    ) NOT VALID,
    ADD CONSTRAINT auction_lots_grade_source_check CHECK (
        grade_source IN ('slab_label', 'auction_house', 'user', 'unknown')
    ) NOT VALID,
    ADD CONSTRAINT auction_lots_slab_company_consistency CHECK (
        slab_status = 'slabbed'
        OR (grading_company_code IS NULL AND grading_company_raw IS NULL)
    ) NOT VALID,
    ADD CONSTRAINT auction_lots_slab_grade_consistency CHECK (
        slab_grade_code IS NULL
        OR (slab_status = 'slabbed' AND grade_source = 'slab_label')
    ) NOT VALID,
    ADD CONSTRAINT auction_lots_slab_company_pair CHECK (
        (grading_company_code IS NULL) = (grading_company_raw IS NULL)
    ) NOT VALID,
    ADD CONSTRAINT auction_lots_slab_evidence_length CHECK (
        slab_evidence_text IS NULL OR char_length(slab_evidence_text) <= 500
    ) NOT VALID;

ALTER TABLE collection_item
    ADD COLUMN slab_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (slab_status IN ('slabbed', 'raw', 'unknown')),
    ADD COLUMN grading_company_code TEXT
        CHECK (grading_company_code IS NULL OR grading_company_code IN (
            'NGC', 'PCGS', 'NNR', 'RNGA', 'NRG', 'NGS', 'OTHER'
        )),
    ADD COLUMN grading_company_raw TEXT,
    ADD COLUMN grade_source TEXT NOT NULL DEFAULT 'unknown'
        CHECK (grade_source IN ('slab_label', 'auction_house', 'user', 'unknown')),
    ADD CONSTRAINT collection_item_slab_company_consistency CHECK (
        slab_status = 'slabbed'
        OR (grading_company_code IS NULL AND grading_company_raw IS NULL)
    ),
    ADD CONSTRAINT collection_item_slab_company_pair CHECK (
        (grading_company_code IS NULL) = (grading_company_raw IS NULL)
    ),
    ADD CONSTRAINT collection_item_slab_label_consistency CHECK (
        grade_source <> 'slab_label' OR slab_status = 'slabbed'
    );

ALTER TABLE collection_valuation
    ADD COLUMN slab_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (slab_status IN ('slabbed', 'raw', 'unknown')),
    ADD COLUMN grading_company_code TEXT
        CHECK (grading_company_code IS NULL OR grading_company_code IN (
            'NGC', 'PCGS', 'NNR', 'RNGA', 'NRG', 'NGS', 'OTHER'
        )),
    ADD COLUMN grading_company_raw TEXT,
    ADD COLUMN grade_source TEXT NOT NULL DEFAULT 'unknown'
        CHECK (grade_source IN ('slab_label', 'auction_house', 'user', 'unknown')),
    ADD COLUMN basis_level TEXT,
    ADD COLUMN exact_comparable_count INTEGER
        CHECK (exact_comparable_count IS NULL OR exact_comparable_count >= 0),
    ADD COLUMN expanded_comparable_count INTEGER
        CHECK (expanded_comparable_count IS NULL OR expanded_comparable_count >= 0),
    ADD CONSTRAINT collection_valuation_slab_company_consistency CHECK (
        slab_status = 'slabbed'
        OR (grading_company_code IS NULL AND grading_company_raw IS NULL)
    ),
    ADD CONSTRAINT collection_valuation_slab_company_pair CHECK (
        (grading_company_code IS NULL) = (grading_company_raw IS NULL)
    ),
    ADD CONSTRAINT collection_valuation_slab_label_consistency CHECK (
        grade_source <> 'slab_label' OR slab_status = 'slabbed'
    );

COMMENT ON COLUMN auction_lots.slab_status IS
    'Physical holder status for this auction lot; missing historical evidence remains unknown';
COMMENT ON COLUMN collection_item.slab_status IS
    'Physical holder status for this collection specimen, never a coin_type property';
COMMENT ON COLUMN collection_valuation.basis_level IS
    'Comparable-expansion level captured when this immutable valuation was calculated';
