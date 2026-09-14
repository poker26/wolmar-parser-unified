"""Replay the recorded Saint Helena observations through the patched matcher."""

import asyncio
import json
import sys

from sqlalchemy import text

import refserver
from db import async_session
from refserver_foreign_issuers import (
    canonicalize_foreign_issuer,
    catalog_country_variants,
    issuer_from_legends,
)


REQUEST_ID = "1f86f6d2-7cd9-4d9d-b7b1-97847a59fa10"


async def main():
    use_deployed_functions = "--deployed" in sys.argv
    original_country_from_legends = refserver._country_from_legends

    def canon_country(value):
        if not value:
            return None
        stripped = str(value).strip()
        return canonicalize_foreign_issuer(
            refserver._C_ALIAS.get(refserver._fold_text(stripped), stripped)
        )

    def country_from_legends(extracted):
        return (
            issuer_from_legends(extracted.get("legends") or [])
            or original_country_from_legends(extracted)
        )

    def strict_foreign_match(extracted, row, country):
        row_country = canon_country(row.get("country"))
        if country and (not row_country or canon_country(country).casefold() != row_country.casefold()):
            return False
        return refserver._strict_year_match(extracted, row) and refserver._strict_denom_match(extracted, row)

    if use_deployed_functions:
        canon_country = refserver._canon_country
        query_country_variants = refserver.catalog_country_variants
    else:
        refserver._canon_country = canon_country
        refserver._country_from_legends = country_from_legends
        refserver._strict_foreign_match = strict_foreign_match
        query_country_variants = catalog_country_variants

    async with async_session() as session:
        extracted = (await session.execute(text("""
            SELECT extracted FROM coin_identification_run
            WHERE request_id = CAST(:request_id AS uuid)
        """), {"request_id": REQUEST_ID})).scalar_one()

    extracted = refserver._normalize_verifier_extracted(extracted)
    country = canon_country(extracted.get("country"))
    year = extracted.get("year") if isinstance(extracted.get("year"), int) else None
    rows_by_id = {}
    async with async_session() as session:
        for query_country in query_country_variants(country):
            result = await session.execute(refserver._SQL, {
                "country": query_country,
                "year": year or 0,
            })
            for record in result:
                row = dict(record._mapping)
                rows_by_id[row["id"]] = row
    rows = list(rows_by_id.values())
    scored = refserver._rank_foreign_candidates(extracted, country, rows)
    selected = refserver._select_candidates_for_response(scored)

    assert country == "Saint Helena", country
    assert 780801 in rows_by_id, "The spelling variants did not retrieve type 780801"
    assert [candidate["id"] for candidate in scored] == [780801], scored
    assert [candidate["id"] for candidate in selected] == [780801], selected
    print(json.dumps({
        "request_id": REQUEST_ID,
        "country": country,
        "query_countries": list(query_country_variants(country)),
        "retrieved_type_ids": sorted(rows_by_id),
        "response_candidate_ids": [candidate["id"] for candidate in selected],
        "catalog_match": "ambiguous",
        "deployed_functions": use_deployed_functions,
    }, ensure_ascii=False, indent=2))


asyncio.run(main())
