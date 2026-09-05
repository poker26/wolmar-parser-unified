-- EMK supplies dealer evidence for current and archived world-coin identities. Prices are excluded.
UPDATE catalog_source
   SET adapter_key='emk-graphql',status='probing',price_role='none',
       access_review_status='allowed',access_reviewed_at=now(),
       poll_interval=interval '7 days',next_poll_at=now(),last_error=NULL,
       notes=concat_ws(E'\n',NULLIF(notes,''),'The public English sitemap and Sana GraphQL product endpoint are allowed by robots.txt. Single-coin cards are retained even when the description omits the face value; such records remain stored-incomplete and cannot be linked or promoted automatically. Product queries exclude every price and offer field.'),
       updated_at=now()
 WHERE source_key='emk.com';
