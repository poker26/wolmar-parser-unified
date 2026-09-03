CREATE TABLE collection_identification_label (
    item_id UUID PRIMARY KEY REFERENCES collection_item(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    selected_type_id INTEGER NOT NULL REFERENCES coin_type(id) ON DELETE RESTRICT,
    decision TEXT NOT NULL
        CHECK (decision IN ('accepted_top', 'selected_alternative', 'manual_correction')),
    strategy TEXT NOT NULL DEFAULT 'qwen_single_pass_v1',
    catalog_match TEXT
        CHECK (catalog_match IS NULL OR catalog_match IN ('exact', 'ambiguous', 'not_found')),
    proposed_type_ids INTEGER[] NOT NULL DEFAULT '{}',
    recognized_name TEXT,
    extracted JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(extracted) = 'object'),
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX collection_identification_label_type_idx
    ON collection_identification_label(selected_type_id, confirmed_at DESC);

CREATE INDEX collection_identification_label_user_idx
    ON collection_identification_label(user_id, confirmed_at DESC);

ALTER TABLE collection_identification_label ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE collection_identification_label IS
    'User-confirmed catalog labels for collection photo pairs; source for a reviewed training corpus';
