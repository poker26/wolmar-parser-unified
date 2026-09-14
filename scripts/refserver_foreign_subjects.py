"""Conservative subject conflicts for foreign commemorative candidates."""

from __future__ import annotations

import re
import unicodedata


_SUBJECT_PATTERNS = {
    "puma": (
        r"(?<![a-zа-я])пум\w*(?![a-zа-я])",
        r"(?<![a-z])puma(?:s)?(?![a-z])",
        r"(?<![a-z])cougar(?:s)?(?![a-z])",
        r"(?<![a-z])mountain\s+lion(?:s)?(?![a-z])",
    ),
    "snow_leopard": (
        r"(?<![а-я])снежн\w*\s+барс\w*(?![а-я])",
        r"(?<![a-z])snow\s+leopard(?:s)?(?![a-z])",
        r"(?<![a-zа-я])ирбис\w*(?![a-zа-я])",
    ),
}


def _fold(value) -> str:
    text = str(value or "").casefold().replace("ё", "е")
    return "".join(
        character
        for character in unicodedata.normalize("NFKD", text)
        if not unicodedata.combining(character)
    )


def recognized_subjects(value) -> frozenset[str]:
    text = _fold(value)
    return frozenset(
        subject
        for subject, patterns in _SUBJECT_PATTERNS.items()
        if any(re.search(pattern, text) for pattern in patterns)
    )


def foreign_subject_conflicts(extracted: dict, candidate: dict) -> bool:
    observed = recognized_subjects(extracted.get("subject"))
    catalog = recognized_subjects(" ".join(str(candidate.get(field) or "") for field in (
        "name_full", "theme_ru", "krause_subject", "krause_design",
    )))
    return bool(observed and catalog and observed.isdisjoint(catalog))
