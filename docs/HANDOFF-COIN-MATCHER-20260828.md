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

## Named denomination is overwritten by a later reference price

Reproduction in the current local checkout:

```text
parseTitle('Деньга 1810 года, ИМ-МК. Биткин# 620 (R). Очень редкая, 1 рубль по Ильину, 1 рубль 50 копеек по Петрову.').denom
=> { num: 1, unit: 'рубль', value: 1, isRf: true }

parseTitle('Деньга 1812 года, ИМ-ПС. Биткин# 623. Довольно редкая, 1 рубль по Петрову.').denom
=> { num: 1, unit: 'рубль', value: 1, isRf: true }
```

Expected for both titles: the leading named denomination `деньга`, value `0.005` ruble. Production `bitkin_entry` rows `8746` (`769.620`) and `8749` (`769.623`) independently confirm denomination `ДЕНЬГА`, years 1810/1812 and mint marks `ИМ МК`/`ИМ ПС`. A later Iljin/Petrov reference price must never replace the coin denomination.

Required regression coverage should include `деньга`, and the same leading-denomination priority should be checked for the other imperial named denominations already normalized by the Bitkin pipeline (`полушка`, `полуполтинник`, `полтина`, `пятиалтынный`, `гривенник`).

## Exact Bitkin catalog types require reference-aware matching

The largest remaining strict short-reference cohort contains 55 lots and RUB 26,435,000 of completed-price exposure for thirteen distinct 1741 SPB ruble entries. They are not one catalog identity:

- Bitkin `532.17`-`532.23`, `534.33` and `534.35`: Ioann Antonovich;
- Bitkin `562.233`-`562.236` and `562.238`: Elizabeth, including distinct variants and rarity levels.

The seven existing compatible `coin_type` rows are page-level or duplicate cards. Mapping all thirteen references to three page-level types would merge different Bitkin varieties into the same comparable-price population. This must not be used as a repair shortcut.

The normalized `bitkin_entry` table can instead materialize one exact catalog type per `bitkin_reference`. Before such types are promoted into `era='imperial'`, matcher behavior needs this contract:

1. An explicit full or short Bitkin reference, after year/denomination/mint disambiguation, selects the exact type by normalized `bitkin_number`/reference.
2. Exact Bitkin variants do not all compete in the generic year+denomination pool when the lot has no reference-level evidence; the matcher must abstain or select only an appropriate coarser parent.
3. Candidate loading must define how `status`/source controls participation. The current imperial query loads every matching `coin_type` regardless of status, so merely inserting draft exact variants can change live matching.

Once this contract is implemented, the current evidence supports one systematic materialization pass for 50 exact unbridged entries covering 216 conflicting lots, followed by the existing journaled short-reference repair pipeline. Until then those entries remain unchanged.

## Verification of the catalog agent's claimed fix

Verified read-only against worktree `C:\Users\hippo\wolmar-parser`, branch `coin-catalog`, HEAD `fcb45ec` (including matcher commits `b2532e6` and `fed3f51`). Targeted `test/coin-matcher-denom.test.js` passed 5/5.

Implemented and confirmed:

- `1/2 копейки` -> value `0.005`;
- `1/4 копейки` -> value `0.0025`;
- both `Деньга 1810 ... 1 рубль по Ильину` and `Деньга 1812 ... 1 рубль по Петрову` -> named denomination value `0.005`.

Still failing or absent:

- `parseTitle('Лот из двух экземпляров 2 копейки 1825 года, КМ-АМ. Биткин# 517. (2)').isSet` remains `false`; the SET expression recognizes numeric counts but not the written count `двух`;
- exact Bitkin reference-aware matching is not implemented. The imperial candidate query still selects only `id, name_full, metal` by year and denomination; it neither selects nor compares `bitkin_number`, and it does not define status/source participation for exact materialized variants.

Therefore the fraction false-positive cohort can be rechecked after the matcher commits reach the active release, but exact Bitkin type materialization remains blocked by the two missing contracts above.
