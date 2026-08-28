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

1. Use the persisted hard-consistency audit to review and repair historical links; automatic comparable quarantine remains disabled because it did not improve the backtest.
2. Repair matcher ambiguity for themes and USSR varieties; a second run of the same flawed matcher is not independent validation.
3. Dry-run proposed relinks, manually review high-impact changes, then apply in batches without deleting source descriptions.
4. Repeat both 500-target scenarios on the cleaned comparable set and at least one different deterministic seed/time window.
5. Require the new estimator to be non-inferior on paired MdAPE, remove catastrophic identity-driven outliers, and retain broad-range coverage for unknown grade before switching any consumer.

## Conflict-quarantine pilot

Migration `202608280004_lot_type_link_quality.sql` adds an isolated audit table. It snapshots both `lot_id` and `type_id`; therefore a later relink cannot inherit an obsolete quarantine decision. The comparable repository excludes only rows audited as `conflict` by `hard-consistency-v1`. Missing, stale and `unverified` audit rows remain eligible.

A write-confirmed pilot audited 500 links after lot `4400000` without updating or deleting `lot_type_link`: 485 consistent, 9 conflicts and 6 unverified. Before the write, two dry runs exposed and fixed false positives for fractional denominations (`1/2 доллара`) and leading denominations followed by an equivalent (`1 талер (48 шиллингов)`). The nine remaining displayed conflicts were objective denomination contradictions, including dollar banknotes linked to cent coin types, francs linked to centimes, and halfpenny linked to half-crown.

The full resumable audit processed all 418,012 current links: 402,176 consistent, 15,104 conflicts and 732 unverified. The largest single-reason groups were mint mismatch (5,225), year mismatch (3,770), denomination-unit mismatch (3,620 after minor-unit synonym normalization) and denomination-value mismatch (2,305). There were no stale `lot_id + type_id` snapshots.

Automatic filtering was then tested as an explicit shadow policy, with the default kept at `none`:

| Scenario | Policy | Ready coverage | MdAPE | Interval coverage |
|---|---|---:|---:|---:|
| Auction | none | 82.4% | 15.9% | 64.3% |
| Auction | denomination-only | 81.8% | 15.9% | 64.3% |
| Collection photo | none | 95.8% | 28.5% | 76.0% |
| Collection photo | denomination-only | 95.2% | 28.6% | 76.1% |
| Auction | all conflicts | 81.0% | 16.3% | 64.4% |
| Collection photo | all conflicts | 94.6% | 28.6% | 75.9% |

Neither quarantine policy improved point accuracy, and both reduced ready coverage. The audit table is therefore a repair/review source, not an active price filter. The migration is applied, but the active production release does not read this table and remains on `9e2f148-slab`.

A first repair-proposal dry run selected the 100 highest-price denomination conflicts. The existing matcher found a different objectively compatible type for 31 (only two at confidence ≥ 0.8), returned no candidate for 39, and reconfirmed the current conflicting type for 30. The alternatives still require review: some are strong (`50 евро Airbus A380` to the matching `50 EURO — Airbus A380` type), while others satisfy year and denomination but remain semantically wrong (`1 фунт Великобритании` to a generic `POUND. BRITISH COLONY`). Therefore the proposal tool never writes links and labels even confidence ≥ 0.8 results as review candidates, not approved relinks.

The first manually verified repair was applied transactionally for lot `4495827`: type `354404` (`50 FRANCS. FRENCH ASSOCIATED STATES`) was replaced with type `468293` (`50 EURO. FRANCE — Airbus A380`). Repair-log row `1` preserves the old type, match method and confidence for rollback; an independent report confirmed `currentlyApplied = true`. No other proposal was applied.

## Exact Bitkin-reference repairs

The completed Temporal import is materially richer than the coarse `coin_type(source='bitkin')` layer. Its isolated normalized tables contain both books in full:

- `bitkin_part1_v2`: 527 pages and 5,132 unique entries;
- `bitkin_part2_v2`: 502 pages and 7,070 unique entries;
- every one of the 12,202 entries has a unique `printed_page.bitkin_number` reference;
- 1,177 entries already have a unique 0.99-confidence bridge to an existing `coin_type` by full Bitkin reference and year.

A read-only scan found 4,238 audited conflicts whose source description mentions Bitkin. Of these, 1,270 contain exactly one full `page.number` reference. The proposal pipeline accepted a repair only when all three sources agreed on year and denomination, the proposed catalog type had no hard contradiction with the lot, the normalized Bitkin entry had no hard contradiction with either side, and the reference-to-type bridge was unique. Results before writing:

| Result | Lots |
|---|---:|
| Strict repair candidate | 322 |
| Exact entry but no existing type bridge | 493 |
| Cross-source evidence incomplete | 310 |
| Cross-source contradiction | 39 |
| Full reference not found in normalized import | 106 |

The 322 strict candidates cover 44 unique Bitkin references. They were applied in one transaction with `repair_reason='bitkin_exact_reference'`; each row preserves the old type, method and confidence in `lot_type_link_repair_log`. The transaction also updates the corresponding quality snapshot to the newly validated type. A repeated dry run returned zero remaining strict candidates, production readiness remained `status=ok`, and no service restart or release switch was performed.

For 493 exact Bitkin entries without an existing bridge, the existing matcher was used only as a candidate generator. Requiring agreement across the lot, normalized Bitkin row and candidate type, rejecting coarse `source='bitkin'` targets, and requiring the candidate to be the only compatible imperial type reduced this set to 11 lots over four references. Those 11 links and the four missing `bitkin_coin_type_match` rows were inserted in a second transaction. The remaining 482 were left unchanged: 115 had cross-source contradictions, 83 were unresolved, 74 pointed only to a coarse catalog target, 128 were catalog-ambiguous, 60 lacked complete evidence, and 22 reconfirmed the current link.

After the Airbus and both Bitkin repair transactions, the full quality inventory is 402,510 consistent, 14,770 conflict and 732 unverified links. There are no stale quality snapshots. The largest reduction was in the mint-mismatch group, from 5,225 to 4,892. The diagnostic quality report was also changed from five parallel database queries to sequential reads after the small production pool twice terminated one reporting connection; application readiness remained healthy throughout.

The same deterministic 500-target backtests were repeated after the repair. Auction results remained 82.4% ready coverage, 15.9% MdAPE and 64.3% interval coverage. Collection-photo results remained 95.8% ready coverage, 28.5% MdAPE and 76.0% interval coverage. The repaired rare imperial lots were not present in this fixed sample, so this confirms non-regression of the sampled market rather than a measured accuracy gain. The decision not to switch user-facing prices remains unchanged.

## Issue year versus year inscribed on the coin

The original year audit treated `coin_type.year` and the year in an auction title as the same property. That is false for part of the official CBR catalog. For example, CBR catalog number `5111-0202` (Rabbit) was officially issued on 2010-10-01 but has `2011` on the obverse; Olympic issues released in 2012 or 2013 have `2014` on the coin. The old modern matcher already acknowledged this distinction through its `year_shift` fallback, but the data model and audit did not.

Migration `202608280007_coin_type_coin_year.sql` adds nullable `coin_type.coin_year` while retaining `year` as the catalog issue year and `issue_date` as the exact official date. A scoped idempotent backfill fetched all 43 CBR types involved in the remaining pure year conflicts directly from their official catalog cards. All 43 cards were parsed without error; the backfill stored the official issue date and the year found strictly in the card's obverse section. The CBR skeleton importer and both modern matchers now preserve and use both year meanings.

Re-auditing the 1,287 remaining pure year conflicts changed 1,226 to consistent and retained 61 conflicts. Four of those had an unambiguous alternative type and were repaired transactionally:

- lots `4459550` and `150670`, “Нижний Новгород 2021”, moved from the unrelated 2023 type `1819` to the 2021 type `1732`;
- lots `4825277` and `4815031`, Trinidad and Tobago 25 cents 1976, moved from the 1974-only KM#28 type `456346` to the 1976–2000 type `422879`.

The remaining 57 are deliberately quarantined. Forty-two are three repeated Wolmar title-year errors where denomination, mint and exact theme identify the current CBR type but the source title is one year later than both the official issue year and `coin_year`. Two Russian 1994 titles point to official 1995 types. Eleven Trinidad and Tobago rows fall outside their SCWC year ranges, and two Bosnia-Herzegovina rows also contradict the linked denomination; none has a unique verified replacement in the current catalog.

The generic rematcher was explicitly rejected as repair evidence after it proposed semantically different same-year types, including Königsberg to Belgrade and one church to another. Candidate confidence based on year and denomination is therefore insufficient without independent identity/theme evidence.

After the year-semantics correction and four repairs, the complete quality inventory is 406,223 consistent, 11,057 conflict and 732 unverified links, with no stale snapshots. User-facing comparable filtering remains disabled, so these audit changes do not alter active prices.

## Denomination-conflict inventory and exact KM repairs

The dedicated read-only denomination report found 6,093 links with a denomination contradiction: 3,604 unit mismatches, 2,320 value mismatches, 156 value-plus-mint mismatches, and 13 rows also carrying a year mismatch. The affected completed prices total RUB 27,496,926.07, but this is an exposure inventory rather than an estimate of pricing error. Most conflicts are foreign (4,890); 1,160 are imperial, 42 Soviet, and one modern Russian.

The generic matcher was again rejected as repair authority. In the 1,000 highest-price conflicts it produced 102 nominally high-confidence alternatives, but examples included Anhalt-Bernburg to Saxe-Coburg-Gotha and a US silver dollar to Shawnee Tribal Nation. A separate KM repair pipeline therefore accepts a candidate only when the lot contains exactly one explicit KM/Krause reference and the catalog contains exactly one type agreeing independently on KM number, country, year/range and denomination. Sets, non-coins, unresolved countries, catalog ambiguity and any hard audit contradiction abstain.

This strict pipeline selected 62 links over 36 KM references. They cover 57 priced lots totaling RUB 881,007, including a 1983 British pound sold for RUB 150,000 that had been linked to a halfpenny type. Migration `202608280008_km_exact_repair_reason.sql` added the evidence-specific journal reason without touching lot links. All 62 repairs were then applied in one transaction with the old type, method and confidence preserved in `lot_type_link_repair_log`; every quality snapshot was changed to `consistent` only after the candidate was revalidated under row lock. A repeated dry run returned zero candidates.

After the KM transaction the inventory is 406,285 consistent, 10,995 conflict and 732 unverified links, with zero stale snapshots. Remaining denomination conflicts total 6,031: 3,553 unit, 2,309 value, 156 value-plus-mint and 13 combined with year. The largest cohort is still 1,183 half-kopeck lots linked to two-kopeck types. These are genuine errors, but the only current alternative for many years is the coarse `coin_type(source='bitkin')` entry `денга <year>`, which loses Bitkin variant and mint identity. They are deliberately left unchanged until normalized Bitkin entries can be materialized or bridged at the required granularity.

The user-facing comparable policy remains disabled, the active release remains `9e2f148-slab`, and no service or worker was restarted.

## Verification

- A dependency-complete verification run passed 125/125 tests after the matcher, range and audit fixes. The latest focused denomination, KM-application and migration suites pass 30/30. The latest full local rerun loaded 135 tests: 132 passed and three test files failed to load because this checkout's `node_modules` lacks `express` and `minio`; the failures are unrelated to the changed modules.
- Production migrations: up to `202608280008_km_exact_repair_reason.sql`.
- Active production readiness: `status=ok`, database `up` after both writes.
- Active production release was not changed.
