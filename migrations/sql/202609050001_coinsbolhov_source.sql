-- Activate catalog-only ingestion for coinsbolhov.ru.
-- Official sitemap/card fields are used; asking prices remain out of scope.

UPDATE catalog_source SET
    adapter_key='coinsbolhov-shop',
    status='probing',
    access_review_status='allowed',
    access_reviewed_at=now(),
    poll_interval=interval '1 day',
    next_poll_at=now(),
    notes=concat_ws(E'\n',NULLIF(notes,''),
        'Official product sitemap discovery; all individual coin years and unavailable cards are in scope. Filters are not crawled. Asking prices are ignored.'),
    updated_at=now()
WHERE source_key='coinsbolhov.ru';
