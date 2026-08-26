# Collection MVP beta readiness

Status date: 2026-08-26.

## Completed

- Collection API with ownership isolation, CSRF protection, idempotent create,
  soft delete/restore, archive and sold states.
- Private original/display/thumbnail photo pipeline and Temporal worker.
- Reproducible valuation snapshots that abstain when comparable sales are
  insufficient.
- Export and delayed account deletion workflows.
- Pseudonymous product metrics, persistent rate limits and privacy-minimized
  security audit.
- Separate liveness and PostgreSQL readiness probes deployed through nginx.
- Six ordered, checksummed production migrations; production reports no pending
  migrations.
- APK 0.5.0 installed and manually exercised on the connected phone.
- Off-site PostgreSQL and MinIO recovery point restored on Raspberry Pi with
  zero restore errors; observed PostgreSQL restore time was 534 seconds.
- Daily collection-photo snapshot and verified `SHA256SUMS` added to the live
  off-site backup job. The previous backup script is retained for rollback.

## Required before closed beta

- Build and install a release-signed APK. The accepted 0.5.0 artifact is a debug
  build and is not a production distribution artifact.
- Keep one active collection item with a ready photo and a completed valuation,
  run a fresh backup, and repeat the focused DB/S3 validation. The current drill
  recovered one ready but soft-deleted photo and zero valuation rows.
- Add application-authenticated self-registration and password recovery to API
  v1, including email delivery and the same persistent rate-limit/audit model.
  The current API v1 supports login/logout but not those public onboarding
  flows.
- Configure external alerts for `/health`, `/ready`, backup failure/staleness,
  disk pressure and the three collection Temporal workers. Endpoints and logs
  exist; alert delivery has not been demonstrated.
- Verify the Android release configuration independently: production HTTPS base
  URL, release signing identity, backup policy, network security config and no
  debug logging of user data.

## Required before public beta

- Publish privacy policy, terms, retention periods and a support/contact path.
- Add email verification and an abuse process for registration and recovery.
- Define beta SLOs and alert recipients, then perform one alert-delivery test.
- Run the acceptance suite with at least two independent accounts to confirm
  owner isolation through the real nginx/API path.
- Decide whether public catalog pages need a separate unauthenticated web
  surface; the legacy site remains intentionally protected by mTLS while mobile
  API v1 is public and session-authenticated.
