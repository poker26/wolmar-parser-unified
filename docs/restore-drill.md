# Off-site backup and restore drill

## Recovery model

The off-site target is the Raspberry Pi available through the SSH alias
`malinka`. The production timer runs `fleet-backup.service` and writes under
`/mnt/data/backups`.

The Wolmar recovery point consists of:

- `daily/YYYYMMDD/postgres.dump`, a PostgreSQL custom-format archive;
- `daily/YYYYMMDD/minio/user-coin-photos`, a hardlinked snapshot made after the
  corresponding database dump;
- `daily/YYYYMMDD/SHA256SUMS`, covering every file in that daily recovery point;
- `daily/YYYYMMDD/configs/wolmar.env` and the nginx configuration archive.

The live backup script is `/usr/local/bin/fleet-backup.sh`. After the 2026-08-26
drill its SHA-256 is
`1337f1b61cf37914dd7ec3d54d6d421295c17c6d34a1689ab7b05e553f8a95c5`.
The preceding script is retained as
`/usr/local/bin/fleet-backup.sh.pre-daily-photo-snapshot-20260826`.

## Restore procedure

1. Verify the recovery point before using it:

   ```sh
   cd /mnt/data/backups/daily/YYYYMMDD
   sha256sum -c SHA256SUMS
   pg_restore --list postgres.dump >/dev/null
   ```

2. Use the exact PostgreSQL environment reported by production. For the
   verified drill this was `supabase/postgres:15.8.1.085`. A vanilla PostgreSQL
   image is insufficient because the fleet dump contains pgvector, PostGIS and
   Supabase objects.
3. Create a container with no published ports and `--network none`. Mount the
   daily directory read-only, wait until the Supabase init phase has fully
   completed, create a database from `template0`, then restore as the image's
   `supabase_admin` role:

   ```sh
   pg_restore --no-owner --no-privileges --exit-on-error \
     -U supabase_admin -d restore /backup/postgres.dump
   ```

4. Restore a copy of the daily photo snapshot with the exact production MinIO
   version. Put the server and `mc` client on an internal Docker network with no
   published ports.
5. Validate only through PostgreSQL and the S3 API. Do not hash MinIO's internal
   `part.1` directly: its physical bitrot/encryption representation is not the
   application object. Download the original with `mc cat` and compare its
   SHA-256 with `collection_item_photo.sha256`.
6. Check migration count/latest version, RLS, invalid indexes, unvalidated
   constraints and orphaned user/item/photo/valuation relationships.
7. Preserve the aggregate report and error log, then remove only the isolated
   containers and temporary restored data.

## Verified drill: 2026-08-26

The recovery point completed at 16:23:36 MSK. Its manifest was verified twice.
The full PostgreSQL restore completed in 534 seconds with an empty error log.
The daily MinIO snapshot exposed original, display and thumbnail objects; the
original downloaded through S3 matched the database SHA-256.

Aggregate evidence is in
[`evidence/restore-drill-20260826.json`](evidence/restore-drill-20260826.json).
The server-side evidence remains under
`/mnt/data/restore-drills/20260826-1623/` on `malinka`.

The restored photo is ready but soft-deleted, and the recovery point has no
valuation rows. This proves backup integrity, but a separate beta acceptance
case must keep one active photographed and valued item.
