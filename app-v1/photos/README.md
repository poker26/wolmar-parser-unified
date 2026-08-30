# Collection photo pipeline

User coin photos are stored in the private MinIO bucket `user-coin-photos`.
The HTTP server creates object keys and ten-minute presigned URLs; clients cannot
choose bucket paths. An upload is accepted only after its declared size is
verified. The HTTP request then creates JPEG display and thumbnail derivatives
directly. `sharp` strips metadata by default, including GPS EXIF. HEIC/HEIF input
is decoded with `heic-convert`.

Required runtime configuration:

- `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` and optionally
  `MINIO_PORT`, `MINIO_SECURE`, `COLLECTION_PHOTO_BUCKET`;
- alternatively the existing `/opt/numismatics/.env` file.

Production rollout order:

1. confirm the private bucket exists and is included in off-server backup;
2. apply `202608260002_collection_item_photos.sql`;
3. restart the HTTP server and verify upload intent, processing and private URL;
4. run a restore drill for one test photo before beta.

Rollback switches the HTTP release back. The additive table and private objects
remain intact, so rollback does not delete user data.
