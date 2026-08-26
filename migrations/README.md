# Database migrations

Versioned SQL migrations live in `migrations/sql` and are immutable after they
have been applied. The runner records each filename and SHA-256 checksum in
`schema_migrations`.

```bash
# Show unapplied migrations without changing the database
npm run migrate:status

# Apply pending migrations in one transaction
npm run migrate
```

The runner takes a PostgreSQL transaction-level advisory lock, sets a five
second lock timeout, and rolls back the complete batch on an error. A checksum
mismatch is a hard failure: add a new migration instead of editing an applied
file.

Before applying migrations in production:

1. Confirm that the off-server database backup completed successfully.
2. Run `npm run migrate:status` against the intended database.
3. Apply during a controlled release; do not run migrations from application
   startup.
4. Record the output and verify the new rows in `schema_migrations`.

The collection MVP foundation migration is additive. It does not modify the
legacy `collection_users` or `user_collections` tables.
