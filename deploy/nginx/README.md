# coins.begemot26.ru

`coins.begemot26.ru.conf` is the versioned production vhost. The public surface
without a client certificate is intentionally limited to:

- `/health` (Node.js liveness, no dependency checks);
- `/ready` (Node.js readiness with a bounded PostgreSQL check);
- `/api/v1/*` (application authentication is enforced by the backend);
- `GET /api/coincat/types` (read-only catalog search).

All other site, analytics, photo and administrative routes retain the existing
mTLS guard.

The backend also keeps `/api/health` as a compatibility alias for liveness and
exposes the direct internal probes at `/api/health/live` and
`/api/health/ready`. Health responses do not expose process memory, PID,
dependency addresses or raw errors.

Before reload, keep the backup outside `sites-enabled`, install the candidate,
and run `nginx -t`. A backup left under `sites-enabled` becomes a duplicate
vhost because the directory is included with a wildcard.
