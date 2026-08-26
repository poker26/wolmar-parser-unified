\set ON_ERROR_STOP on

CREATE TABLE coin_type (
    id SERIAL PRIMARY KEY,
    name_full TEXT NOT NULL
);

\i /migration/202608260001_collection_mvp_foundation.sql

INSERT INTO coin_type (name_full) VALUES ('1 рубль 1900 СПБ');

INSERT INTO app_user (id, email_normalized, password_hash, status)
VALUES (
    '00000000-0000-4000-8000-000000000001',
    'owner@example.test',
    repeat('x', 60),
    'active'
);

INSERT INTO user_session (id, user_id, token_hash, csrf_token_hash, expires_at)
VALUES (
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    repeat('a', 64),
    repeat('b', 64),
    now() + interval '1 day'
);

INSERT INTO collection_item (id, user_id, type_id, created_idempotency_key)
VALUES
    (
        '20000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000001',
        1,
        'create-item-0001'
    ),
    (
        '20000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000001',
        1,
        'create-item-0002'
    );

DO $$
DECLARE
    linked_count INTEGER;
BEGIN
    SELECT count(*) INTO linked_count
    FROM collection_item
    WHERE type_id = 1
      AND identification_status = 'linked'
      AND type_name_snapshot = '1 рубль 1900 СПБ';

    IF linked_count <> 2 THEN
        RAISE EXCEPTION 'expected two linked physical specimens, got %', linked_count;
    END IF;

    BEGIN
        INSERT INTO collection_item (id, user_id, user_label, created_idempotency_key)
        VALUES (
            '20000000-0000-4000-8000-000000000003',
            '00000000-0000-4000-8000-000000000001',
            'duplicate idempotency key',
            'create-item-0001'
        );
        RAISE EXCEPTION 'duplicate idempotency key was accepted';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO collection_item (id, user_id)
        VALUES (
            '20000000-0000-4000-8000-000000000004',
            '00000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'empty unlinked item was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
END;
$$;

DELETE FROM coin_type WHERE id = 1;

DO $$
DECLARE
    detached_count INTEGER;
BEGIN
    SELECT count(*) INTO detached_count
    FROM collection_item
    WHERE type_id IS NULL
      AND identification_status = 'unlinked'
      AND type_name_snapshot = '1 рубль 1900 СПБ';

    IF detached_count <> 2 THEN
        RAISE EXCEPTION 'catalog delete did not preserve two specimens, got %', detached_count;
    END IF;
END;
$$;
