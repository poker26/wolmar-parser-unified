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

async function stageCatalogCandidate(pool, { parsed, matchReason, lot }) {
    if (!/нет типа/.test(String(matchReason || ''))) return { staged: false, reason: 'not_catalog_gap' };
    const candidate = await deriveCatalogCandidate(pool, parsed);
    if (!candidate) return { staged: false, reason: 'insufficient_identity' };
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
         ON CONFLICT (lot_id) DO UPDATE SET
           candidate_id=EXCLUDED.candidate_id,
           source_site=EXCLUDED.source_site,
           source_lot_number=EXCLUDED.source_lot_number,
           source_url=EXCLUDED.source_url,
           lot_status=EXCLUDED.lot_status,
           observed_title=EXCLUDED.observed_title,
           observed_at=now()
         RETURNING candidate_id`,
        [
            candidate.candidateKey, candidate.era, candidate.country, candidate.denominationText,
            candidate.denominationValue, candidate.year, candidate.themeCore, candidate.nameFull,
            lot.id, lot.sourceSite, lot.sourceLotNumber || null, lot.sourceUrl || null,
            lot.lotStatus || null, lot.title,
        ],
    );
    return { staged: true, candidate, observationAdded: result.rows.length > 0 };
}

module.exports = { candidateKey, deriveCatalogCandidate, stageCatalogCandidate };
