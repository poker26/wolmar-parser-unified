-- Dealer archives remain useful for missing catalog types regardless of listing age or availability.
UPDATE catalog_source
   SET adapter_key='vmiremonet-html',
       notes=concat_ws(E'\n',NULLIF(notes,''),'2026-09-06 scope correction: discovery now keeps every /moneta-* product card. An exact structured year, denomination, country and both source photographs remain required. There is no lower issue-year boundary.'),
       updated_at=now()
 WHERE source_key='vmiremonet.ru';

UPDATE catalog_source
   SET adapter_key='monetnik-html',
       notes=concat_ws(E'\n',NULLIF(notes,''),'2026-09-06 scope correction: discovery now keeps every /monety/ product card with a stable item id. The card parser decides whether an exact-year single coin is usable. There is no lower issue-year boundary. The production connectivity block remains in force.'),
       updated_at=now()
 WHERE source_key='monetnik.ru';
