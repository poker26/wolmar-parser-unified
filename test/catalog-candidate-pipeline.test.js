'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    classifyMeshokObservation,
    classifyAuctionRuObservation,
    isAuctionRuCardPage,
    meshokImageUrls,
    normalizeMeshokMode,
    parseAuctionRuPage,
} = require('../catalog/marketplace-observation');
const { candidateKey, evaluateCandidateEvidence, publicationIdentity } = require('../catalog/catalog-candidates');
const { parseTitle } = require('../catalog/coin-matcher');
const { sourceKey } = require('../catalog/source-registry');
const { fetchAuctionRuHtml } = require('../catalog/auctionru-fetch');
const { CATS: MESHOK_CATEGORIES, buildTargets: buildMeshokTargets } = require('../temporal/start-meshok-harvest');

const root = path.resolve(__dirname, '..');

test('meshok keeps unsold and active cards for catalog without inventing sale prices', () => {
    assert.deepEqual(
        classifyMeshokObservation({ mode: 'ended', bidsCount: 0, price: 1500 }),
        { lotStatus: 'ended_unsold', storedPrice: null, isSale: false },
    );
    assert.deepEqual(
        classifyMeshokObservation({ mode: 'ended', bidsCount: 3, price: 1700 }),
        { lotStatus: 'sold', storedPrice: 1700, isSale: true },
    );
    assert.deepEqual(
        classifyMeshokObservation({ mode: 'active', bidsCount: 0, price: 1900 }),
        { lotStatus: 'active', storedPrice: 1900, isSale: false },
    );
    assert.deepEqual(
        classifyMeshokObservation({ mode: 'fixed', bidsCount: 0, price: 2100 }),
        { lotStatus: 'active', storedPrice: 2100, isSale: false },
    );
});

test('explicit banknote condition PRESS is rejected before catalog staging', () => {
    assert.equal(parseTitle('50 фунтов Сирия 2021 пресс').isNonCoin, true);
    assert.equal(parseTitle('10 рублей 2025 Россия Город трудовой доблести').isNonCoin, false);
});

test('meshok extracts one original image per picture and supports fixed-price listing mode', () => {
    const images = meshokImageUrls({
        pictures: [
            { url: '/i/123.0.jpg?1', thumbnail: { x2: '/i/123.0.208x208.jpg?1' } },
            { url: '/i/123.1.jpg?1', thumbnail: { x2: '/i/123.1.208x208.jpg?1' } },
        ],
        seller: { avatarThumbnailURL: '/a/42.120x120.jpg?1' },
    });
    assert.deepEqual(images, [
        'https://meshok.net/i/123.0.jpg?1',
        'https://meshok.net/i/123.1.jpg?1',
    ]);
    assert.equal(normalizeMeshokMode(null, 3), 'fixed');
    assert.equal(normalizeMeshokMode('active'), 'active');
    assert.equal(normalizeMeshokMode(true), 'sold');
});

test('meshok scheduler covers auction, ended and fixed-price listings for every category', () => {
    const targets = buildMeshokTargets(7, 2, 3);
    assert.equal(targets.length, MESHOK_CATEGORIES.length * 3);
    for (const mode of ['sold', 'active', 'fixed']) {
        assert.equal(targets.filter((target) => target.mode === mode).length, MESHOK_CATEGORIES.length);
    }
    assert.equal(targets.find((target) => target.mode === 'sold').maxPages, 7);
    assert.equal(targets.find((target) => target.mode === 'fixed').maxPages, 3);
});

test('a future meshok end date remains active even if it came from an ended listing', () => {
    const result = classifyMeshokObservation({
        mode: 'ended', bidsCount: 2, price: 1000,
        endDate: '2030-01-01T00:00:00Z', now: Date.parse('2026-01-01T00:00:00Z'),
    });
    assert.equal(result.lotStatus, 'active');
    assert.equal(result.isSale, false);
});

test('auction.ru terminal cards without bids remain catalog evidence, not sales', () => {
    assert.deepEqual(
        classifyAuctionRuObservation({ availability: 'OutOfStock', hasBids: false, price: 2500 }),
        { lotStatus: 'ended_unsold', storedPrice: null, isSale: false, terminal: true },
    );
    assert.deepEqual(
        classifyAuctionRuObservation({ availability: 'SoldOut', hasBids: true, price: 2600 }),
        { lotStatus: 'sold', storedPrice: 2600, isSale: true, terminal: true },
    );
    assert.deepEqual(
        classifyAuctionRuObservation({ availability: 'InStock', hasBids: false, price: 2700 }),
        { lotStatus: 'active', storedPrice: 2700, isSale: false, terminal: false },
    );
});

test('auction.ru card parser retains two source photos for catalog review', () => {
    const html = `
      <title>Ниуэ 2 доллара 2025</title>
      <meta property="og:title" content="Ниуэ 2 доллара 2025">
      <script>{"availability":"https://schema.org/InStock","price":"2700"}</script>
      <img src="https://static.auction.ru/offer_images/2026/09/01/a.jpg">
      <img src="https://static.auction.ru/offer_images/2026/09/01/b.jpeg">
    `;
    const parsed = parseAuctionRuPage(html);
    assert.equal(parsed.availability, 'InStock');
    assert.equal(parsed.price, 2700);
    assert.deepEqual(parsed.photos, [
        'https://static.auction.ru/offer_images/2026/09/01/a.jpg',
        'https://static.auction.ru/offer_images/2026/09/01/b.jpeg',
    ]);
    assert.equal(isAuctionRuCardPage(html, parsed), true);
    const challenge = '<title>DDoS-Guard: проверка браузера</title><main>challenge</main>';
    assert.equal(isAuctionRuCardPage(challenge, parseAuctionRuPage(challenge)), false);
});

test('auction.ru poller uses fast HTTP and falls back to a browser only for an invalid card', async () => {
    let browserCalls = 0;
    const response = (body) => ({
        ok: true,
        status: 200,
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () => body,
    });
    const browserFetch = async () => { browserCalls += 1; return 'browser-card'; };
    const direct = await fetchAuctionRuHtml('https://auction.ru/offer/x-i1.html', {
        fetchImpl: async () => response('direct-card'),
        browserFetch,
        validate: (html) => html.endsWith('card'),
    });
    assert.equal(direct, 'direct-card');
    assert.equal(browserCalls, 0);
    const fallback = await fetchAuctionRuHtml('https://auction.ru/offer/x-i2.html', {
        fetchImpl: async () => response('challenge'),
        browserFetch,
        validate: (html) => html.endsWith('card'),
    });
    assert.equal(fallback, 'browser-card');
    assert.equal(browserCalls, 1);
});

test('browser fallback removes its temporary Chrome profile after closing', () => {
    const browserFetch = fs.readFileSync(path.join(root, 'catalog', 'browser-fetch.js'), 'utf8');
    assert.match(browserFetch, /path\.join\(os\.tmpdir\(\), `chrome-bf-\$\{process\.pid\}`\)/);
    assert.match(browserFetch, /fs\.rm\(closedProfileDir, \{ recursive: true, force: true \}\)/);
});

test('marketplace evidence stays pending until an authoritative source or two photographed shops exist', () => {
    const marketplaceOnly = evaluateCandidateEvidence([
        { source_site: 'auction.ru', evidence_tier: 'marketplace', avers_image_url: '/a.jpg', revers_image_url: '/b.jpg' },
        { source_site: 'meshok.net', evidence_tier: 'marketplace', avers_image_url: '/c.jpg', revers_image_url: '/d.jpg' },
    ]);
    assert.equal(marketplaceOnly.ready, false);
    assert.match(marketplaceOnly.reasons.join(' '), /primary\/reference/);

    const confirmed = evaluateCandidateEvidence([
        { source_site: 'auction.ru', evidence_tier: 'marketplace', avers_image_url: '/a.jpg', revers_image_url: '/b.jpg' },
        { source_site: 'en.numista.com', evidence_tier: 'reference', avers_image_url: null, revers_image_url: null },
    ]);
    assert.equal(confirmed.ready, true);

    const twoShops = evaluateCandidateEvidence([
        { source_site: 'emk.com', evidence_tier: 'dealer', source_kind: 'shop', avers_image_url: '/a.jpg', revers_image_url: '/b.jpg' },
        { source_site: 'powercoin.it', evidence_tier: 'dealer', source_kind: 'shop', avers_image_url: '/c.jpg', revers_image_url: '/d.jpg' },
    ]);
    assert.equal(twoShops.ready, true);
    assert.equal(twoShops.dealerShopSources, 2);

    const repeatedShop = evaluateCandidateEvidence([
        { source_site: 'emk.com', evidence_tier: 'dealer', source_kind: 'shop', avers_image_url: '/a.jpg', revers_image_url: '/b.jpg' },
        { source_site: 'emk.com', evidence_tier: 'dealer', source_kind: 'shop', avers_image_url: '/c.jpg', revers_image_url: '/d.jpg' },
        { source_site: 'numismat.ru', evidence_tier: 'dealer', source_kind: 'auction_house', avers_image_url: '/e.jpg', revers_image_url: '/f.jpg' },
    ]);
    assert.equal(repeatedShop.ready, false);
    assert.equal(repeatedShop.dealerShopSources, 1);
});

test('promotion uses one matching authoritative source theme and abstains on disagreement', () => {
    const candidate = {
        country: 'Estonia', year: 2025, denomination_text: '2 евро',
        theme_core: 'short theme', name_full: 'short candidate name',
    };
    const official = publicationIdentity(candidate, [{
        source_item_id: '1', evidence_tier: 'primary', source_country: 'Estonia', source_year: 2025,
        source_themes: ['The 500th anniversary of the first publication containing words in Estonian'],
    }]);
    assert.equal(official.themeCore, 'The 500th anniversary of the first publication containing words in Estonian');
    assert.match(official.nameFull, /The 500th anniversary/);

    const disagreement = publicationIdentity(candidate, [
        { source_item_id: '1', evidence_tier: 'primary', source_country: 'Estonia', source_year: 2025, source_themes: ['Theme A'] },
        { source_item_id: '2', evidence_tier: 'reference', source_country: 'Estonia', source_year: 2025, source_themes: ['Theme B'] },
    ]);
    assert.equal(disagreement.themeCore, candidate.theme_core);
    assert.equal(disagreement.nameFull, candidate.name_full);
});

test('promotion retains a long authoritative title without truncation', () => {
    const longTheme = `The ${'complete official wording '.repeat(12).trim()}`;
    assert.ok(longTheme.length > 250);
    const publication = publicationIdentity({
        country: 'Malta', year: 2025, denomination_text: '2 евро',
        theme_core: 'short theme', name_full: 'short candidate name',
    }, [{
        source_item_id: '1', evidence_tier: 'primary', source_country: 'Malta', source_year: 2025,
        source_themes: [longTheme],
    }]);
    assert.equal(publication.themeCore, longTheme);
    assert.match(publication.nameFull, new RegExp(`${longTheme}$`));
});

test('promotion accepts a conservative country alias but rejects another country', () => {
    const candidate = {
        country: 'Vatican City', year: 2023, denomination_text: '2 евро',
        theme_core: 'short theme', name_full: 'short candidate name',
    };
    const vatican = publicationIdentity(candidate, [{
        source_item_id: '1', evidence_tier: 'primary', source_country: 'Vatican', source_year: 2023,
        source_themes: ['The 5th Centenary of the death of Pietro Perugino'],
    }]);
    assert.equal(vatican.themeCore, 'The 5th Centenary of the death of Pietro Perugino');

    const sanMarino = publicationIdentity(candidate, [{
        source_item_id: '2', evidence_tier: 'primary', source_country: 'San Marino', source_year: 2023,
        source_themes: ['A different country'],
    }]);
    assert.equal(sanMarino.themeCore, candidate.theme_core);
});

test('promotion retains one Royal Mint title and its physical specifications', () => {
    const candidate = {
        country: 'United Kingdom', year: 2024, denomination_text: '5 фунтов',
        theme_core: 'tudor dragon', name_full: 'short candidate name',
    };
    const publication = publicationIdentity(candidate, [{
        source_item_id: '1', source_site: 'royalmint.com', evidence_tier: 'primary',
        source_country: 'United Kingdom', source_year: 2024, source_themes: [],
        source_title: 'The Tudor Dragon 2024 UK £5 Silver Proof Coin',
        source_metal: 'Sterling Silver', source_weight_g: '28.28', source_diameter_mm: '38.61',
        source_mintage: '3210', source_condition: 'Proof',
    }]);
    assert.equal(publication.nameFull, 'The Tudor Dragon 2024 UK £5 Silver Proof Coin');
    assert.equal(publication.canonicalName, publication.nameFull);
    assert.equal(publication.themeCore, candidate.theme_core);
    assert.equal(publication.metal, 'Sterling Silver');
    assert.equal(publication.mass, 28.28);
    assert.equal(publication.diameter, 38.61);
    assert.equal(publication.mintage, 3210);
    assert.equal(publication.quality, 'Proof');
});

test('promotion merges Royal Mint packaging editions and retains shared specifications', () => {
    const candidate = {
        country: 'United Kingdom', year: 2020, denomination_text: '5 фунтов',
        theme_core: 'david bowie brilliant coin edition', name_full: 'candidate',
    };
    const observations = [1, 2, 3, 4].map((edition) => ({
        source_item_id: String(edition), source_site: 'royalmint.com', evidence_tier: 'primary',
        source_country: 'United Kingdom', source_year: 2020, source_themes: [],
        source_title: `David Bowie 2020 £5 Brilliant Uncirculated Coin - Edition ${edition}`,
        source_metal: 'Cupro-Nickel', source_weight_g: '28.28', source_diameter_mm: '38.61',
        source_mintage: null, source_condition: 'Brilliant Uncirculated',
    }));
    const publication = publicationIdentity(candidate, observations);
    assert.equal(publication.canonicalName, 'David Bowie 2020 £5 Brilliant Uncirculated Coin');
    assert.equal(publication.nameFull, publication.canonicalName);
    assert.equal(publication.metal, 'Cupro-Nickel');
    assert.equal(publication.mass, 28.28);
    assert.equal(publication.diameter, 38.61);
    assert.equal(publication.quality, 'Brilliant Uncirculated');
});

test('reviewed promotion stops when a source item points to another type', () => {
    const promoter = fs.readFileSync(path.join(root, 'catalog', 'promote-catalog-candidate.js'), 'utf8');
    assert.match(promoter, /WHERE o\.candidate_id=\$1 AND l\.type_id<>\$2/);
    assert.doesNotMatch(promoter, /l\.match_method IS DISTINCT FROM s\.adapter_key/);
    assert.match(promoter, /ON CONFLICT \(source_item_id\) DO UPDATE SET\s+type_id=EXCLUDED\.type_id/);
    assert.match(promoter, /кандидат конфликтует с просмотренной связью источника/);
    assert.match(promoter, /publication\.canonicalName/);
    assert.match(promoter, /lower\(trim\(canonical_name\)\)=lower\(trim\(\$5\)\)/);
});

test('candidate identity is independent of source and subject word order', () => {
    const a = candidateKey({
        era: 'foreign', country: 'Niue', denominationText: '2 долларов', year: 2024,
        subjectWords: ['дарт', 'вейдер'],
    });
    const b = candidateKey({
        era: 'foreign', country: 'Niue', denominationText: '2 доллара', year: 2024,
        subjectWords: ['вейдер', 'дарт'],
    });
    assert.equal(a, b);
    assert.doesNotMatch(a, /auction|meshok/);
});

test('an authoritative title separates catalog variants without naming the source', () => {
    const proof = candidateKey({
        era: 'foreign', country: 'United Kingdom', denominationText: '1 соверен', year: 1980,
        subjectWords: ['елизавета', 'соверен'], identityQualifier: '1980 elizabeth ii gold proof sovereign',
    });
    const bullion = candidateKey({
        era: 'foreign', country: 'United Kingdom', denominationText: '1 соверен', year: 1980,
        subjectWords: ['елизавета', 'соверен'], identityQualifier: '1980 elizabeth ii gold sovereign',
    });
    assert.notEqual(proof, bullion);
    assert.doesNotMatch(proof, /royalmint|source/);
});

test('an authoritative title retains a coin after generic words consume its theme', async () => {
    const db = { query: async (sql) => { throw new Error(`unexpected query: ${sql}`); } };
    const parsed = parseTitle('10 рублей 2025 РОССИЯ');
    const { deriveCatalogCandidate } = require('../catalog/catalog-candidates');
    const candidate = await deriveCatalogCandidate(db, parsed, {
        identityQualifier: 'официальная монета россии 2025 года',
    });
    assert.ok(candidate);
    assert.match(candidate.candidateKey, /\|identity:[0-9a-f]{20}$/);
});

test('marketplace ingesters stage gaps and no longer reject unsold cards before parsing', () => {
    const meshok = fs.readFileSync(path.join(root, 'catalog', 'ingest-meshok.js'), 'utf8');
    const auction = fs.readFileSync(path.join(root, 'catalog', 'poll-auctionru.js'), 'utf8');
    const catalogApi = fs.readFileSync(path.join(root, 'catalog', 'api.js'), 'utf8');
    const auctionBackfill = fs.readFileSync(path.join(root, 'catalog', 'ingest-auctionru-active.js'), 'utf8');
    const legacyAuctionIntegration = fs.readFileSync(path.join(root, 'catalog', 'integrate-auctionru.js'), 'utf8');
    const meshokLauncher = fs.readFileSync(path.join(root, 'temporal', 'start-meshok-harvest.js'), 'utf8');

    assert.match(meshok, /stageCatalogCandidate/);
    assert.match(meshok, /staged\.observationAdded \? "new-candidate" : "dup-candidate"/);
    assert.match(meshok, /ended_unsold/);
    assert.match(meshok, /meshok-fixed/);
    assert.match(meshokLauncher, /mode: 'fixed'/);
    assert.match(catalogApi, /source_category !== "meshok-fixed"/);
    assert.doesNotMatch(meshok, /if \(sold && !\(l\.bidsCount > 0\)\) return/);
    assert.match(auction, /await saveObservation/);
    assert.match(auction, /stageCatalogCandidate/);
    assert.match(auctionBackfill, /revers_image_url/);
    assert.match(auctionBackfill, /\/api\/coincat\/photo\/\$\{offerId\}\/\$\{index\}/);
    assert.match(auctionBackfill, /startSourceRun\(pool, 'auction\.ru', 'backfill'\)/);
    assert.doesNotMatch(auction, /createSelf|matchOrCreateType/);
    assert.doesNotMatch(legacyAuctionIntegration, /INSERT INTO coin_type/);
});

test('auction.ru queue retries transient fetch failures and admits exact old years', () => {
    const poller = fs.readFileSync(path.join(root, 'catalog', 'poll-auctionru.js'), 'utf8');
    const enumeration = fs.readFileSync(path.join(root, 'catalog', 'scrape-auctionru-enum.js'), 'utf8');
    const migration = fs.readFileSync(
        path.join(root, 'migrations', 'sql', '202609040003_marketplace_catalog_hardening.sql'),
        'utf8',
    );
    assert.match(poller, /MAX_FETCH_FAILURES = 5/);
    assert.match(poller, /next_check_at/);
    assert.match(poller, /challenge_or_invalid_card/);
    assert.match(poller, /startSourceRun\(pool, 'auction\.ru'/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS fetch_failures/);
    assert.match(enumeration, /getUTCFullYear\(\) \+ 1/);
    assert.match(enumeration, /MIN_CATALOG_YEAR = 1000/);
    assert.match(enumeration, /1\\d\{3\}/);
    assert.doesNotMatch(enumeration, /202\[0-6\]/);
});

test('source-run CTEs are valid chains and duplicate candidate observations are not counted as new', () => {
    const registry = fs.readFileSync(path.join(root, 'catalog', 'source-registry.js'), 'utf8');
    const startSourceRun = registry.slice(
        registry.indexOf('async function startSourceRun'),
        registry.indexOf('async function finishSourceRun'),
    );
    const candidates = fs.readFileSync(path.join(root, 'catalog', 'catalog-candidates.js'), 'utf8');
    const meshokActivities = fs.readFileSync(path.join(root, 'temporal', 'meshok-activities.js'), 'utf8');
    assert.match(registry, /ON CONFLICT \(source_key,run_kind\) WHERE status='running' DO NOTHING/);
    assert.match(registry, /\),\s*touched AS/g);
    assert.match(registry, /existing\.id=\$1 AND existing\.status=\$2/);
    assert.match(startSourceRun, /FROM inserted WHERE s\.source_key=inserted\.source_key/);
    assert.doesNotMatch(startSourceRun, /SELECT existing\.\* FROM catalog_source_run/);
    assert.match(startSourceRun, /запуск \$\{runKind\} уже выполняется/);
    assert.match(candidates, /\(xmax = 0\) AS observation_added/);
    assert.match(candidates, /ON CONFLICT \(lot_id\) WHERE lot_id IS NOT NULL/);
    assert.match(meshokActivities, /const candidates = totals\['new-candidate'\] \|\| 0/);
});

test('catalog candidate migration preserves provenance outside public coin_type', () => {
    const sql = fs.readFileSync(
        path.join(root, 'migrations', 'sql', '202609040001_catalog_candidates.sql'),
        'utf8',
    );
    assert.match(sql, /CREATE TABLE catalog_candidate \(/);
    assert.match(sql, /CREATE TABLE catalog_candidate_observation \(/);
    assert.match(sql, /lot_id INTEGER NOT NULL REFERENCES auction_lots/);
    assert.match(sql, /status IN \('pending', 'rejected', 'promoted'\)/);
    assert.doesNotMatch(sql, /INSERT INTO coin_type|UPDATE coin_type|DELETE FROM|TRUNCATE/i);
});

test('catalog source registry covers suggested Russian and primary foreign sources', () => {
    const sql = fs.readFileSync(
        path.join(root, 'migrations', 'sql', '202609040002_catalog_sources.sql'),
        'utf8',
    );
    for (const key of [
        'numizm.at', 'coinsbolhov.ru', 'imperial-mag.ru', 'xn--b1aga1affsn5f.xn--p1ai',
        'en.numista.com', 'usmint.gov', 'mint.ca', 'royalmint.com', 'emk.com', 'powercoin.it',
    ]) assert.match(sql, new RegExp(key.replaceAll('.', '\\.')));
    assert.match(sql, /price_role TEXT NOT NULL DEFAULT 'none'/);
    assert.match(sql, /CREATE TABLE catalog_source_run/);
    assert.match(sql, /status = 'retired'/);
    assert.equal(sourceKey('EMK.COM'), 'emk.com');
    assert.throws(() => sourceKey('всемонеты.рф'), /ASCII/);
});
