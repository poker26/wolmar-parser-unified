# coins.begemot26.ru

`coins.begemot26.ru.conf` is the versioned production vhost. The public surface
without a client certificate is intentionally limited to:

- `/health`;
- `/api/v1/*` (application authentication is enforced by the backend);
- `GET /api/coincat/types` (read-only catalog search).

All other site, analytics, photo and administrative routes retain the existing
mTLS guard.

Before reload, keep the backup outside `sites-enabled`, install the candidate,
and run `nginx -t`. A backup left under `sites-enabled` becomes a duplicate
vhost because the directory is included with a wildcard.
