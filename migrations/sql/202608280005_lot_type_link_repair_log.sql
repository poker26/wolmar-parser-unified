CREATE TABLE lot_type_link_repair_log (
    id BIGSERIAL PRIMARY KEY,
    lot_id INTEGER NOT NULL,
    old_type_id INTEGER NOT NULL,
    new_type_id INTEGER NOT NULL,
    old_match_method TEXT,
    old_match_confidence NUMERIC,
    repair_reason TEXT NOT NULL
        CHECK (repair_reason IN (
            'denomination_exact',
            'year_exact',
            'mint_exact',
            'manual_verified'
        )),
    audit_version TEXT NOT NULL,
    audit_evidence JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(audit_evidence) = 'array'),
    repaired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (old_type_id <> new_type_id)
);

CREATE INDEX lot_type_link_repair_log_lot_idx
    ON lot_type_link_repair_log(lot_id, repaired_at DESC, id DESC);

COMMENT ON TABLE lot_type_link_repair_log IS
    'Append-only evidence for manually reviewed lot_type_link corrections; preserves the previous link for rollback';
