-- Monetarus cannot be fetched safely until its server sends a complete TLS chain.
UPDATE catalog_source
   SET status='blocked',access_review_status='blocked',access_reviewed_at=now(),
       next_poll_at=NULL,last_error='TLS certificate chain is incomplete; standard HTTPS verification fails',
       notes=concat_ws(E'\n',NULLIF(notes,''),'2026-09-05 access review: robots.txt permits public product cards and six shop sitemap parts exist, but the server omits a trusted intermediate certificate. Do not disable TLS verification. Recheck after the site fixes its certificate chain.'),
       updated_at=now()
 WHERE source_key='monetarus.ru';
