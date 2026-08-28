ALTER TABLE valuation_shadow_result
    ADD COLUMN evaluation_kind TEXT NOT NULL DEFAULT 'online_shadow'
        CHECK (evaluation_kind IN ('online_shadow', 'backtest')),
    ADD COLUMN actual_minor BIGINT
        CHECK (actual_minor IS NULL OR actual_minor > 0),
    ADD CONSTRAINT valuation_shadow_backtest_actual_check CHECK (
        evaluation_kind <> 'backtest' OR actual_minor IS NOT NULL
    );

CREATE INDEX valuation_shadow_result_backtest_idx
    ON valuation_shadow_result(evaluation_kind, method_version, created_at DESC, id DESC);

COMMENT ON COLUMN valuation_shadow_result.actual_minor IS
    'Observed completed-sale price for time-split backtest targets only';
