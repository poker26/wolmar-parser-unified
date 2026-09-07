-- rmoneta supplies catalog identity evidence from active and archived cards. Prices are excluded.
UPDATE catalog_source
   SET adapter_key='rmoneta-html',status='probing',price_role='none',
       access_review_status='allowed',access_reviewed_at=now(),
       poll_interval=interval '7 days',next_poll_at=now(),last_error=NULL,
       notes=concat_ws(E'\n',NULLIF(notes,''),'Robots.txt permits public catalog cards and publishes a dedicated catalog sitemap. Discovery keeps every numeric product leaf, including the large archive. The card parser requires a single-coin title with an exact issue year, a recognized denomination and the source composite image that shows both coin sides. Adjacent paper money, accessories, sets and cards with uncertain years remain excluded. Card availability does not affect catalog eligibility. Product prices and offers are ignored and never stored.'),
       updated_at=now()
 WHERE source_key='rmoneta.ru';
