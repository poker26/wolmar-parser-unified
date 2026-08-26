# Collection data ownership

Sensitive actions require the current session, CSRF token and the account
password again.

## Export

- `POST /api/v1/collection/exports` creates or returns the user's active job.
- `GET /api/v1/collection/exports/:id` returns status and, when ready, a
  ten-minute private download URL.
- The ZIP contains `manifest.json`, `account.json`, `collection.csv`,
  `valuations.csv` and active original photos.
- CSV text is UTF-8 and spreadsheet formulas are neutralized.
- The archive stays private and is marked expired after 24 hours.

## Account deletion

- `POST /api/v1/account/deletion` verifies the password, starts a Temporal
  workflow, changes the account to `deletion_pending` and revokes all sessions.
- The workflow waits seven days. Before erasing anything, the activity verifies
  that the account is still `deletion_pending`.
- Private photo, derivative and export objects are removed before the
  `app_user` row is deleted. Database ownership rows then cascade.
- `account_deletion_request` retains only a pseudonym and operational status.

## Operations

Apply `202608260004_collection_data_ownership.sql` and run
`temporal/collection-data-worker.js` on queue `wolmar-collection-data`.
