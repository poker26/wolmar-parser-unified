'use strict';

const { countryList, themeWords, NON_THEME, unitSkeleton, enUnit } = require('./coin-matcher');

const RU_CACHE = new Map();

async function russianCountryWords(pool, country) {
    if (!RU_CACHE.has(country)) {
        const base = String(country).split(/[,(-]/)[0].trim();
        const mapped = (await pool.query(
            'SELECT ru FROM numis_country_map WHERE en = ANY($1)',
            [[country, base]],
        )).rows.map((row) => row.ru);
        const aliases = (await pool.query(
            'SELECT ru FROM numis_country_ru WHERE country = ANY($1)',
            [[country, base]],
        )).rows.flatMap((row) => (Array.isArray(row.ru) ? row.ru : []));
        RU_CACHE.set(country, new Set([...mapped, ...aliases].flatMap((value) => themeWords(value))));
    }
    return RU_CACHE.get(country);
}

function candidateKey({ era, country, denominationText, year, subjectWords }) {
    const subjectKey = subjectWords.map((word) => word.slice(0, 5)).sort().join('+');
    const match = String(denominationText).toLowerCase().trim().match(/^(\S+)\s+(.+)$/);
    const denominationKey = match
        ? `${match[1]} ${enUnit(match[2]) || unitSkeleton(match[2]).slice(0, 5) || match[2].slice(0, 5)}`
        : String(denominationText).toLowerCase().trim();
    return `market|${era || (country === 'RU' ? 'modern' : 'foreign')}|${String(country).toUpperCase()}|${denominationKey}|${year}|${subjectKey}`;
}

async function deriveCatalogCandidate(pool, parsed) {
    if (!parsed || parsed.isNonCoin || parsed.isSet || !parsed.denom || !parsed.year) return null;
    const era = parsed.denom.isRf ? 'modern' : 'foreign';
    if (era === 'modern' && parsed.year < 1992) return null;
    const countries = era === 'modern'
        ? ['RU']
        : await countryList(pool, parsed.title, parsed.year, parsed.denom.unit);
    if (!countries.length) return null;
    const country = countries[0];
    const denominationText = `${parsed.denom.raw || parsed.denom.num} ${parsed.denom.unit}`;
    const skip = new Set([
        ...themeWords(country),
        ...(country === 'RU' ? ['росси', 'рф'] : await russianCountryWords(pool, country)),
        ...themeWords(denominationText),
    ]);
    const subjectWords = (parsed.headWords || [])
        .filter((word) => !NON_THEME.test(word) && !skip.has(word) && word.length >= 4);
    if (!subjectWords.length) return null;
    const themeCore = subjectWords.join(' ').slice(0, 200);
    return {
        candidateKey: candidateKey({ era, country, denominationText, year: parsed.year, subjectWords }),
        era,
        country,
        denominationText,
        denominationValue: parsed.denom.value == null ? null : parsed.denom.value,
        year: parsed.year,
        themeCore,
        nameFull: `${denominationText}. ${country === 'RU' ? 'РОССИЯ' : country.toUpperCase()} ${parsed.year} — ${themeCore}`.slice(0, 250),
    };
}

async function stageCatalogCandidate(pool, { parsed, matchReason, lot = null, sourceItem = null }) {
    if (!/нет типа/.test(String(matchReason || ''))) return { staged: false, reason: 'not_catalog_gap' };
    if (Boolean(lot) === Boolean(sourceItem)) {
        throw new Error('для кандидата нужен ровно один источник наблюдения: lot или sourceItem');
    }
    const candidate = await deriveCatalogCandidate(pool, parsed);
    if (!candidate) return { staged: false, reason: 'insufficient_identity' };
    if (sourceItem) {
        const result = await pool.query(
            `WITH candidate AS (
               INSERT INTO catalog_candidate
                 (candidate_key,era,country,denomination_text,denomination_value,year,theme_core,name_full,last_seen_at,updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())
               ON CONFLICT (candidate_key) DO UPDATE SET
                 last_seen_at=now(), updated_at=now(), name_full=EXCLUDED.name_full,
                 denomination_value=COALESCE(catalog_candidate.denomination_value,EXCLUDED.denomination_value)
               RETURNING id
             )
             INSERT INTO catalog_candidate_observation
               (candidate_id,source_item_id,source_site,source_lot_number,source_url,lot_status,observed_title)
             SELECT id,$9,$10,$11,$12,$13,$14 FROM candidate
             ON CONFLICT (source_item_id) WHERE source_item_id IS NOT NULL DO UPDATE SET
               candidate_id=EXCLUDED.candidate_id,
               source_site=EXCLUDED.source_site,
               source_lot_number=EXCLUDED.source_lot_number,
               source_url=EXCLUDED.source_url,
               lot_status=EXCLUDED.lot_status,
               observed_title=EXCLUDED.observed_title,
               observed_at=now()
             RETURNING candidate_id,(xmax = 0) AS observation_added`,
            [
                candidate.candidateKey, candidate.era, candidate.country, candidate.denominationText,
                candidate.denominationValue, candidate.year, candidate.themeCore, candidate.nameFull,
                sourceItem.id, sourceItem.sourceSite, sourceItem.sourceItemKey || null,
                sourceItem.sourceUrl || null, sourceItem.itemStatus || null, sourceItem.title,
            ],
        );
        return { staged: true, candidate, observationAdded: Boolean(result.rows[0]?.observation_added) };
    }
    const result = await pool.query(
        `WITH candidate AS (
           INSERT INTO catalog_candidate
             (candidate_key,era,country,denomination_text,denomination_value,year,theme_core,name_full,last_seen_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())
           ON CONFLICT (candidate_key) DO UPDATE SET
             last_seen_at=now(), updated_at=now(), name_full=EXCLUDED.name_full,
             denomination_value=COALESCE(catalog_candidate.denomination_value,EXCLUDED.denomination_value)
           RETURNING id
         )
         INSERT INTO catalog_candidate_observation
           (candidate_id,lot_id,source_site,source_lot_number,source_url,lot_status,observed_title)
         SELECT id,$9,$10,$11,$12,$13,$14 FROM candidate
         ON CONFLICT (lot_id) WHERE lot_id IS NOT NULL DO UPDATE SET
           candidate_id=EXCLUDED.candidate_id,
           source_site=EXCLUDED.source_site,
           source_lot_number=EXCLUDED.source_lot_number,
           source_url=EXCLUDED.source_url,
           lot_status=EXCLUDED.lot_status,
           observed_title=EXCLUDED.observed_title,
           observed_at=now()
         RETURNING candidate_id,(xmax = 0) AS observation_added`,
        [
            candidate.candidateKey, candidate.era, candidate.country, candidate.denominationText,
            candidate.denominationValue, candidate.year, candidate.themeCore, candidate.nameFull,
            lot.id, lot.sourceSite, lot.sourceLotNumber || null, lot.sourceUrl || null,
            lot.lotStatus || null, lot.title,
        ],
    );
    return { staged: true, candidate, observationAdded: Boolean(result.rows[0]?.observation_added) };
}

function evaluateCandidateEvidence(observations) {
    const authoritativeSources = new Set(observations
        .filter((row) => row.evidence_tier === 'primary' || row.evidence_tier === 'reference')
        .map((row) => row.source_site)).size;
    const hasPhoto = observations.some((row) => row.avers_image_url && row.revers_image_url);
    const reasons = [];
    if (!hasPhoto) reasons.push('нет пары исходных фотографий аверса и реверса');
    if (!authoritativeSources) reasons.push('нет подтверждения primary/reference');
    return { ready: reasons.length === 0, hasPhoto, authoritativeSources, reasons };
}

function countryIdentity(value) {
    const normalized = String(value || '').toLowerCase()
        .replace(/\b(of|the|and)\b/g, ' ')
        .replace(/[^a-z0-9]/g, '');
    return ({
        vaticancity: 'vatican',
        unitedstatesamerica: 'unitedstates',
        greatbritain: 'unitedkingdom',
        koreasouth: 'southkorea',
        koreanorth: 'northkorea',
    })[normalized] || normalized;
}

function publicationIdentity(candidate, observations) {
    const authoritativeRows = observations.filter((row) => row.source_item_id
            && ['primary', 'reference'].includes(row.evidence_tier)
            && row.source_year === candidate.year
            && countryIdentity(row.source_country) === countryIdentity(candidate.country));
    const authoritativeThemes = [...new Set(authoritativeRows
        .filter((row) => Array.isArray(row.source_themes) && row.source_themes[0])
        .map((row) => String(row.source_themes[0]).trim())
        .filter(Boolean))];
    const royalMintTitles = [...new Set(authoritativeRows
        .filter((row) => row.source_site === 'royalmint.com' && row.source_title)
        .map((row) => String(row.source_title).trim())
        .filter(Boolean))];
    const themeCore = authoritativeThemes.length === 1
        ? authoritativeThemes[0]
        : candidate.theme_core;
    const royalMintTitle = !authoritativeThemes.length && royalMintTitles.length === 1
        ? royalMintTitles[0]
        : null;
    const source = authoritativeRows.length === 1 ? authoritativeRows[0] : null;
    return {
        themeCore,
        nameFull: royalMintTitle || (authoritativeThemes.length === 1
            ? `${candidate.denomination_text}. ${candidate.country.toUpperCase()} ${candidate.year} — ${themeCore}`
            : candidate.name_full),
        canonicalName: royalMintTitle || (source?.source_title ? String(source.source_title).trim() : null),
        metal: source?.source_metal || null,
        mass: source?.source_weight_g == null ? null : Number(source.source_weight_g),
        diameter: source?.source_diameter_mm == null ? null : Number(source.source_diameter_mm),
        mintage: source?.source_mintage == null ? null : Number(source.source_mintage),
        quality: source?.source_condition || null,
    };
}

module.exports = {
    candidateKey, deriveCatalogCandidate, evaluateCandidateEvidence, publicationIdentity, stageCatalogCandidate,
};
