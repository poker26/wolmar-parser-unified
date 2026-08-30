# Slab-aware valuation shadow design

Date: 2026-08-28  
Contract: `docs/RFC-SLAB-AWARE-VALUATION-AND-IDENTIFICATION.md`

## Safety boundary

- Shadow results are stored only in `valuation_shadow_result`.
- No user-facing API reads that table.
- `lot_price_predictions`, `user_collections.predicted_price` and the active
  `collection_valuation` writer are unchanged.
- The CLI defaults to dry-run. Persistence requires both `--write` and
  `--confirmed`.

## Identity

The first shadow version requires an exact `coin_type` identity. An auction-lot
fallback may resolve `type_id` through its existing `lot_type_link`, but there is
no free-text fallback that can mix different denominations or varieties.

Production coverage measured before implementation:

| Scope | Lots | Linked to `coin_type` |
|---|---:|---:|
| Completed sales | 533,332 | 308,977 (57.9%) |
| Current-auction scope | 3,734 | 2,880 (77.1%) |
| Active collection items | 1 | 1 (100%) |

Unlinked targets abstain with `identity_required`; improving catalog linkage is
separate from valuation logic.

Paper money is outside this coin RFC. Auction rows explicitly identified as
paper money abstain with `unsupported_asset_kind`, even if an erroneous legacy
`lot_type_link` points them at a coin. They remain on the legacy production path
until a separate banknote catalog and valuation contract exists.
The auction shadow CLI samples coin rows by default so a bounded pilot is not
consumed by a contiguous paper-money section of an auction.

## Comparable expansion

For a known grade, the grade is never dropped:

1. same type, grade, slab status and company;
2. same type, grade and slab status;
3. same type and grade across slab statuses.

For `slab_status=unknown`, no raw/slabbed status is inferred. For an unknown
grade, the module may use a broad type-level market range and marks confidence
low. Company expansion applies no manual coefficient.

The strict comparable count and the selected expanded count are returned and
stored separately. At least three sales are required in shadow v1.

## Existing production price mechanics retained

- six-month recency half-life;
- recency-weighted median rather than an arithmetic mean;
- historical precious-metal delta between each comparable sale date and the
  valuation date;
- the same fallback purity assumptions as `ImprovedPredictionsGenerator` when
  fineness is absent (`Au/Ag=0.9`, `Pt/Pd=0.95`).

Metal prices are read from the existing `metals_prices` history. The shadow run
does not call CBR or another external service.

## Parameters requiring backtest before any switch

- minimum of three comparables;
- P25/P75 for an exact group and P10/P90 for an expanded group;
- confidence thresholds;
- whether completed Meshok and auction.ru rows have sufficiently consistent
  hammer-price semantics for the common source set;
- acceptable coverage loss from requiring `type_id`.

No active consumer may be switched until these parameters and source semantics
are evaluated by a time-split backtest.
