# Handoff: `coin-matcher` ownership boundary

`catalog/coin-matcher.js` is owned by the catalog-matching task. The valuation/link-quality task does not patch or cherry-pick changes to that file. Findings are passed here with production evidence and an expected contract.

## Fractional denomination regression in active release

Active production release during verification: `/var/www/wolmar-releases/d92b868-spine`.

Reproduction against its exported `parseTitle`:

```text
parseTitle('1/2 копейки 1840г. ЕМ. Cu.').denom
=> { num: 2, unit: 'копейки', value: 0.02, isRf: true }

parseTitle('1/4 копейки 1869г. СПБ. Cu.').denom
=> { num: 4, unit: 'копейки', value: 0.04, isRf: true }
```

Expected contract:

```text
1/2 копейки => { num: 0.5, value: 0.005, isRf: true }
1/4 копейки => { num: 0.25, value: 0.0025, isRf: true }
```

The production audit therefore marks links such as `1/2 копейки 1840` to the identically named catalog type as `denomination_value_mismatch`. The cohort report classifies these as `matcher_fraction_parse_false_positive`; they must not be repaired or unlinked.

Full production audit evidence after the spine relink:

- current links audited: 437,779
- raw conflicts: 18,065
- `matcher_fraction_parse_false_positive`: 6,975 links across 442 current types
- false-positive completed-price exposure: RUB 29,928,225 (an inventory sum, not an error estimate)
- largest signatures: 3,175 imperial half-kopecks, 1,530 imperial quarter-kopecks, 1,107 foreign half-dollars, and 212 imperial three-quarter rubles
- stale quality snapshots were pruned after the full audit; current stale count is zero

Required regression coverage:

- `1/2 копейки 1840г. ЕМ. Cu.`
- `1/4 копейки 1869г. СПБ. Cu.`
- an actual `1/2 копейки` lot linked to `2 копейки` must still remain a real mismatch in the audit
- bidding/reference prices later in the description must not replace the leading fractional denomination

## Explicit multi-coin lot missed by active release

Production reproduction:

```text
parseTitle('Лот из двух экземпляров 2 копейки 1825 года, КМ-АМ. Биткин# 517. (2)').isSet
=> false
```

Expected: `isSet=true`. The Bitkin repair pipeline has a conservative abstention gate for the explicit `лот из <count> экземпляров` phrase, so lot `50715` is not relinked to a single-coin type. The canonical rule still belongs in `coin-matcher`.

## Integration contract

All title parsing and candidate selection changes remain in `catalog/coin-matcher.js` and its tests. The valuation/link-quality task consumes `parseTitle(title)` and sends failures through this handoff; it does not create a competing parser or edit matcher directly.
