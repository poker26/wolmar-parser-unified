# Collection valuation pipeline

Each calculation creates an immutable `collection_valuation` snapshot. The MVP
uses at most the 250 most recent completed RUB hammer-price sales from
`wolmar.ru` and `numismat.ru` linked to the same `coin_type` and the exact
normalized grade. Active offers and marketplace sales are excluded.

With fewer than three comparable sales the snapshot has
`status=insufficient_data` and no monetary values. Otherwise it stores P25,
median and P75 in minor units. `basis` contains the rules and every source lot id
used by that snapshot.

Read endpoints:

- `GET /api/v1/collection/items/:id/valuation`
- `GET /api/v1/collection/items/:id/valuations`
- `GET /api/v1/collection/items/:id/valuation/comparables`

Recalculation requires session authentication and CSRF:

- `POST /api/v1/collection/items/:id/valuation/recalculate`

Production rollout order:

1. confirm a current off-server database backup;
2. apply `202608260003_collection_valuations.sql`;
3. start `temporal/collection-valuation-worker.js`;
4. switch the HTTP server to the release containing the valuation routes;
5. create linked test items with a supported grade and with an uncommon grade;
6. verify a ready range, an abstention, history, ownership and summary totals.

Rollback stops the valuation worker and switches the HTTP release back. The
additive table is retained so calculated history is not lost.
