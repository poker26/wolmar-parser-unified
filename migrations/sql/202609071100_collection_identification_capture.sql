ALTER TABLE coin_identification_run
    ADD COLUMN user_id UUID REFERENCES app_user(id) ON DELETE SET NULL;

CREATE INDEX coin_identification_run_user_created_idx
    ON coin_identification_run(user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

ALTER TABLE collection_identification_label
    ADD COLUMN source_request_id UUID REFERENCES coin_identification_run(request_id) ON DELETE SET NULL;

CREATE UNIQUE INDEX collection_identification_label_source_request_idx
    ON collection_identification_label(source_request_id)
    WHERE source_request_id IS NOT NULL;

COMMENT ON COLUMN coin_identification_run.user_id IS
    'Authenticated owner assigned by the public API after the internal identification run completes';
COMMENT ON COLUMN collection_identification_label.source_request_id IS
    'Identification run from which the user selected the catalog type';
