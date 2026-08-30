ALTER TABLE lot_type_link_repair_log
    DROP CONSTRAINT lot_type_link_repair_log_repair_reason_check;

ALTER TABLE lot_type_link_repair_log
    ADD CONSTRAINT lot_type_link_repair_log_repair_reason_check
    CHECK (repair_reason IN (
        'denomination_exact',
        'year_exact',
        'mint_exact',
        'manual_verified',
        'bitkin_exact_reference',
        'km_exact_reference'
    ));
