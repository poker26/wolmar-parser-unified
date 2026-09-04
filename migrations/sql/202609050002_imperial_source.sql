-- Activate catalog-only ingestion for imperial-mag.ru.

UPDATE catalog_source SET
    adapter_key='imperial-shop',
    status='probing',
    access_review_status='allowed',
    access_reviewed_at=now(),
    poll_interval=interval '1 day',
    next_poll_at=now(),
    notes=concat_ws(E'\n',NULLIF(notes,''),
        'Public sitemap discovery; all individual coin years and unavailable cards are in scope. Sets and collections are excluded by card identity. Asking prices and metal-value calculations are ignored.'),
    updated_at=now()
WHERE source_key='imperial-mag.ru';
