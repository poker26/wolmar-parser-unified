ALTER TABLE catalog_issue
    ADD COLUMN catalog_publication_year SMALLINT
        CHECK (catalog_publication_year IS NULL OR catalog_publication_year BETWEEN 1800 AND 2200);

UPDATE catalog_issue
SET catalog_publication_year = 2020
WHERE source = 'scwc';

COMMENT ON COLUMN catalog_issue.catalog_publication_year IS
    'Publication year of the source catalog, distinct from the coin issue year and valuation date';
