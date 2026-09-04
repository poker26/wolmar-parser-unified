-- Operational registry for catalog discovery and confirmation sources.
-- Removing a source means retiring it: observations and run history stay intact.

CREATE TABLE catalog_source (
    source_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN (
        'auction_house', 'marketplace', 'shop', 'specialist_catalog',
        'central_bank', 'mint', 'producer'
    )),
    home_country TEXT,
    language_codes TEXT[] NOT NULL DEFAULT '{}',
    evidence_tier TEXT NOT NULL CHECK (evidence_tier IN (
        'primary', 'reference', 'dealer', 'marketplace'
    )),
    catalog_role TEXT NOT NULL DEFAULT 'discovery' CHECK (catalog_role IN (
        'discovery', 'confirmation', 'both'
    )),
    price_role TEXT NOT NULL DEFAULT 'none' CHECK (price_role IN (
        'none', 'asking', 'closed_sale', 'mixed'
    )),
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN (
        'proposed', 'probing', 'active', 'paused', 'blocked', 'retired'
    )),
    priority SMALLINT NOT NULL DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
    adapter_key TEXT,
    poll_interval INTERVAL CHECK (poll_interval IS NULL OR poll_interval > interval '0'),
    next_poll_at TIMESTAMPTZ,
    access_review_status TEXT NOT NULL DEFAULT 'unknown' CHECK (access_review_status IN (
        'unknown', 'allowed', 'restricted', 'blocked'
    )),
    access_reviewed_at TIMESTAMPTZ,
    last_probe_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    last_error TEXT,
    notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    retired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status = 'retired' OR retired_at IS NULL),
    CHECK (status <> 'active' OR adapter_key IS NOT NULL)
);

CREATE INDEX catalog_source_poll_idx
    ON catalog_source(status, next_poll_at, priority)
    WHERE status IN ('probing', 'active');

CREATE TABLE catalog_source_run (
    id BIGSERIAL PRIMARY KEY,
    source_key TEXT NOT NULL REFERENCES catalog_source(source_key),
    run_kind TEXT NOT NULL CHECK (run_kind IN ('probe', 'incremental', 'backfill')),
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
        'running', 'succeeded', 'partial', 'failed', 'cancelled'
    )),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    pages_fetched INTEGER NOT NULL DEFAULT 0 CHECK (pages_fetched >= 0),
    items_seen INTEGER NOT NULL DEFAULT 0 CHECK (items_seen >= 0),
    observations_saved INTEGER NOT NULL DEFAULT 0 CHECK (observations_saved >= 0),
    candidates_staged INTEGER NOT NULL DEFAULT 0 CHECK (candidates_staged >= 0),
    errors_count INTEGER NOT NULL DEFAULT 0 CHECK (errors_count >= 0),
    external_cost NUMERIC CHECK (external_cost IS NULL OR external_cost >= 0),
    cursor JSONB,
    error_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((status = 'running') = (finished_at IS NULL))
);

CREATE UNIQUE INDEX catalog_source_one_running_idx
    ON catalog_source_run(source_key, run_kind)
    WHERE status = 'running';

CREATE INDEX catalog_source_run_history_idx
    ON catalog_source_run(source_key, started_at DESC);

INSERT INTO catalog_source
    (source_key,display_name,base_url,source_kind,home_country,language_codes,
     evidence_tier,catalog_role,price_role,status,priority,adapter_key,poll_interval,notes)
VALUES
    ('wolmar.ru','Wolmar','https://www.wolmar.ru','auction_house','RU',ARRAY['ru'],'dealer','both','closed_sale','active',10,'wolmar',interval '1 day','Existing auction parser.'),
    ('numismat.ru','Numismat auction','https://numismat.ru','auction_house','RU',ARRAY['ru'],'dealer','both','closed_sale','active',10,'numismat',interval '1 day','Existing auction parser.'),
    ('auction.ru','Auction.ru','https://auction.ru','marketplace','RU',ARRAY['ru'],'marketplace','discovery','mixed','active',10,'auctionru',interval '1 day','Existing marketplace parser; all card outcomes are catalog evidence.'),
    ('meshok.net','Мешок','https://meshok.net','marketplace','RU',ARRAY['ru'],'marketplace','discovery','mixed','active',10,'meshok',interval '1 day','Existing marketplace parser; all card outcomes are catalog evidence.'),
    ('fcoins.ru','Fcoins','https://fcoins.ru','specialist_catalog','RU',ARRAY['ru'],'reference','confirmation','none','active',30,'fcoins',NULL,'Classification reference only; never a market-price source.'),
    ('cbr.ru','Банк России','https://cbr.ru','central_bank','RU',ARRAY['ru','en'],'primary','confirmation','none','active',5,'cbr',NULL,'Primary reference for Russian issues.'),

    ('numizm.at','Нумизмат','https://numizm.at','shop','RU',ARRAY['ru'],'dealer','both','none','proposed',10,NULL,NULL,'35,000+ items, daily additions, world-coin sections and archive.'),
    ('coinsbolhov.ru','Монеты — Болхов','https://coinsbolhov.ru','shop','RU',ARRAY['ru'],'dealer','both','none','proposed',15,NULL,NULL,'Structured filters by country, denomination, period and metal.'),
    ('imperial-mag.ru','Империал','https://imperial-mag.ru','shop','RU',ARRAY['ru'],'dealer','confirmation','none','proposed',35,NULL,NULL,'Strong in Russian types and varieties; lower priority for post-2019 world issues.'),
    ('xn--b1aga1affsn5f.xn--p1ai','Всемонеты.рф','https://всемонеты.рф','specialist_catalog','RU',ARRAY['ru'],'dealer','confirmation','none','proposed',40,NULL,NULL,'Primarily valuation and acquisition catalog; useful as corroboration.'),
    ('unicoin.ru','UniCoin','https://www.unicoin.ru','shop','RU',ARRAY['ru'],'dealer','both','none','proposed',10,NULL,NULL,'Large current catalog plus separate archive; rich structured attributes.'),
    ('monetnik.ru','Монетник','https://www.monetnik.ru','shop','RU',ARRAY['ru'],'dealer','both','none','proposed',10,NULL,NULL,'Broad modern world-coin catalog with item codes and specifications.'),
    ('numizmat.ru','NUMIZMAT.RU','https://numizmat.ru','shop','RU',ARRAY['ru'],'dealer','both','none','proposed',15,NULL,NULL,'Current Russian-language world-coin listings.'),
    ('vmiremonet.ru','В мире монет','https://vmiremonet.ru','shop','RU',ARRAY['ru'],'dealer','discovery','none','proposed',15,NULL,NULL,'Regular country, denomination, year and subject naming.'),
    ('nominal.club','Nominal.club','https://nominal.club','shop','RU',ARRAY['ru'],'dealer','discovery','none','proposed',20,NULL,NULL,'Fresh listings and pre-orders through 2026.'),
    ('monetarus.ru','Монетарус','https://monetarus.ru','shop','RU',ARRAY['ru'],'dealer','discovery','none','proposed',20,NULL,NULL,'Broad Russian and world assortment.'),
    ('moneta1.ru','Moneta1','https://moneta1.ru','shop','RU',ARRAY['ru'],'dealer','confirmation','none','proposed',25,NULL,NULL,'Modern Russia and popular international series.'),
    ('collectionmarket.ru','Collection Market','https://collectionmarket.ru','shop','RU',ARRAY['ru'],'dealer','discovery','none','proposed',25,NULL,NULL,'Fresh 2025-2026 issues with thematic categories.'),
    ('moneta-mira.ru','Монета-Мира','https://moneta-mira.ru','shop','RU',ARRAY['ru'],'dealer','confirmation','none','proposed',30,NULL,NULL,'Modern Russia and world commemoratives.'),
    ('coinsmart.ru','Coinsmart','https://coinsmart.ru','shop','RU',ARRAY['ru'],'dealer','discovery','none','proposed',30,NULL,NULL,'Current arrivals; pagination and card structure still need a probe.'),
    ('rmoneta.ru','Разменная монета','https://www.rmoneta.ru','shop','RU',ARRAY['ru'],'dealer','confirmation','none','proposed',40,NULL,NULL,'Smaller independent source.'),

    ('en.numista.com','Numista','https://en.numista.com/catalogue','specialist_catalog',NULL,ARRAY['en'],'reference','both','none','proposed',5,NULL,NULL,'Global specialist catalog; access and reuse terms require review.'),
    ('usmint.gov','United States Mint','https://www.usmint.gov','mint','US',ARRAY['en'],'primary','confirmation','none','proposed',5,NULL,NULL,'Primary source for United States issues.'),
    ('mint.ca','Royal Canadian Mint','https://www.mint.ca','mint','CA',ARRAY['en','fr'],'primary','confirmation','none','proposed',5,NULL,NULL,'Primary source for Canadian issues.'),
    ('royalmint.com','The Royal Mint','https://www.royalmint.com','mint','GB',ARRAY['en'],'primary','confirmation','none','proposed',5,NULL,NULL,'Primary source for United Kingdom issues.'),
    ('perthmint.com','The Perth Mint','https://www.perthmint.com','mint','AU',ARRAY['en'],'primary','confirmation','none','proposed',5,NULL,NULL,'Primary producer source for Australian and contracted issues.'),
    ('ecb.europa.eu','European Central Bank','https://www.ecb.europa.eu','central_bank','EU',ARRAY['en'],'primary','confirmation','none','proposed',5,NULL,NULL,'Primary reference for euro circulation and commemorative issues.'),
    ('emk.com','EMK','https://www.emk.com','shop','DE',ARRAY['en','de'],'dealer','both','none','proposed',10,NULL,NULL,'Highly structured current world-coin specifications, including unavailable cards.'),
    ('powercoin.it','Power Coin','https://www.powercoin.it','shop','IT',ARRAY['en','it'],'dealer','both','none','proposed',10,NULL,NULL,'Fresh collector issues with structured data sheets and release PDFs.'),
    ('numiscollect.eu','NumisCollect','https://www.numiscollect.eu','shop','NL',ARRAY['en'],'dealer','discovery','none','proposed',15,NULL,NULL,'Broad modern collector-coin dealer; requires technical and access probe.')
ON CONFLICT (source_key) DO NOTHING;

COMMENT ON TABLE catalog_source IS
    'Operational catalog of discovery and confirmation sources, including polling and access-review state.';
COMMENT ON COLUMN catalog_source.price_role IS
    'Explicit boundary for price analytics; none means the source must not contribute any price.';
COMMENT ON TABLE catalog_source_run IS
    'One auditable probe, incremental poll or backfill attempt for a catalog source.';
