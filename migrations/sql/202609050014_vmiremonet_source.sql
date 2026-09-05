-- V mire monet supplies dealer identity evidence for post-Krause coin issues. Prices are excluded.
UPDATE catalog_source
   SET adapter_key='vmiremonet-modern-html',status='probing',price_role='none',
       access_review_status='allowed',access_reviewed_at=now(),
       poll_interval=interval '7 days',next_poll_at=now(),last_error=NULL,
       notes=concat_ws(E'\n',NULLIF(notes,''),'Robots.txt permits public sitemap and product pages. Discovery reads seven shop sitemap parts but selects only /moneta-* URLs whose slug contains an issue year from 2019 through 2026. Current, unavailable and old listing cards remain eligible. Sets, tokens and banknotes are excluded. Product prices and offers are ignored and never stored.'),
       updated_at=now()
 WHERE source_key='vmiremonet.ru';
