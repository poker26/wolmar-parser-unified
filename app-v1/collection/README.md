# App v1 collection API

Each `collection_item` represents one physical coin specimen. Multiple items
may reference the same `coin_type`; an unlinked draft uses `userLabel` instead.
Every query is scoped by the authenticated `userId`.

Read endpoints:

- `GET /api/v1/collection/items`
- `GET /api/v1/collection/items/:id`
- `GET /api/v1/collection/summary`

Mutating endpoints require the session cookie and matching `X-CSRF-Token`:

- `POST /api/v1/collection/items`
- `PATCH /api/v1/collection/items/:id`
- `DELETE /api/v1/collection/items/:id`
- `POST /api/v1/collection/items/:id/restore`
- `POST /api/v1/collection/items/:id/sold`
- `POST /api/v1/collection/items/:id/archive`
- `POST /api/v1/collection/items/:id/activate`

Create accepts an optional `Idempotency-Key` header (8–200 characters). A
replay returns the original item instead of creating another specimen.

List pagination uses an opaque cursor over `(created_at, id)`. Deleted items
stay recoverable for 30 days and are excluded from ordinary reads and summary.
