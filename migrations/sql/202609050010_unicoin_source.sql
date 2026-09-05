-- UniCoin supplies current and archived dealer evidence. Prices are excluded.
UPDATE catalog_source
   SET adapter_key='unicoin-news-html',status='probing',price_role='none',
       access_review_status='allowed',access_reviewed_at=now(),
       poll_interval=interval '7 days',next_poll_at=now(),last_error=NULL,
       notes=concat_ws(E'\n',NULLIF(notes,''),'Robots.txt allows sitemap news and product pages and requires a five-second crawl delay. Pagination under /start/ remains excluded. The initial backfill discovers historical product links through every news page in the official sitemap; recurring polls read the newest three news pages. Current and archived individual coin cards are retained. Prices are ignored and never stored.'),
       updated_at=now()
 WHERE source_key='unicoin.ru';
