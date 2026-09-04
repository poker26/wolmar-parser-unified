-- Access decisions recorded before writing new adapters.
UPDATE catalog_source
   SET status='blocked',access_review_status='restricted',access_reviewed_at=now(),
       last_error='Numista API terms prohibit persistent catalogue storage and systematic bulk retrieval.',
       notes=concat_ws(E'\n',NULLIF(notes,''),'2026-09-05 review: retain as a manual reference. API catalogue data cannot feed the persistent Wolmar catalogue without separate written permission.'),
       updated_at=now()
 WHERE source_key='en.numista.com';

UPDATE catalog_source
   SET status='blocked',access_review_status='blocked',access_reviewed_at=now(),
       last_error='The production host receives HTTP 403 for public catalogue pages.',
       notes=concat_ws(E'\n',NULLIF(notes,''),'2026-09-05 technical review: revisit if the public source becomes reachable or an official data feed appears.'),
       updated_at=now()
 WHERE source_key IN ('usmint.gov','mint.ca','perthmint.com');
