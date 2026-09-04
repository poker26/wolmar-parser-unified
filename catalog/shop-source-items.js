/**
 * Source-agnostic persistence helpers for dealer/reference catalog cards.
 * These records intentionally contain catalog identity evidence, not prices.
 */
'use strict';

async function selectSourceItems(db, sourceKey, items, { limit, refresh }) {
    if (refresh) return limit ? items.slice(0, limit) : items;
    const selected = [];
    for (let offset = 0; offset < items.length && (!limit || selected.length < limit); offset += 500) {
        const chunk = items.slice(offset, offset + 500);
        const existing = new Set((await db.query(
            `SELECT source_item_key FROM catalog_source_item
              WHERE source_key=$1 AND source_item_key=ANY($2)
                AND attributes ? '_ingest_outcome'`,
            [sourceKey, chunk.map((item) => item.sourceItemKey)],
        )).rows.map((row) => row.source_item_key));
        for (const item of chunk) {
            if (!existing.has(item.sourceItemKey)) selected.push(item);
            if (limit && selected.length >= limit) break;
        }
    }
    return selected;
}

function sampleItems(items, limit) {
    if (!limit || items.length <= limit) return items;
    if (limit === 1) return [items[0]];
    return Array.from({ length: limit }, (_, index) => items[Math.round(index * (items.length - 1) / (limit - 1))]);
}

async function upsertSourceItem(db, product) {
    return (await db.query(
        `INSERT INTO catalog_source_item
           (source_key,source_item_key,source_url,item_status,title,country,denomination,year,
            metal,weight_g,diameter_mm,mintage,condition,themes,avers_image_url,revers_image_url,attributes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (source_key,source_item_key) DO UPDATE SET
           source_url=EXCLUDED.source_url,item_status=EXCLUDED.item_status,title=EXCLUDED.title,
           country=EXCLUDED.country,denomination=EXCLUDED.denomination,year=EXCLUDED.year,
           metal=EXCLUDED.metal,weight_g=EXCLUDED.weight_g,diameter_mm=EXCLUDED.diameter_mm,
           mintage=EXCLUDED.mintage,condition=EXCLUDED.condition,themes=EXCLUDED.themes,
           avers_image_url=COALESCE(EXCLUDED.avers_image_url,catalog_source_item.avers_image_url),
           revers_image_url=COALESCE(EXCLUDED.revers_image_url,catalog_source_item.revers_image_url),
           attributes=EXCLUDED.attributes,last_seen_at=now(),updated_at=now()
         RETURNING id,(xmax=0) AS inserted`,
        [
            product.sourceKey, product.sourceItemKey, product.sourceUrl, product.itemStatus,
            product.title, product.country, product.denomination, product.year, product.metal,
            product.weightG, product.diameterMm, product.mintage, product.condition, product.themes,
            product.aversImageUrl, product.reversImageUrl, product.attributes,
        ],
    )).rows[0];
}

async function completeSourceItem(db, sourceItemId, outcome) {
    await db.query(
        `UPDATE catalog_source_item
            SET attributes=attributes || jsonb_build_object('_ingest_outcome',$2::text),
                updated_at=now()
          WHERE id=$1`,
        [sourceItemId, outcome],
    );
    return outcome;
}

module.exports = { completeSourceItem, sampleItems, selectSourceItems, upsertSourceItem };
