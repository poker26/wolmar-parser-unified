-- The Royal Mint is an official identity source. Prices are excluded from ingestion.
UPDATE catalog_source
   SET adapter_key='royalmint-primary',status='probing',price_role='none',
       access_review_status='allowed',access_reviewed_at=now(),
       poll_interval=interval '7 days',next_poll_at=now(),last_error=NULL,
       notes=concat_ws(E'\n',NULLIF(notes,''),'The public commerce sitemap and product cards are allowed by robots.txt. Only single-coin cards with an exact year, denomination and product code are ingested. Prices and offer fields are ignored.'),
       updated_at=now()
 WHERE source_key='royalmint.com';
