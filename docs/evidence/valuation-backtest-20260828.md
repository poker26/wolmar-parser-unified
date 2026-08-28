# Slab-aware valuation backtest — 2026-08-28

## Decision

Do not switch user-facing auction or collection prices to `slab-aware-v1-shadow-r2` yet.

The estimator is viable, and slab-aware slices are useful, but the paired auction result does not yet beat the active legacy estimator. The collection-photo scenario also exposed contradictory historical `lot_type_link` rows that can contaminate comparables. Production remained on `/var/www/wolmar-releases/9e2f148-slab` throughout this backtest.

## Contract under test

The implementation follows `docs/RFC-SLAB-AWARE-VALUATION-AND-IDENTIFICATION.md`:

- slab properties belong to a physical specimen or auction lot, not `coin_type`;
- known grade is never dropped while widening the comparable set;
- missing slab evidence remains `unknown`, never implicit `raw`;
- company adjustments are not hard-coded;
- a raw coin photographed for collection does not receive an invented numerical grade;
- an unknown grade produces a broad 10th–90th percentile range;
- insufficient comparable history returns an abstention;
- all calculations in this phase are isolated from user-facing price reads.

## Method

- Target population: completed RUB coin sales with an existing `lot_type_link`.
- Time window: 2026-01-01 through 2026-08-28.
- Sample: deterministic `md5(lot_id || 'slab-aware-v1')`, 500 targets per scenario.
- Time split: only sales at or before the target valuation date.
- Leakage control: excludes the target lot and its entire auction.
- Minimum sample: three comparable sales.
- Point estimate: six-month recency-weighted median.
- Range: 25th–75th percentile for a non-expanded known-grade market; 10th–90th percentile when the market is expanded or grade is unknown.
- Precious metals: existing production historical melt-price delta and purity fallbacks.

## Stored runs

| Scenario | Run ID | Rows | Ready | Abstained |
|---|---|---:|---:|---:|
| Auction lot with auction grade | `c3ef87e2-f699-4db4-958a-6fb0b292ae42` | 500 | 412 | 88 |
| Collection photo, no invented raw-coin grade | `182b57c7-dc69-4b87-baf9-cf3671f7b80f` | 500 | 479 | 21 |

Both runs are stored only in `valuation_shadow_result` with `evaluation_kind = 'backtest'`. Each result contains the valuation input, actual completed-sale price, method version, comparable identifiers and target audit context.

## Results

### Auction scenario

| Metric | Result |
|---|---:|
| Ready coverage | 82.4% |
| MdAPE | 15.9% |
| p90 APE | 62.4% |
| Mean signed error | +7.2% |
| Interval coverage | 64.3% |
| Same company and grade MdAPE | 10.8% |
| Paired targets with both estimates | 69 |
| New MdAPE on paired targets | 18.1% |
| Legacy MdAPE on paired targets | 17.5% |
| New win / tie rates | 37.7% / 29.0% |

The new estimator is close to legacy on the paired subset, but it has not demonstrated an improvement sufficient for a production switch.

### Collection-photo scenario

This scenario preserves readable slab-label data. For every other target it sets `slabStatus = raw`, clears company and grade, and does not infer a grade from the photograph.

| Metric | Result |
|---|---:|
| Ready coverage | 95.8% |
| MdAPE | 28.5% |
| p90 APE | 119.6% |
| Mean signed error | +37.7% |
| Interval coverage | 76.0% |
| Same company, unknown grade MdAPE | 14.7% |
| Same company, unknown grade interval coverage | 71.8% |

The broad range behaves substantially better after applying the RFC rule to unknown grades: total interval coverage rose from 68.3% to 76.0%, and same-company unknown-grade coverage rose from 38.2% to 71.8%. The point estimate still has a long positive tail when condition or exact variety is unknown; this is expected to remain low-confidence and must be presented as a range.

## Identity-data findings

An independent hard-consistency audit checks only objective contradictions in year/range, denomination and mint. It found 24 conflicts in the 500-target sample (4.8%). It intentionally does not claim that the remaining rows are semantically correct.

The final read-only confirmation run (`21a79af4-38c7-4dea-9844-bc0c37a6ed97`) reproduced the collection metrics and the same 24 conflicts after false-positive hardening. It was not persisted because it changed no valuation logic or stored evidence.

Confirmed examples:

- lot `4463855`: `3 копейки 1852 ЕМ` linked to catalog type `3 копейки 1852 ВМ`; the old matcher did not extract Cyrillic mint codes because it used JavaScript `\b` boundaries;
- a `5 франков` lot was linked to a `5 CENTIMES` catalog type;
- a `Щелкунчик. Поединок` lot was linked to `Зимний дворец`;
- an `Олимпиада в Барселоне. Борьба` lot was linked to `Штанга`.

The Cyrillic mint-boundary bug is fixed in the inactive release and covered by regression tests. No existing production link has been rewritten.

## Required before switching prices

1. Persist the hard-consistency audit for all historical links and quarantine conflicts from comparable selection.
2. Repair matcher ambiguity for themes and USSR varieties; a second run of the same flawed matcher is not independent validation.
3. Dry-run proposed relinks, manually review high-impact changes, then apply in batches without deleting source descriptions.
4. Repeat both 500-target scenarios on the cleaned comparable set and at least one different deterministic seed/time window.
5. Require the new estimator to be non-inferior on paired MdAPE, remove catastrophic identity-driven outliers, and retain broad-range coverage for unknown grade before switching any consumer.

## Verification

- A dependency-complete verification run passed 125/125 tests after the matcher, range and audit fixes. The final reporting-only option passed syntax checks and the focused slab-aware suite (17/17). A later local full rerun could load only 103 tests because this checkout's `node_modules` lacks `express` and `minio`; the three load failures are unrelated to the changed modules.
- Production migrations: up to date.
- Active production readiness: `status=ok`, database `up` after both writes.
- Active production release was not changed.
