-- Record the second shop access review before adapter work continues.
UPDATE catalog_source
   SET status='blocked',access_review_status='restricted',access_reviewed_at=now(),
       next_poll_at=NULL,last_error='robots.txt excludes /catalog/moneta/* product cards',
       notes=concat_ws(E'\n',NULLIF(notes,''),'2026-09-05 access review: the sitemap is public, but robots.txt disallows the product-card paths required for catalog evidence. Do not crawl those paths. Revisit only if the site publishes an allowed feed or changes the rule.'),
       updated_at=now()
 WHERE source_key='numizmat.ru';

UPDATE catalog_source
   SET access_review_status='allowed',access_reviewed_at=now(),last_error=NULL,
       notes=concat_ws(E'\n',NULLIF(notes,''),'2026-09-05 access review: robots.txt permits the sitemap and public product pages. Seven shop sitemap parts currently expose about 62,900 URLs. Adapter work remains queued.'),
       updated_at=now()
 WHERE source_key='vmiremonet.ru';

UPDATE catalog_source
   SET base_url='https://shop.numiscollect.eu',access_review_status='allowed',access_reviewed_at=now(),last_error=NULL,
       notes=concat_ws(E'\n',NULLIF(notes,''),'2026-09-05 access review: the canonical shop moved to shop.numiscollect.eu. Robots.txt permits its product sitemap and public cards; five product maps currently expose about 1,300 URLs. Adapter work remains queued.'),
       updated_at=now()
 WHERE source_key='numiscollect.eu';
