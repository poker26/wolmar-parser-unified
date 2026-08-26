# Product analytics

Internal MVP events are stored in `product_event`. The writer accepts only the
event-specific properties declared in `service.js` and hashes the random account
UUID before persistence. It never accepts email, coin type, item or photo IDs,
prices, notes, search text, or URLs.

Source UUIDs may be supplied only for idempotency. They are hashed into a
purpose-specific deduplication key and are not stored directly. Events are
assigned a 400-day expiry and expired rows are removed opportunistically by
writers at most once per process per day. The table has RLS enabled and no
public API policy.
