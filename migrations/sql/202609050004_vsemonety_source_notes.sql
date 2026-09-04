-- Keep the source description aligned with the adapter's evidence fallback rules.

UPDATE catalog_source SET
    notes=replace(
        notes,
        'Only pages with product identity, country, denomination and one exact year are ingested.',
        'Only product pages with multiple numismatic characteristics, a denomination in the title and one exact issue year are ingested. Country and structured denomination may be absent when the remaining evidence identifies a coin.'
    ),
    updated_at=now()
WHERE source_key='xn--b1aga1affsn5f.xn--p1ai';
