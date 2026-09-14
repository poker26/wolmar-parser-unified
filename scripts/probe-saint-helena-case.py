"""Export read-only evidence for the recorded Saint Helena identification."""

import asyncio
import hashlib
import json
import os
from pathlib import Path

from sqlalchemy import text

import refserver
from db import async_session


REQUEST_ID = "1f86f6d2-7cd9-4d9d-b7b1-97847a59fa10"
TYPE_ID = 780801
CATALOG_KEYS = (
    "marketplace/8fa9ba84e5dc5f1076c018a355593037f8ab9e0fcd813b6009ed9c8348a7a15b.jpg",
    "marketplace/650ab228034f513109e624f76217361c0eb0bbee50702d253fbf040157f6557c.jpg",
)
OUTPUT = Path("/tmp/saint-helena-case-20260914")


def digest(path: Path) -> str:
    return hashlib.file_digest(path.open("rb"), "sha256").hexdigest()


async def main():
    async with async_session() as session:
        run = (await session.execute(text("""
            SELECT request_id::text, image_sha256, extracted, catalog_match,
                   matcher_candidates, response_candidates
            FROM coin_identification_run
            WHERE request_id = CAST(:request_id AS uuid)
        """), {"request_id": REQUEST_ID})).mappings().one()
        coin_type = (await session.execute(text("""
            SELECT id, name_full, country, year, era, source,
                   denomination_text, denomination_value, metal, mass
            FROM coin_type WHERE id = :type_id
        """), {"type_id": TYPE_ID})).mappings().one()
        candidates = (await session.execute(text("""
            SELECT id, name_full, country, year, year_start, year_end,
                   denomination_text, metal, theme_ru, krause_subject,
                   krause_design, image_url, image_url_rev
            FROM coin_type
            WHERE era = 'foreign'
              AND lower(country) IN ('saint helena', 'st. helena')
              AND (
                  year = 2024
                  OR 2024 BETWEEN year_start AND COALESCE(year_end, year_start)
              )
            ORDER BY id
        """))).mappings().all()
        photos = (await session.execute(text("""
            SELECT cip.id::text, cip.item_id::text, cip.side,
                   cip.object_key_original, cip.sha256
            FROM collection_item_photo cip
            WHERE cip.sha256 = ANY(CAST(:hashes AS text[]))
              AND cip.deleted_at IS NULL
            ORDER BY cip.sort_order, cip.created_at
        """), {"hashes": list(run["image_sha256"])})).mappings().all()

    OUTPUT.mkdir(mode=0o700, exist_ok=True)
    client = refserver._mc()
    catalog = []
    for index, key in enumerate(CATALOG_KEYS, start=1):
        path = OUTPUT / f"catalog-{index}.jpg"
        client.fget_object("coin-ref-photos", key, str(path))
        catalog.append({"key": key, "path": str(path), "sha256": digest(path)})

    user = []
    collection_bucket = os.getenv("COLLECTION_PHOTO_BUCKET", "user-coin-photos")
    for index, photo in enumerate(photos, start=1):
        path = OUTPUT / f"user-{index}-{photo['side']}.jpg"
        client.fget_object(collection_bucket, photo["object_key_original"], str(path))
        actual = digest(path)
        user.append({
            "id": photo["id"],
            "item_id": photo["item_id"],
            "side": photo["side"],
            "path": str(path),
            "expected_sha256": photo["sha256"],
            "actual_sha256": actual,
            "hash_matches": actual == photo["sha256"],
        })

    report = {
        "request_id": REQUEST_ID,
        "image_sha256": list(run["image_sha256"]),
        "extracted": run["extracted"],
        "catalog_match": run["catalog_match"],
        "matcher_candidates": run["matcher_candidates"],
        "response_candidates": run["response_candidates"],
        "type": dict(coin_type),
        "same_issuer_year_candidates": [dict(row) for row in candidates],
        "catalog_photos": catalog,
        "matched_collection_photos": user,
    }
    (OUTPUT / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    print(json.dumps({
        "request_id": REQUEST_ID,
        "catalog_photos": len(catalog),
        "same_issuer_year_candidates": len(candidates),
        "matched_collection_photos": len(user),
        "output": str(OUTPUT),
    }))


asyncio.run(main())
