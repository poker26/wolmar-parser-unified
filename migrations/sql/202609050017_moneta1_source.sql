-- Moneta1 supplies dealer identity evidence from its complete old and modern product archive. Prices are excluded.
UPDATE catalog_source
   SET adapter_key='moneta1-html',status='probing',price_role='none',
       access_review_status='allowed',access_reviewed_at=now(),
       poll_interval=interval '7 days',next_poll_at=now(),last_error=NULL,
       notes=concat_ws(E'\n',NULLIF(notes,''),'Robots.txt permits public sitemap and product pages. Three shop sitemap parts expose product URLs separately from category URLs, so discovery keeps the complete old and modern product archive. Cards must identify one coin and provide structured country, denomination, issue year and both photographs. Product prices and offers are ignored and never stored.'),
       updated_at=now()
 WHERE source_key='moneta1.ru';
