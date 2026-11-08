import argparse
import re
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument("--platform", choices=["android", "ios"], required=True)
parser.add_argument("--root", type=Path, required=True)
args = parser.parse_args()
if args.platform == "android":
    sources = args.root / "app/src/main/java/ru/begemot26/numismat"
    extension = "kt"
    catalogue_screens = ["CatalogBrowserScreen.kt", "CatalogCoinScreen.kt"]
else:
    sources = args.root / "iosApp"
    extension = "swift"
    catalogue_screens = ["CatalogBrowserView.swift", "CoinActionsView.swift"]

files = list(sources.rglob(f"*.{extension}"))
if not files:
    raise SystemExit(f"No {args.platform} sources found")
for path in files:
    code = path.read_text(encoding="utf-8-sig")
    if re.search(r"\b(?:parseDenomination|parseCoinDenomination|collectionMetalGroup)\b", code):
        raise SystemExit(f"Local catalogue normalization in {path.name}")
    if re.search(r"\b(?:summarizeLocalCollection|hasMetalValuationInputs|hasPreciousMetalAndFineness|"
                 r"canRecalculateValuation|collectionMatchesDenomination|matchesDenomination)\b", code):
        raise SystemExit(f"Local collection decision in {path.name}")
    if any(route in code for route in ("/api/coincat/types", "/api/v1/collection/catalog-search")):
        raise SystemExit(f"Legacy catalogue route in {path.name}")
for name in catalogue_screens:
    code = (sources / name).read_text(encoding="utf-8-sig")
    if re.search(r"\btype\.(?:thumb|reverseImage)\b", code):
        raise SystemExit(f"Catalogue photo bypass in {name}")
    if "photoCandidates" not in code:
        raise SystemExit(f"Server photo candidates missing in {name}")
if args.platform == "android":
    picker = (sources / "GuidedCoinSearch.kt").read_text(encoding="utf-8-sig")
    if re.search(r"\bhit\.(?:thumb|reverseImage)\b", picker) or "hit.photoCandidates" not in picker:
        raise SystemExit("Specimen picker must display the server photo candidates")
else:
    picker = (sources / "SpecimenSearchView.swift").read_text(encoding="utf-8-sig")
    if re.search(r"\bchoice\.(?:thumb|reverseImage)\b", picker) or "choice.photoCandidates" not in picker:
        raise SystemExit("Specimen picker must display the server photo candidates")
print(f"{args.platform} catalogue consumer checks passed")
