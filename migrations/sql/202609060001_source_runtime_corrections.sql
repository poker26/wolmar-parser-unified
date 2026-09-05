-- Record live access failures and clarify discovery behavior observed after initial probes.
UPDATE catalog_source
   SET status='blocked',access_review_status='blocked',access_reviewed_at=now(),next_poll_at=NULL,
       last_error='Production connection to 46.21.255.34:443 times out before HTTP',
       notes=concat_ws(E'\n',NULLIF(notes,''),'2026-09-06 runtime review: product requests time out from production before HTTP. The first backfill saved 211 cards before connectivity failed. Keep those cards and resume the remaining archive only after a single-card probe succeeds.'),updated_at=now()
 WHERE source_key='monetnik.ru';

UPDATE catalog_source
   SET notes=concat_ws(E'\n',NULLIF(notes,''),'2026-09-06 probe correction: sitemap priority removes top-level pages but still includes some nested catalog sections. The card parser, not sitemap priority alone, is the final product and coin discriminator.'),updated_at=now()
 WHERE source_key='collectionmarket.ru';
