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
for name in catalogue_screens:
    code = (sources / name).read_text(encoding="utf-8-sig")
    if re.search(r"\btype\.(?:thumb|reverseImage)\b", code):
        raise SystemExit(f"Catalogue photo bypass in {name}")
    if "photoCandidates" not in code:
        raise SystemExit(f"Server photo candidates missing in {name}")
print(f"{args.platform} catalogue consumer checks passed")
