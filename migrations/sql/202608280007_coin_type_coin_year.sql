ALTER TABLE coin_type
    ADD COLUMN IF NOT EXISTS coin_year INTEGER;

COMMENT ON COLUMN coin_type.year IS
    'Catalog issue year; for CBR rows this is the year of the official issue date';
COMMENT ON COLUMN coin_type.issue_date IS
    'Exact official issue date when the catalog source provides one';
COMMENT ON COLUMN coin_type.coin_year IS
    'Year inscribed on the coin when it differs from the catalog issue year';

CREATE INDEX IF NOT EXISTS coin_type_coin_year_idx
    ON coin_type(coin_year)
    WHERE coin_year IS NOT NULL;
