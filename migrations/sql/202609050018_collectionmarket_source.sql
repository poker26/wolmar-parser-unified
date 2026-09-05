-- Collection Market supplies dealer identity evidence from old, current and unavailable product cards. Prices are excluded.
UPDATE catalog_source
   SET adapter_key='collectionmarket-html',status='probing',price_role='none',
       access_review_status='allowed',access_reviewed_at=now(),poll_interval=interval '7 days',next_poll_at=now(),last_error=NULL,
       notes=concat_ws(E'\n',NULLIF(notes,''),'Robots.txt permits public product paths and the sitemap. Sitemap priority separates section pages from product pages. Discovery keeps the complete old and modern product archive; structured card fields and two source photographs are required for coin evidence. Sets, banknotes and accessories are excluded. Product prices and offers are ignored and never stored.'),updated_at=now()
 WHERE source_key='collectionmarket.ru';
