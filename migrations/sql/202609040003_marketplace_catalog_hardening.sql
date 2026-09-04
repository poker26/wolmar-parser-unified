-- Retry state for the auction.ru catalog poller. A transient anti-bot page must not
-- permanently discard a catalog observation after one failed request.

ALTER TABLE IF EXISTS auctionru_queue
    ADD COLUMN IF NOT EXISTS fetch_failures INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_error TEXT,
    ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMPTZ;

DO $$
BEGIN
    IF to_regclass('public.auctionru_queue') IS NOT NULL THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS auctionru_queue_catalog_poll_idx
                 ON auctionru_queue(captured,next_check_at,last_checked)
                 WHERE COALESCE(status, '''') <> ''dead''';
    END IF;
END $$;
