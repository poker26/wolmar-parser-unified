-- Monetnik.ru supplies dealer identity evidence for post-Krause coin issues. Prices are excluded.
UPDATE catalog_source
   SET adapter_key='monetnik-modern-html',status='probing',price_role='none',
       access_review_status='allowed',access_reviewed_at=now(),
       poll_interval=interval '7 days',next_poll_at=now(),last_error=NULL,
       notes=concat_ws(E'\n',NULLIF(notes,''),'Robots.txt permits public sitemap and /monety/ product pages. Discovery reads all sitemap parts but selects only coin URLs whose slug contains an issue year from 2019 onward. Current, unavailable and old listing cards remain eligible. Product prices and offers are ignored and never stored.'),
       updated_at=now()
 WHERE source_key='monetnik.ru';
