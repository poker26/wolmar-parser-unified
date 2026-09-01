CREATE TABLE catalog_issue (
    id BIGSERIAL PRIMARY KEY,
    type_id INTEGER NOT NULL REFERENCES coin_type(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'scwc',
    source_ordinal INTEGER NOT NULL CHECK (source_ordinal > 0),
    year INTEGER CHECK (year IS NULL OR year BETWEEN 1000 AND 2200),
    year_label TEXT,
    mint TEXT,
    variety TEXT,
    mintage BIGINT CHECK (mintage IS NULL OR mintage >= 0),
    ref_pdf_src TEXT,
    ref_pdf_page INTEGER CHECK (ref_pdf_page IS NULL OR ref_pdf_page > 0),
    source_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (type_id, source, source_ordinal)
);

CREATE INDEX catalog_issue_type_year_idx
    ON catalog_issue(type_id, year, id);

CREATE TABLE catalog_issue_price (
    id BIGSERIAL PRIMARY KEY,
    issue_id BIGINT NOT NULL REFERENCES catalog_issue(id) ON DELETE CASCADE,
    source_label TEXT NOT NULL,
    price_kind TEXT NOT NULL
        CHECK (price_kind IN ('grade', 'reference_value', 'issue_price', 'net_value', 'bullion_value', 'other')),
    grade_code TEXT,
    currency CHAR(3) NOT NULL DEFAULT 'USD'
        CHECK (currency ~ '^[A-Z]{3}$'),
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    source_value TEXT,
    UNIQUE (issue_id, source_label, currency),
    CHECK ((price_kind = 'grade') = (grade_code IS NOT NULL))
);

CREATE INDEX catalog_issue_price_grade_idx
    ON catalog_issue_price(grade_code, currency, issue_id);

CREATE INDEX catalog_issue_price_kind_idx
    ON catalog_issue_price(price_kind, currency, issue_id);

CREATE FUNCTION catalog_classify_krause_price_label(value TEXT)
RETURNS TABLE(price_kind TEXT, grade_code TEXT) AS $$
    WITH prepared AS (
        SELECT upper(regexp_replace(btrim(value), '[[:space:]-]+', '', 'g')) label
    ), canonical AS (
        SELECT label,
               CASE
                   WHEN label = 'PROOF' THEN 'PF'
                   WHEN label ~ '^PRF?(6[0-9]|70)$' THEN regexp_replace(label, '^PRF?', 'PF')
                   ELSE label
               END grade
        FROM prepared
    )
    SELECT CASE
               WHEN label = 'MKTVAL' OR label = 'VALUE' THEN 'reference_value'
               WHEN label = 'ISSUEPRICE' THEN 'issue_price'
               WHEN label = 'NETVAL' THEN 'net_value'
               WHEN label = 'BV' THEN 'bullion_value'
               WHEN grade IN ('GOOD', 'VG', 'F', 'VF', 'XF', 'AU', 'UNC', 'BU', 'MS', 'PF')
                 OR grade ~ '^(G4|VG8|F12|VF20|XF40|XF45|AU50)$'
                 OR grade ~ '^MS(6[0-9]|70)(FSB|FB|FBL|RD|RB|BN|PL|DMPL)?$'
                 OR grade ~ '^PF(6[0-9]|70)$'
                   THEN 'grade'
               ELSE 'other'
           END,
           CASE
               WHEN grade IN ('GOOD', 'VG', 'F', 'VF', 'XF', 'AU', 'UNC', 'BU', 'MS', 'PF')
                 OR grade ~ '^(G4|VG8|F12|VF20|XF40|XF45|AU50)$'
                 OR grade ~ '^MS(6[0-9]|70)(FSB|FB|FBL|RD|RB|BN|PL|DMPL)?$'
                 OR grade ~ '^PF(6[0-9]|70)$'
                   THEN grade
               ELSE NULL
           END
    FROM canonical
$$ LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE;

ALTER TABLE collection_item
    ADD COLUMN catalog_issue_id BIGINT REFERENCES catalog_issue(id) ON DELETE SET NULL,
    ADD COLUMN identified_year INTEGER
        CHECK (identified_year IS NULL OR identified_year BETWEEN 1000 AND 2200);

CREATE INDEX collection_item_catalog_issue_idx
    ON collection_item(catalog_issue_id)
    WHERE catalog_issue_id IS NOT NULL AND deleted_at IS NULL;

CREATE FUNCTION collection_item_validate_catalog_issue() RETURNS TRIGGER AS $$
DECLARE
    issue_type_id INTEGER;
    issue_year INTEGER;
BEGIN
    IF NEW.catalog_issue_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT type_id, year INTO issue_type_id, issue_year
    FROM catalog_issue
    WHERE id = NEW.catalog_issue_id;

    IF issue_type_id IS NOT NULL AND NEW.type_id IS DISTINCT FROM issue_type_id THEN
        RAISE EXCEPTION 'catalog issue % belongs to type %, not %',
            NEW.catalog_issue_id, issue_type_id, NEW.type_id
            USING ERRCODE = '23514';
    END IF;

    IF NEW.identified_year IS NULL THEN
        NEW.identified_year := issue_year;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER collection_item_validate_catalog_issue_trigger
    BEFORE INSERT OR UPDATE OF type_id, catalog_issue_id, identified_year
    ON collection_item
    FOR EACH ROW
    EXECUTE FUNCTION collection_item_validate_catalog_issue();

COMMENT ON TABLE catalog_issue IS
    'One dated Krause/SCWC issue or variant; source_data preserves the complete imported row';
COMMENT ON TABLE catalog_issue_price IS
    'Krause price columns classified by meaning; these are not current market valuations';
COMMENT ON COLUMN collection_item.identified_year IS
    'Year recognized for this physical coin, retained even when the catalog issue is ambiguous or absent';
