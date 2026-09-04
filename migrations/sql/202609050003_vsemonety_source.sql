-- Activate catalog-only ingestion for the public reference catalog at всемонеты.рф.

UPDATE catalog_source SET
    adapter_key='vsemonety-catalog',
    status='probing',
    access_review_status='allowed',
    access_reviewed_at=now(),
    poll_interval=interval '7 days',
    next_poll_at=now(),
    notes=concat_ws(E'\n',NULLIF(notes,''),
        'The public sitemap lists reference cards. Only pages with product identity, country, denomination and one exact year are ingested. Valuation figures are ignored. A single composite obverse and reverse image is stored as the primary image.'),
    updated_at=now()
WHERE source_key='xn--b1aga1affsn5f.xn--p1ai';
