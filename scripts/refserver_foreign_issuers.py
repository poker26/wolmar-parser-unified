"""Conservative aliases for foreign coin issuers used by refserver.

Only spelling variants of the same catalog issuer belong in one group.  Parent
states, joint issuers, dependencies and successor states remain separate.
"""

from __future__ import annotations

import re
import unicodedata


_ISSUER_GROUPS = {
    "Isle of Man": (
        "Isle of Man",
        "Isle Of Man",
    ),
    "Turks and Caicos Islands": (
        "Turks and Caicos Islands",
        "Turks & Caicos Islands",
    ),
    "Saint Helena": (
        "Saint Helena",
        "St. Helena",
    ),
    "Saint Helena & Ascension": (
        "Saint Helena & Ascension",
        "Saint Helena And Ascension",
        "St. Helena & Ascension",
        "St. Helena And Ascension",
    ),
    "St. Helena Dependencies": (
        "St. Helena Dependencies",
        "Saint Helena Dependencies",
        "St. Helena Dependency",
        "Saint Helena Dependency",
    ),
    "Curaçao": (
        "Curaçao",
        "Curacao",
    ),
    "Réunion": (
        "Réunion",
        "Reunion",
    ),
}


def _issuer_key(value: str | None) -> str:
    text = str(value or "").casefold().replace("&", " and ")
    text = "".join(
        character
        for character in unicodedata.normalize("NFKD", text)
        if not unicodedata.combining(character)
    )
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def issuer_spelling_key(value: str | None) -> str:
    """Group punctuation, ampersand and St./Saint variants for audit only."""
    words = _issuer_key(value).split()
    return " ".join("saint" if word == "st" else word for word in words)


_ALIAS_TO_CANONICAL = {
    _issuer_key(alias): canonical
    for canonical, aliases in _ISSUER_GROUPS.items()
    for alias in aliases
}


def canonicalize_foreign_issuer(value: str | None) -> str | None:
    if value is None or not str(value).strip():
        return None
    stripped = str(value).strip()
    return _ALIAS_TO_CANONICAL.get(_issuer_key(stripped), stripped)


def catalog_country_variants(value: str | None) -> tuple[str, ...]:
    canonical = canonicalize_foreign_issuer(value)
    if canonical is None:
        return ()
    return _ISSUER_GROUPS.get(canonical, (canonical,))


def issuer_from_legends(legends) -> str | None:
    if isinstance(legends, str):
        legends = [legends]
    text = _issuer_key(" ".join(str(value or "") for value in legends or []))
    if not text:
        return None

    # The current catalog does not equate this three-territory issuer with any
    # of the narrower Saint Helena groups.
    if "tristan da cunha" in text:
        return None
    if re.search(r"\b(?:saint|st) helena dependenc(?:y|ies)\b", text):
        return "St. Helena Dependencies"
    if re.search(r"\b(?:saint|st) helena (?:and )?ascension\b", text):
        return "Saint Helena & Ascension"
    if re.search(r"\b(?:saint|st) helena\b", text):
        return "Saint Helena"
    return None


def known_issuer_groups() -> dict[str, tuple[str, ...]]:
    return dict(_ISSUER_GROUPS)
