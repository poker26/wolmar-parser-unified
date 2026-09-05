-- ECB pages provide primary identity evidence for EUR 2 commemorative issues. Prices are absent.
UPDATE catalog_source
   SET adapter_key='ecb-primary',status='probing',price_role='none',
       access_review_status='allowed',access_reviewed_at=now(),
       poll_interval=interval '7 days',next_poll_at=now(),last_error=NULL,
       notes=concat_ws(E'\n',NULLIF(notes,''),'Official annual pages cover EUR 2 commemorative issues from 2004 onward. The adapter observes robots.txt crawl-delay 5 and stores the national side together with the official common side. No price fields are collected.'),
       updated_at=now()
 WHERE source_key='ecb.europa.eu';

