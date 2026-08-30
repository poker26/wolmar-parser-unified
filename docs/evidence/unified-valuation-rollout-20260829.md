# Unified valuation rollout — 2026-08-29

## Production contract

`ValuationService` is the only product-level entry point for catalog-linked
coin valuation. Current-auction lots, watchlist rows, catalog type cards and
mobile collection items use the same established `ImprovedPredictionsGenerator`
formula.

The shared identity is:

- `type_id`;
- normalized grade;
- slab status;
- grading company when a slab is present;
- valuation date and currency.

For an unslabbed catalog or collection coin without a user grade, the agreed
heuristic is `XF`. A slab without a readable label grade does not receive that
heuristic. A catalog link explicitly audited as `conflict` is not used as type
identity. Unlinked and conflicting auction lots retain the established legacy
text path; they are outside the cross-surface type contract.

The canonical type lookup deliberately does not inherit title, year, mint,
metal or rarity filters from an arbitrary representative lot. Those filters
remain unchanged for direct legacy generator callers. This prevents two lots
with the same valuation identity from producing different comparable pools.

## Release

- Implementation commits: `f211ac8`, `2742292`, `29c333b`.
- Active release: `/var/www/wolmar-releases/29c333b-valuation-contract`.
- Restarted: `wolmar-server`, `temporal-forecast-worker`,
  `temporal-collection-valuation-worker`.
- Not restarted: `temporal-parser-worker`; the Standart year backfill remained
  online and its output log continued to advance after the release switch.

## Verification

- Targeted unit suites: 20/20 passed.
- Production readiness after switch: database `up`.
- Five production canaries from auction `1016`: stored lot prediction, live lot
  valuation and live type valuation matched 5/5.
- The reproducing type `537138` now uses one canonical pool of 59 comparables
  and returns `863 RUB` on both lot and type surfaces. Before the repair the lot
  used 58 comparables while the type adapter inherited an arbitrary title and
  used one comparable, returning `878 RUB` versus `585 RUB`.
- A scoped Temporal refresh updated all 3,106 non-conflicting `type_id` lots in
  auction `1016`; a read-only coverage query found zero stale linked rows.
- The remaining non-catalog exact-title tail was cancelled after type coverage
  reached 100 percent. Already written predictions were retained.

The production collection contained no `collection_valuation` snapshots at
verification time. The next real phone-created item with a matched `type_id`
is therefore the remaining end-to-end acceptance check; item creation already
enqueues the valuation workflow automatically, and the installed Android client
already renders the returned estimate and history.
