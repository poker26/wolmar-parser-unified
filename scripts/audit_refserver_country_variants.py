"""Report catalog country spellings that differ only by conservative syntax."""

import asyncio
import json
from collections import defaultdict

from sqlalchemy import text

from db import async_session
from refserver_foreign_issuers import issuer_spelling_key


async def main():
    async with async_session() as session:
        rows = (await session.execute(text("""
            SELECT country, count(*)::int AS types
            FROM coin_type
            WHERE era = 'foreign' AND country IS NOT NULL
            GROUP BY country
            ORDER BY country
        """))).mappings().all()

    groups = defaultdict(list)
    for row in rows:
        groups[issuer_spelling_key(row["country"])].append(dict(row))
    variants = [
        {"spelling_key": key, "variants": values, "types": sum(row["types"] for row in values)}
        for key, values in groups.items()
        if len(values) > 1
    ]
    variants.sort(key=lambda row: (-row["types"], row["spelling_key"]))
    print(json.dumps({
        "distinct_country_values": len(rows),
        "variant_groups": len(variants),
        "groups": variants,
    }, ensure_ascii=False, indent=2))


asyncio.run(main())
