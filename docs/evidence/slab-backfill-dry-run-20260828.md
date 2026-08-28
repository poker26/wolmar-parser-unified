# Slab backfill dry-run — 2026-08-28

The final read-only run used `extractSlabInfo` version `slab-info-v1` against every production `auction_lots` row. No schema migration or data write was performed by this run.

## Coverage

| Source | Lots | Slabbed | Explicit raw | Unknown | Label grades |
|---|---:|---:|---:|---:|---:|
| `wolmar.ru` | 442,237 | 79,326 | 0 | 362,911 | 4 |
| `numismat.ru` | 174,960 | 8,017 | 3 | 166,940 | 4,447 |
| `meshok.net` | 132,183 | 697 | 0 | 131,486 | 315 |
| `auction.ru` | 797 | 4 | 0 | 793 | 1 |
| **Total** | **750,177** | **88,044** | **3** | **662,130** | **4,767** |

The very small `raw` count is intentional. Missing slab wording remains `unknown`; only explicit negative evidence becomes `raw`.

## Canonical companies

Final canonical counts:

| Code | Count |
|---|---:|
| NGC | 42,741 |
| NNR | 19,839 |
| PCGS | 5,292 |
| NGS | 4,137 |
| NRG | 2,317 |
| RNGA | 1,467 |
| OTHER | 11,944 |

The following aliases were confirmed from production descriptions and remain mapped by the common normalizer:

- `ННР`, `HHP`, `NNR`, plus mixed Cyrillic/Latin variants, to `NNR`;
- `РНГА` and `RNGA` to `RNGA`;
- mixed-alphabet forms of `NGC` and `PCGS` to their Latin canonical codes.

Unknown companies remain `OTHER` and keep the original spelling. Frequent examples include `PMG`, `PG`, `CPRC`, `Premium Grading`, `CGC`, `NBR`, `ZG`, and `PCCB`. They were not promoted to new canonical codes because the RFC's canonical vocabulary is fixed and no valuation backtest exists for separate company treatment.

## Manual checks and rule changes caused by the dry-run

- Wolmar lot `744`: `В слабе NGS`, while `condition=MS64`. Status and company are extracted, but the grade source remains `auction_house`.
- Wolmar lot `788`: `В слабе` with no company. Status is `slabbed`; company remains null.
- Wolmar lot `6205`: `В слабе CPRC`. Company is stored as `OTHER`, raw spelling `CPRC`.
- Wolmar lot `6253`: `В слабе ANACS`. Company is stored as `OTHER`, raw spelling `ANACS`.
- Numismat lot `33255`: `в пластиковой капсуле (слабе) NGC, AU 53`. The parser now recognizes the Numismat wording and records `AU53` as `slab_label`.
- Numismat lot `33818`: `в пластиковой капсуле (слабе) ННР, MS 66`. The alias maps to `NNR`; the adjacent grade is label evidence.
- Meshok lots around `4908005`: `в слабе-коробке PCCB`. The packaging word is skipped and `PCCB` is preserved as `OTHER`.

The first implementation searched too far after a slab phrase and could pick up a later catalog grade such as `XF`. The final extractor only accepts an immediately adjacent label sequence. This reduced Wolmar label grades from 114 to 4 while increasing valid Numismat label grades from 0 to 4,447.

## Comparable density

The dry-run found 61,731 completed-sale groups keyed by `type + grade + slab status + company`:

| Sales in exact group | Groups |
|---|---:|
| 1 | 25,569 |
| 2 | 9,021 |
| 3–4 | 7,654 |
| 5–9 | 9,270 |
| 10+ | 10,217 |

This confirms the RFC requirement for controlled comparable expansion: many exact groups are sparse, so exact-company matching alone cannot be the only valuation basis.
