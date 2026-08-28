# Slab storage schema audit — 2026-08-28

Read-only production inspection was run against the current deployment before choosing the storage layout.

| Relation | Estimated rows | Total size |
|---|---:|---:|
| `auction_lots` | 737,358 | 1,009,754,112 bytes |
| `collection_item` | planner had no estimate | 98,304 bytes |
| `collection_valuation` | planner had no estimate | 81,920 bytes |

Observed facts:

- none of the three tables already had structured slab columns;
- `auction_lots` already owns per-lot description and condition data;
- `collection_item` already owns the physical specimen grade;
- `collection_valuation` is an immutable per-item snapshot with `basis` and algorithm-version fields.

Decision:

- add columns to the existing owning tables instead of adding three one-to-one tables;
- use constant `unknown` defaults so old rows are never inferred to be `raw`;
- do not add a large-table index in the storage migration;
- retain the migration runner's five-second lock timeout so deployment fails safely if the required metadata lock is not available;
- defer any index for comparable selection until the shadow valuation query and `EXPLAIN` results define its actual shape.

Reproduction command: run `node scripts/audit-slab-storage.js` from the repository root in the production environment.
