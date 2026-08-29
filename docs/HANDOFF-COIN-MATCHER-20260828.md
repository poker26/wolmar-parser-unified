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

## Wolmar Standart pilot: generic commemorative titles produce false matches

The production pilot imported 20 closed lots from Wolmar Standart auction `s800`
(Wolmar auction id `2147`) into `auction_data`. Parsing completed 20/20 with no
errors. No `lot_type_link` rows were applied: the dry-run exposed false or
insufficiently supported matches.

Concrete reproductions from production data:

- lot `4935332`, `25 рублей. Чемпионат мира по футболу 2018г. ММД. UNC.` was
  proposed as `coin_type.id=1548`, `25 рублей. Творчество Владимира Высоцкого`;
- lots `4935333` through `4935341` have the generic title
  `25 рублей. Оружие великой Победы 2019г. ММД. UNC.` and were proposed as
  `coin_type.id=1603`, `25 рублей. 75-летие Победы советского народа в Великой
  Отечественной войне 1941-1945 гг.`. The title does not name the weapon/design,
  so even a candidate from the correct series would not be uniquely supported;
- lots `4935329` and `4935330` have generic Sochi/enamel titles and were proposed
  as `coin_type.id=1149`, `Эмблема XXII Олимпийских зимних игр`. The title alone
  does not establish this specific design/colour variant.

Expected matcher contract:

1. A generic commemorative-series phrase must not be treated as evidence for a
   specific design merely because denomination, year and broad topic agree.
2. A candidate whose distinctive theme conflicts with the title must be
   rejected; the FIFA-to-Vysotsky result must be impossible.
3. When the title lacks the motif/variant needed to distinguish several catalog
   types, `matchType` must abstain (`null`). This is preferable to a guessed link.
4. Add focused regression tests for the examples above. Do not run a bulk
   relink or full production audit for this handoff; verify the examples first.

The Standart parser and pilot linker live on commit `b9cdff0`. The linker is
dry-run by default and remains unapplied for `s800` until the matcher contract is
fixed and these exact rows are rechecked.

## Recheck after catalog response `379f01c`

Targeted production recheck on 2026-08-29 confirms that the word-boundary fix
works for FIFA: current `matchType` returns `null` for lot `4935332` instead of
Vysotsky. Two other parts of the requested abstention contract remain open:

- lots `4935333`-`4935341`, generic `Оружие великой Победы 2019`, now all match
  `coin_type.id=1626`, `Конструктор оружия М.И. Кошкин` with confidence `0.8`;
- lots `4935343`-`4935344`, generic `Оружие великой Победы 2020`, now both match
  `coin_type.id=1681`, `Конструктор оружия А.С. Яковлев` with confidence `0.8`;
- lots `4935329`-`4935330`, generic `Сочи 2014 ... 2013 ... эмаль`, still match
  `coin_type.id=1149`, `Эмблема XXII Олимпийских зимних игр` with confidence
  `0.8`, although the title does not identify a specific design/colour variant.

These are not merely dry-run proposals anymore. A later broad `relink-v2` run
inserted 18 links for the 20-lot `s800` pilot, including the stale FIFA ->
Vysotsky link and all generic-series matches above. On 2026-08-29 the valuation
task transactionally removed exactly the 14 enumerated unsupported `s800` links;
the four specific, supported links remain. The matcher task still needs focused
abstention tests for the generic series before another orphan relink is allowed.

## Wolmar Standart foreign pilot: `США` is not parsed as a country

A second production pilot imported 20 foreign-coin lots from the same closed
auction `s800`, category `Монеты иностранные` (lot numbers 1155-1177). All 20
have a final RUB bid, condition and both images. No links were written.

Targeted dry-run with the active production matcher:

- checked: 20;
- proposed: 0;
- abstained: 20;
- `parseTitle(...).country` is absent for every title beginning with forms such
  as `1 доллар. США 1921г. Ag.`, while denomination and year parse correctly.

The sample includes ordinary US dollars for 1921, 1923, 1976, 1979, 2000,
2007-2014, 2019 and 2021. This is a compact reproduction for the already
reported US foreign-miss cohort. Expected first contract: normalize the explicit
country token `США` to the same country canon used by the SCWC/Krause candidates.
Candidate selection must still abstain when country+denomination+year leave
multiple designs or varieties and the title contains no additional evidence.

Please verify these 20 rows only before any broad orphan relink. They are
production `auction_lots.id=4935345..4935364` and currently have no
`lot_type_link` rows.

## Post-relink Standart `s840`: focused false-positive classes

After the catalog agent completed the relink, a read-only audit was run only on
the fully imported Standart auction `s840` (3,828 lots; 2,792 linked). No links
were changed and no broad audit/relink was started.

The following links are unambiguously wrong and provide compact regressions:

- `4935728`: `3 копейки 1876 СПБ` -> type `42116`, `5 копеек 1876 СПБ`;
- `4935779`: `2 копейки 1759` -> type `41301`, `1 копейка 1759`;
- `4935835..4935837`: `2 копейки 1899 СПБ` -> type `40822`,
  `1 копейка 1899 СПБ`;
- `4935815`: `2 копейки 1853 ЕМ` -> type `45017`,
  `2 копейки 1853 ВМ`;
- `4936592..4936593`: `3 рубля. Партизанское движение ... 1994 ММД` ->
  type `114`, `50-летие разгрома ... под Ленинградом`, mint `ЛМД`;
- `4938142`: `1/2 доллара США 1972` -> type `367213`, `1/2 PENNY`;
- `4938178`: `50 центов Австралия 1966` -> type `381275`, `50 пенсов`;
- `4938248`: `1 крона Великобритания 1977` -> type `361560`, `1 CENT`;
- `4938379`: `1/2 пенни Новая Зеландия 1965` -> type `371514`,
  `1/2 CROWN`;
- `4938495`: `1 доллар Острова Кука 1983` -> type `384828`, `1 крона`;
- `4938961`: `5 пенни Финляндия 1940` -> type `414066`, `5 MARKKAA`;
- `4938968`: `20 сантимов Франция 1974` -> type `414508`, `20 FRANCS`.

There is also a systematic price-pool problem which a denomination/year-only
matcher must not create. In this one auction alone:

- type `45680`, generic `1 рубль`, year 1990, contains 18 lots mixing Chekhov,
  Rainis, Tchaikovsky and ordinary rubles;
- type `45749`, generic `1 рубль`, year 1989, contains 15 lots mixing Shevchenko,
  Lermontov and Mussorgsky;
- type `45823`, generic `1 рубль`, year 1991, mixes Lebedev, Ivanov and ordinary
  Moscow/Leningrad rubles;
- type `536002`, generic `2 рубля`, year 2000, mixes six different Hero City
  designs;
- type `536055`, generic `10 рублей`, year 2010, mixes Bryansk, Yuryevets and
  the population census;
- type `536060`, generic `10 рублей`, year 2015, mixes three distinct Victory
  designs and an ordinary coin;
- type `446`, broad `200-летие образования ... министерств`, mixes Finance,
  Education and Economic Development issues;
- type `45596`, `Бородино (барельеф)`, also contains the distinct `обелиск`;
- type `45595`, regular `30 лет Победы`, also contains a `Новодел`;
- type `379151`, `1/2 цента`, also contains `2 1/2 цента`.

Expected matcher contract: a distinctive commemorative subject/variant in the
lot title is a hard discriminator. A generic catalog spine type must not absorb
several named commemorative issues merely because denomination and year match.
Named denomination units and explicit mint marks are also hard gates. Please
add focused tests for the rows/types above; do not run another full relink from
this handoff. Recheck only these IDs and the enumerated mixed pools first.

## Verification of catalog response `bcf8398`: explicit links fixed, some pools remain mixed

The response in `HANDOFF-FROM-CATALOG-20260829.md` was verified independently.
Production `catalog/coin-matcher.js` and the test file are byte-identical to
`coin-catalog` HEAD `bcf8398`; `node --test test/coin-matcher-denom.test.js`
passes 11/11 both locally and on production.

A production read-only dry-run of the active matcher confirms the stated fixes
for the enumerated denomination/unit/mint errors. In particular:

- `4935728` now proposes `41245`; `4935815` proposes `41574`;
- `4935835..4935837` now propose `40435`;
- `4936592..4936593` now propose the correct Partisan type `113`;
- the seven foreign unit mismatches now all abstain;
- the generic `s800` weapon/Sochi examples abstain, except the explicitly named
  Leningrad issue `4935342`, which remains on `1606`.

However, the statement that the mixed price pools are now generally repairable
is only partly true. Across the 88 `s840` links in the 15 reported pools, the
new matcher proposes 62 different types, one abstention and 25 unchanged links.
Most of the 62 are good subject-level separations, but 21 lots would still form
clearly mixed pools after applying the new matcher:

- old generic type `536002` splits only by mint: new type `365` receives both
  Leningrad and Stalingrad, while `367` receives Moscow, Smolensk, Tula and
  Murmansk. Six Hero City designs remain collapsed into two pools;
- type `446` still receives both Ministry of Finance and Ministry of Economic
  Development. Ministry of Education moves to `448`, but all these CBR type
  names are the same broad series name, so the subject identity is not present
  in the matcher-visible fields;
- type `45596` still receives both Borodino `обелиск` and `барельеф`;
- type `45595` still receives both the original 1975 Victory ruble and
  `Новодел`;
- type `1328` would receive both `Перекуем мечи на орала` and `Эмблема` from
  the 2015 Victory series;
- generic type `536060` would receive both `Памятник воину-освободителю` and an
  ordinary 2015 ruble described only by `Соосность 90°`.

There is also a lower-priority unresolved granularity question: generic type
`45823` still combines regular 1991 rubles with `Л` and `М` mint marks.

Please do not run the repair yet. For the six classes above, either enrich the
catalog candidate with the actual distinguishing subject/variant, or abstain
when that identity is not available. Add focused regressions for these exact
titles, then return another dry-run of only these 21 rows. No broad relink or
full audit is requested.

## Verification of catalog response `48ba8ba`: real-title regressions remain

The second response was found in `HANDOFF-FROM-CATALOG-20260829-2.md` and checked
against the sole production entry point `parseTitle` -> `matchType`. Production
files are byte-identical to `coin-catalog` HEAD `48ba8ba`, and all 15 isolated
tests pass on production.

The same unchanged read-only verifier was rerun on the exact production titles.
Its result does not agree with the aggregate dry-run reported in the response:

- previously correct `4936592..4936593`, `Партизанское движение ... 1994 ММД`,
  matched type `113` under `bcf8398`; under `48ba8ba` both now abstain;
- five correctly separated 1990 commemorative rubles now abstain:
  `4936692`, `4936694`, `4936695`, `4936697`, `4936698`;
- five correctly separated 1989 commemorative rubles now abstain:
  `4936668`, `4936669`, `4936674`, `4936675`, `4936680`;
- correct subject-level matches also regress to abstention for Gorky
  (`4936663`), Lebedev (`4936718`), Derzhavin/Timiryazev
  (`4936725..4936726`) and all three Netherlands East Indies fraction examples
  (`4938395`, `4938396`, `4938399`).

That is 19 known supported links lost by `48ba8ba`: the two Partisan examples
plus 17 examples from the previously examined mixed-pool cohort. These are not
the intended abstentions for catalog identities that are genuinely absent.

Three original mixed-pool failures also remain reproducible through the real
production matcher despite the new tests:

- `4936653`, real title `1 рубль. 175 лет Бородино (обелиск) 1987г. Cu-Ni.`,
  still returns type `45596`, whose name is `... (барельеф)`;
- `4936609`, real title containing `Новодел`, still returns ordinary type
  `45595`;
- `4936388`, `4936389` (Finance) and `4936394` (Economic Development) still all
  return type `446`; the latter therefore remains in the Finance price pool.

The 2015 and Hero City changes do work on the exact `s840` titles: the six Hero
City rows and the unsupported 2015 subjects now abstain, while `Эмблема` keeps
the supported type `1328`.

Required next verification contract:

1. Tests must use the exact stored production titles above, including their
   punctuation and word order; the current simplified tests do not exercise the
   path taken by the real rows.
2. Add positive regressions, not only abstention tests: Partisan -> `113`,
   named 1989/1990 commemoratives -> their known subject types, and 1/2 versus
   2 1/2 Netherlands East Indies cents must remain matchable.
3. Run `matchType(pool, parseTitle(realTitle))` directly for these IDs. If the
   repair dry-run uses additional rules and produces a different answer, it is
   not validating the canonical matcher contract.

Do not run repair or relink yet. Return a focused result for these 22 rows only
(19 regressions plus the three still-mixed real-title cases); no 4,000-row or
global sample is requested.
