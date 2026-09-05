-- Power Coin supplies structured dealer evidence for current and archived world coins. Prices are excluded.
UPDATE catalog_source
   SET adapter_key='powercoin-html',status='probing',price_role='none',
       access_review_status='allowed',access_reviewed_at=now(),
       poll_interval=interval '7 days',next_poll_at=now(),last_error=NULL,
       notes=concat_ws(E'\n',NULLIF(notes,''),'Robots.txt permits public English category and product pages. The initial backfill walks the five regional coin categories; recurring polls use the new-products section. Cards with missing identity fields remain stored-incomplete. Only cards with one exact country, year and face value are eligible for matching. Offer prices are ignored and never stored.'),
       updated_at=now()
 WHERE source_key='powercoin.it';
