-- Coinsmart supplies catalog identity evidence from its complete product archive. Prices are excluded.
UPDATE catalog_source
   SET adapter_key='coinsmart-html',status='probing',price_role='none',
       access_review_status='allowed',access_reviewed_at=now(),
       poll_interval=interval '7 days',next_poll_at=now(),last_error=NULL,
       notes=concat_ws(E'\n',NULLIF(notes,''),'Robots.txt permits public product paths and five shop sitemap parts. Discovery keeps the complete old and modern product archive. The card parser admits only products in the coin category with a structured denomination, issue year and two source photographs. Old, unavailable and unsold cards remain eligible. Product prices and offers are ignored and never stored.'),
       updated_at=now()
 WHERE source_key='coinsmart.ru';
