# Collection valuation pipeline

Each calculation creates an immutable `collection_valuation` snapshot. The MVP
uses at most the 250 most recent completed RUB hammer-price sales from
`wolmar.ru` and `numismat.ru` linked to the same `coin_type` and the exact
normalized grade. Active offers and marketplace sales are excluded.

The snapshot stores the established forecast result without imposing a second,
collection-specific minimum sample size. `basis` contains the rules and every
source lot id used by that snapshot.

Read endpoints:

- `GET /api/v1/collection/items/:id/valuation`
- `GET /api/v1/collection/items/:id/valuations`
- `GET /api/v1/collection/items/:id/valuation/comparables`

Recalculation requires session authentication and CSRF:

- `POST /api/v1/collection/items/:id/valuation/recalculate`

Production rollout order:

1. confirm a current off-server database backup;
2. apply `202608260003_collection_valuations.sql`;
3. switch the HTTP server to the release containing the valuation routes;
4. create linked test items with a supported grade and with an uncommon grade;
5. verify a ready range, an abstention, history, ownership and summary totals.

Rollback switches the HTTP release back. The additive table is retained so
calculated history is not lost.
