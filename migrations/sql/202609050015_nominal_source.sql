-- Nominal.club supplies dealer identity evidence for old and modern coin issues. Prices are excluded.
UPDATE catalog_source
   SET adapter_key='nominal-dated-html',status='probing',price_role='none',
       access_review_status='allowed',access_reviewed_at=now(),
       poll_interval=interval '7 days',next_poll_at=now(),last_error=NULL,
       notes=concat_ws(E'\n',NULLIF(notes,''),'Robots.txt permits public sitemap and product pages. Discovery reads twelve shop sitemap parts and selects dated coin-card paths across the full available period, including old and unavailable listings. Product characteristics confirm the issue year and identity. Sets, tokens and banknotes are excluded. Product prices and offers are ignored and never stored.'),
       updated_at=now()
 WHERE source_key='nominal.club';
