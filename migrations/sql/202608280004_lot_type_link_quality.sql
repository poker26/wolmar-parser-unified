CREATE TABLE lot_type_link_quality (
    lot_id INTEGER PRIMARY KEY,
    type_id INTEGER NOT NULL,
    status TEXT NOT NULL
        CHECK (status IN ('consistent', 'conflict', 'unverified')),
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(reasons) = 'array'),
    evidence JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(evidence) = 'array'),
    audit_version TEXT NOT NULL,
    audited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX lot_type_link_quality_conflict_idx
    ON lot_type_link_quality(lot_id, type_id)
    WHERE status = 'conflict';

COMMENT ON TABLE lot_type_link_quality IS
    'Additive hard-consistency audit of lot-to-type links; conflicts are quarantined, never auto-relinked';
COMMENT ON COLUMN lot_type_link_quality.type_id IS
    'Snapshot of the linked type at audit time so a later relink does not inherit stale quarantine state';
