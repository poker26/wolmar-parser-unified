package ru.begemot26.numismat.data

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.serialization.encodeToString
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.Closeable
import java.util.UUID

/** Local source of truth for a collection. Network synchronization is deliberately explicit. */
class LocalCollectionStore(
    context: Context,
    private val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    },
) : SQLiteOpenHelper(context.applicationContext, DATABASE_NAME, null, DATABASE_VERSION), Closeable {

    init {
        setWriteAheadLoggingEnabled(true)
    }

    override fun onConfigure(db: SQLiteDatabase) {
        super.onConfigure(db)
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE collection_item_local (
                account_id TEXT NOT NULL,
                local_id TEXT NOT NULL,
                remote_id TEXT,
                item_json TEXT NOT NULL,
                create_request_json TEXT,
                dirty_state TEXT NOT NULL CHECK (dirty_state IN ('clean','create','update','delete')),
                staging_session_id TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                synced_at_ms INTEGER,
                server_updated_at TEXT,
                server_version INTEGER,
                local_revision INTEGER NOT NULL DEFAULT 1,
                sync_revision INTEGER,
                conflict_kind TEXT,
                conflict_json TEXT,
                remote_deleted INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (account_id, local_id),
                UNIQUE (account_id, remote_id)
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE collection_photo_local (
                account_id TEXT NOT NULL,
                local_id TEXT NOT NULL,
                item_local_id TEXT NOT NULL,
                remote_id TEXT,
                side TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                mime_type TEXT NOT NULL,
                sha256 TEXT NOT NULL,
                byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
                original_path TEXT NOT NULL,
                display_path TEXT NOT NULL,
                thumb_path TEXT NOT NULL,
                dirty_state TEXT NOT NULL CHECK (dirty_state IN ('clean','create','update','delete')),
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                synced_at_ms INTEGER,
                item_version INTEGER,
                local_revision INTEGER NOT NULL DEFAULT 1,
                sync_revision INTEGER,
                conflict_kind TEXT,
                conflict_json TEXT,
                remote_deleted INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (account_id, local_id),
                UNIQUE (account_id, remote_id),
                FOREIGN KEY (account_id, item_local_id)
                    REFERENCES collection_item_local(account_id, local_id) ON DELETE CASCADE
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE collection_sync_metadata (
                account_id TEXT NOT NULL PRIMARY KEY,
                remote_cursor TEXT,
                last_sync_at_ms INTEGER,
                last_error TEXT,
                updated_at_ms INTEGER NOT NULL
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE collection_remote_photo_pending (
                account_id TEXT NOT NULL,
                remote_id TEXT NOT NULL,
                item_remote_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                photo_json TEXT NOT NULL,
                changed_at TEXT NOT NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                updated_at_ms INTEGER NOT NULL,
                PRIMARY KEY (account_id, remote_id)
            )
            """.trimIndent(),
        )
        db.execSQL(
            "CREATE INDEX collection_item_local_updated_idx " +
                "ON collection_item_local(account_id, dirty_state, updated_at_ms)",
        )
        db.execSQL(
            "CREATE INDEX collection_photo_local_item_idx " +
                "ON collection_photo_local(account_id, item_local_id, sort_order, created_at_ms)",
        )
        db.execSQL(
            "CREATE INDEX collection_photo_local_dirty_idx " +
                "ON collection_photo_local(account_id, dirty_state, updated_at_ms)",
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        var version = oldVersion
        if (version == 1) {
            db.execSQL("ALTER TABLE collection_item_local ADD COLUMN create_request_json TEXT")
            version = 2
        }
        if (version == 2) {
            db.execSQL("ALTER TABLE collection_item_local ADD COLUMN server_version INTEGER")
            db.execSQL("ALTER TABLE collection_item_local ADD COLUMN local_revision INTEGER NOT NULL DEFAULT 1")
            db.execSQL("ALTER TABLE collection_item_local ADD COLUMN sync_revision INTEGER")
            db.execSQL("ALTER TABLE collection_item_local ADD COLUMN conflict_kind TEXT")
            db.execSQL("ALTER TABLE collection_item_local ADD COLUMN conflict_json TEXT")
            db.execSQL("ALTER TABLE collection_item_local ADD COLUMN remote_deleted INTEGER NOT NULL DEFAULT 0")
            db.execSQL("ALTER TABLE collection_photo_local ADD COLUMN item_version INTEGER")
            db.execSQL("ALTER TABLE collection_photo_local ADD COLUMN local_revision INTEGER NOT NULL DEFAULT 1")
            db.execSQL("ALTER TABLE collection_photo_local ADD COLUMN sync_revision INTEGER")
            db.execSQL("ALTER TABLE collection_photo_local ADD COLUMN conflict_kind TEXT")
            db.execSQL("ALTER TABLE collection_photo_local ADD COLUMN conflict_json TEXT")
            db.execSQL("ALTER TABLE collection_photo_local ADD COLUMN remote_deleted INTEGER NOT NULL DEFAULT 0")
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS collection_sync_metadata (
                    account_id TEXT NOT NULL PRIMARY KEY,
                    remote_cursor TEXT,
                    last_sync_at_ms INTEGER,
                    last_error TEXT,
                    updated_at_ms INTEGER NOT NULL
                )
                """.trimIndent(),
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS collection_item_local_updated_idx " +
                    "ON collection_item_local(account_id, dirty_state, updated_at_ms)",
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS collection_photo_local_item_idx " +
                    "ON collection_photo_local(account_id, item_local_id, sort_order, created_at_ms)",
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS collection_photo_local_dirty_idx " +
                    "ON collection_photo_local(account_id, dirty_state, updated_at_ms)",
            )
            version = 3
        }
        if (version == 3) {
            db.execSQL(
                """
                CREATE TABLE collection_remote_photo_pending (
                    account_id TEXT NOT NULL,
                    remote_id TEXT NOT NULL,
                    item_remote_id TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    photo_json TEXT NOT NULL,
                    changed_at TEXT NOT NULL,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT,
                    updated_at_ms INTEGER NOT NULL,
                    PRIMARY KEY (account_id, remote_id)
                )
                """.trimIndent(),
            )
            version = 4
        }
        check(version == newVersion) {
            "Missing LocalCollectionStore migration from $version to $newVersion"
        }
    }

    /** Atomically makes an identified coin and all of its local image variants visible. */
    fun saveIdentifiedCoin(
        accountId: String,
        item: CollectionItem,
        photos: List<LocalPhotoDraft>,
        stagingSessionId: String? = null,
        createRequest: CreateItemRequest? = null,
        nowMs: Long = System.currentTimeMillis(),
    ): LocalCollectionRecord {
        requireAccount(accountId)
        require(photos.map { it.localId }.distinct().size == photos.size) {
            "Photo local ids must be unique"
        }
        photos.forEach(::validatePhotoDraft)
        val localId = item.id
        require(localId.isNotBlank()) { "Local item id is required" }
        writableDatabase.inTransaction {
            insertOrThrow(
                ITEM_TABLE,
                null,
                itemValues(
                    accountId = accountId,
                    localId = localId,
                    remoteId = null,
                    item = item,
                    createRequest = createRequest,
                    dirtyState = DirtyState.CREATE,
                    stagingSessionId = stagingSessionId,
                    createdAtMs = nowMs,
                    updatedAtMs = nowMs,
                    syncedAtMs = null,
                    serverUpdatedAt = null,
                ),
            )
            photos.forEach { photo ->
                insertOrThrow(
                    PHOTO_TABLE,
                    null,
                    photoValues(
                        accountId = accountId,
                        itemLocalId = localId,
                        photo = photo,
                        dirtyState = DirtyState.CREATE,
                        createdAtMs = nowMs,
                        syncedAtMs = null,
                    ),
                )
            }
        }
        return requireNotNull(get(accountId, localId))
    }

    fun list(accountId: String, includeDeleted: Boolean = false): List<LocalCollectionRecord> {
        requireAccount(accountId)
        val selection = if (includeDeleted) {
            "account_id = ?"
        } else {
            "account_id = ? AND dirty_state != 'delete' AND remote_deleted = 0"
        }
        return readableDatabase.query(
            ITEM_TABLE,
            ITEM_COLUMNS,
            selection,
            arrayOf(accountId),
            null,
            null,
            "created_at_ms DESC, local_id DESC",
        ).use { cursor -> buildList { while (cursor.moveToNext()) add(cursor.toItem()) } }
    }

    fun get(accountId: String, localId: String): LocalCollectionRecord? {
        requireAccount(accountId)
        require(localId.isNotBlank())
        return readableDatabase.query(
            ITEM_TABLE,
            ITEM_COLUMNS,
            "account_id = ? AND local_id = ?",
            arrayOf(accountId, localId),
            null,
            null,
            null,
            "1",
        ).use { cursor -> if (cursor.moveToFirst()) cursor.toItem() else null }
    }

    fun getByRemoteId(accountId: String, remoteId: String): LocalCollectionRecord? {
        requireAccount(accountId)
        require(remoteId.isNotBlank())
        return readableDatabase.query(
            ITEM_TABLE,
            ITEM_COLUMNS,
            "account_id = ? AND remote_id = ?",
            arrayOf(accountId, remoteId),
            null,
            null,
            null,
            "1",
        ).use { cursor -> if (cursor.moveToFirst()) cursor.toItem() else null }
    }

    /** Preserves CREATE while editing a not-yet-uploaded item; deleted items cannot be edited. */
    fun updateLocal(
        accountId: String,
        localId: String,
        item: CollectionItem,
        stagingSessionId: String? = null,
        nowMs: Long = System.currentTimeMillis(),
    ): LocalCollectionRecord {
        val current = requireNotNull(get(accountId, localId)) { "Local item does not exist" }
        check(current.dirtyState != DirtyState.DELETE) { "Deleted item cannot be edited" }
        require(item.id == localId) { "The local item id cannot be changed" }
        val nextDirty = if (current.dirtyState == DirtyState.CREATE) DirtyState.CREATE else DirtyState.UPDATE
        val values = ContentValues().apply {
            put("item_json", json.encodeToString(item))
            put("dirty_state", nextDirty.dbValue)
            put("updated_at_ms", nowMs)
            put("local_revision", current.localRevision + 1)
            if (stagingSessionId != null) put("staging_session_id", stagingSessionId)
        }
        checkedUpdate(ITEM_TABLE, values, accountId, localId)
        return requireNotNull(get(accountId, localId))
    }

    /** Stops using staged server photos after the user changes the local photo set. */
    fun detachStagingSession(accountId: String, localId: String): String? {
        val current = requireNotNull(get(accountId, localId)) { "Local item does not exist" }
        val sessionId = current.stagingSessionId ?: return null
        val values = ContentValues().apply {
            putNull("staging_session_id")
            put("updated_at_ms", System.currentTimeMillis())
            put("local_revision", current.localRevision + 1)
        }
        checkedUpdate(ITEM_TABLE, values, accountId, localId)
        return sessionId
    }

    /**
     * Applies a server snapshot only when the local row is clean. This is the conflict-safety
     * boundary: a pull can never silently overwrite a pending local change.
     */
    fun upsertRemote(
        accountId: String,
        remoteItem: CollectionItem,
        clientMutationId: String? = null,
        serverUpdatedAt: String? = remoteItem.updatedAt,
        nowMs: Long = System.currentTimeMillis(),
    ): RemoteUpsertResult {
        requireAccount(accountId)
        require(remoteItem.id.isNotBlank())
        var result: RemoteUpsertResult? = null
        writableDatabase.inTransaction {
            val byRemoteId = queryItemByRemoteId(this, accountId, remoteItem.id)
            val correlatedCreate = if (byRemoteId == null && !clientMutationId.isNullOrBlank()) {
                queryItem(this, accountId, clientMutationId)?.takeIf {
                    it.remoteId == null && it.dirtyState != DirtyState.CLEAN
                }
            } else null
            val existing = byRemoteId ?: correlatedCreate
            if (correlatedCreate != null) {
                val completedAttempt = correlatedCreate.syncRevision == correlatedCreate.localRevision &&
                    sameUserItemFields(correlatedCreate.item, remoteItem)
                val nextDirty = when {
                    completedAttempt -> DirtyState.CLEAN
                    correlatedCreate.dirtyState == DirtyState.DELETE -> DirtyState.DELETE
                    else -> DirtyState.UPDATE
                }
                val values = ContentValues().apply {
                    put("remote_id", remoteItem.id)
                    if (completedAttempt) {
                        put("item_json", json.encodeToString(remoteItem.copy(id = correlatedCreate.localId)))
                    }
                    put("dirty_state", nextDirty.dbValue)
                    put("updated_at_ms", nowMs)
                    put("synced_at_ms", nowMs)
                    put("server_updated_at", serverUpdatedAt)
                    put("server_version", remoteItem.version)
                    putNull("sync_revision")
                    putNull("conflict_kind")
                    putNull("conflict_json")
                    put("remote_deleted", 0)
                    putNull("staging_session_id")
                }
                checkedUpdate(this, ITEM_TABLE, values, accountId, correlatedCreate.localId)
                result = RemoteUpsertResult(
                    requireNotNull(queryItem(this, accountId, correlatedCreate.localId)),
                    applied = true,
                )
                return@inTransaction
            }
            if (existing != null && existing.dirtyState != DirtyState.CLEAN) {
                val completedAttempt = existing.syncRevision == existing.localRevision &&
                    sameUserItemFields(existing.item, remoteItem)
                if (completedAttempt) {
                    val values = itemValues(
                        accountId, existing.localId, remoteItem.id, remoteItem.copy(id = existing.localId),
                        null, DirtyState.CLEAN, existing.stagingSessionId, existing.createdAtMs,
                        nowMs, nowMs, serverUpdatedAt, remoteItem.version, existing.localRevision,
                    )
                    checkedUpdate(this, ITEM_TABLE, values, accountId, existing.localId)
                    result = RemoteUpsertResult(requireNotNull(queryItem(this, accountId, existing.localId)), true)
                    return@inTransaction
                }
                if ((existing.serverVersion ?: 0) < remoteItem.version) {
                    val values = ContentValues().apply {
                        put("conflict_kind", ConflictState.VERSION.dbValue)
                        put("conflict_json", json.encodeToString(remoteItem))
                        put("server_version", remoteItem.version)
                        putNullable("server_updated_at", serverUpdatedAt)
                    }
                    checkedUpdate(this, ITEM_TABLE, values, accountId, existing.localId)
                }
                result = RemoteUpsertResult(requireNotNull(queryItem(this, accountId, existing.localId)), applied = false)
                return@inTransaction
            }
            val localId = existing?.localId ?: remoteItem.id
            val createdAt = existing?.createdAtMs ?: nowMs
            val values = itemValues(
                accountId,
                localId,
                remoteItem.id,
                remoteItem.copy(id = localId),
                null,
                DirtyState.CLEAN,
                existing?.stagingSessionId,
                createdAt,
                nowMs,
                nowMs,
                serverUpdatedAt,
                remoteItem.version,
                existing?.localRevision ?: 0,
            )
            if (existing == null) {
                insertOrThrow(ITEM_TABLE, null, values)
            } else {
                checkedUpdate(this, ITEM_TABLE, values, accountId, localId)
            }
            result = RemoteUpsertResult(requireNotNull(queryItem(this, accountId, localId)), applied = true)
        }
        return requireNotNull(result)
    }

    /** Marks a local item for deletion, or removes a never-uploaded item immediately. */
    fun deleteLocal(
        accountId: String,
        localId: String,
        nowMs: Long = System.currentTimeMillis(),
    ): LocalDeleteResult {
        val current = requireNotNull(get(accountId, localId)) { "Local item does not exist" }
        val paths = photos(accountId, localId).flatMap(LocalPhotoRecord::allPaths).distinct()
        if (current.remoteId == null && current.dirtyState == DirtyState.CREATE && current.syncRevision == null) {
            checkedDelete(ITEM_TABLE, accountId, localId)
            return LocalDeleteResult(needsRemoteDelete = false, filePaths = paths)
        }
        val values = ContentValues().apply {
            put("dirty_state", DirtyState.DELETE.dbValue)
            put("updated_at_ms", nowMs)
            put("local_revision", current.localRevision + 1)
        }
        checkedUpdate(ITEM_TABLE, values, accountId, localId)
        return LocalDeleteResult(needsRemoteDelete = true, filePaths = paths)
    }

    fun addPhotoLocal(
        accountId: String,
        itemLocalId: String,
        photo: LocalPhotoDraft,
        nowMs: Long = System.currentTimeMillis(),
    ): LocalPhotoRecord {
        validatePhotoDraft(photo)
        val item = requireNotNull(get(accountId, itemLocalId)) { "Local item does not exist" }
        check(item.dirtyState != DirtyState.DELETE) { "Cannot add a photo to a deleted item" }
        writableDatabase.insertOrThrow(
            PHOTO_TABLE,
            null,
            photoValues(
                accountId = accountId,
                itemLocalId = itemLocalId,
                photo = photo,
                dirtyState = DirtyState.CREATE,
                createdAtMs = nowMs,
                syncedAtMs = null,
            ),
        )
        return requireNotNull(this.photo(accountId, photo.localId))
    }

    fun deletePhotoLocal(
        accountId: String,
        photoLocalId: String,
        nowMs: Long = System.currentTimeMillis(),
    ): LocalDeleteResult {
        val current = requireNotNull(this.photo(accountId, photoLocalId)) { "Local photo does not exist" }
        val paths = current.allPaths()
        if (current.remoteId == null && current.dirtyState == DirtyState.CREATE && current.syncRevision == null) {
            checkedDelete(PHOTO_TABLE, accountId, photoLocalId)
            return LocalDeleteResult(needsRemoteDelete = false, filePaths = paths)
        }
        val values = ContentValues().apply {
            put("dirty_state", DirtyState.DELETE.dbValue)
            put("updated_at_ms", nowMs)
            put("local_revision", current.localRevision + 1)
        }
        checkedUpdate(PHOTO_TABLE, values, accountId, photoLocalId)
        return LocalDeleteResult(needsRemoteDelete = true, filePaths = paths)
    }

    fun updatePhotoLocal(
        accountId: String,
        photoLocalId: String,
        photo: LocalPhotoDraft,
        nowMs: Long = System.currentTimeMillis(),
    ): LocalPhotoRecord {
        validatePhotoDraft(photo)
        require(photo.localId == photoLocalId) { "A photo local id cannot be changed" }
        val current = requireNotNull(this.photo(accountId, photoLocalId)) { "Local photo does not exist" }
        check(current.dirtyState != DirtyState.DELETE) { "Deleted photo cannot be edited" }
        val nextDirty = if (current.dirtyState == DirtyState.CREATE) DirtyState.CREATE else DirtyState.UPDATE
        val values = ContentValues().apply {
            put("side", photo.side)
            put("sort_order", photo.sortOrder)
            put("mime_type", photo.mimeType)
            put("sha256", photo.sha256.lowercase())
            put("byte_size", photo.byteSize)
            put("original_path", photo.originalPath)
            put("display_path", photo.displayPath)
            put("thumb_path", photo.thumbPath)
            put("dirty_state", nextDirty.dbValue)
            put("updated_at_ms", nowMs)
            put("local_revision", current.localRevision + 1)
        }
        checkedUpdate(PHOTO_TABLE, values, accountId, photoLocalId)
        return requireNotNull(this.photo(accountId, photoLocalId))
    }

    /** Mirrors [upsertRemote] for an already-downloaded server photo. */
    fun upsertRemotePhoto(
        accountId: String,
        itemLocalId: String,
        remotePhoto: LocalPhotoDraft,
        nowMs: Long = System.currentTimeMillis(),
    ): RemotePhotoUpsertResult {
        requireAccount(accountId)
        validatePhotoDraft(remotePhoto)
        val remoteId = requireNotNull(remotePhoto.remoteId?.takeIf(String::isNotBlank)) {
            "remotePhoto.remoteId is required"
        }
        var result: RemotePhotoUpsertResult? = null
        writableDatabase.inTransaction {
            requireNotNull(queryItem(this, accountId, itemLocalId)) { "Local item does not exist" }
            val existing = queryPhotoByRemoteId(this, accountId, remoteId)
            if (existing != null && existing.dirtyState != DirtyState.CLEAN) {
                result = RemotePhotoUpsertResult(existing, applied = false)
                return@inTransaction
            }
            check(existing == null || existing.itemLocalId == itemLocalId) {
                "Remote photo is already attached to a different local item"
            }
            val localId = existing?.localId ?: remotePhoto.localId
            val normalized = remotePhoto.copy(localId = localId, remoteId = remoteId)
            val values = photoValues(
                accountId = accountId,
                itemLocalId = itemLocalId,
                photo = normalized,
                dirtyState = DirtyState.CLEAN,
                createdAtMs = existing?.createdAtMs ?: nowMs,
                updatedAtMs = nowMs,
                syncedAtMs = nowMs,
            )
            if (existing == null) {
                insertOrThrow(PHOTO_TABLE, null, values)
            } else {
                checkedUpdate(this, PHOTO_TABLE, values, accountId, localId)
            }
            result = RemotePhotoUpsertResult(
                requireNotNull(queryPhoto(this, accountId, localId)),
                applied = true,
            )
        }
        return requireNotNull(result)
    }

    /** Applies one downloaded photo event without replacing a pending local edit. */
    fun reconcileRemotePhoto(
        accountId: String,
        itemLocalId: String,
        remotePhoto: CollectionPhoto,
        downloaded: LocalPhotoDraft,
        nowMs: Long = System.currentTimeMillis(),
    ): RemotePhotoUpsertResult {
        val remoteId = remotePhoto.id
        val itemVersion = requireNotNull(remotePhoto.itemVersion) { "Photo itemVersion is required" }
        var result: RemotePhotoUpsertResult? = null
        writableDatabase.inTransaction {
            val parent = requireNotNull(queryItem(this, accountId, itemLocalId)) { "Local item does not exist" }
            val byRemote = queryPhotoByRemoteId(this, accountId, remoteId)
            val bySlot = if (byRemote == null) {
                query(
                    PHOTO_TABLE, PHOTO_COLUMNS,
                    "account_id = ? AND item_local_id = ? AND side = ? AND sort_order = ? AND remote_id IS NULL",
                    arrayOf(accountId, itemLocalId, remotePhoto.side, remotePhoto.sortOrder.toString()),
                    null, null, "created_at_ms, local_id", "1",
                ).use { cursor -> if (cursor.moveToFirst()) cursor.toPhoto() else null }
            } else null
            val existing = byRemote ?: bySlot
            val sameLocalContent = existing != null &&
                existing.sha256.equals(requireNotNull(remotePhoto.sha256), ignoreCase = true) &&
                existing.byteSize == remotePhoto.byteSize &&
                existing.side == remotePhoto.side &&
                existing.sortOrder == remotePhoto.sortOrder
            val pendingAttemptMatches = existing?.syncRevision != null &&
                existing.syncRevision == existing.localRevision
            val pendingAttemptWasDeleted = existing?.dirtyState == DirtyState.DELETE &&
                existing.syncRevision != null && sameLocalContent
            if (existing != null && existing.dirtyState != DirtyState.CLEAN &&
                (!sameLocalContent || (!pendingAttemptMatches && !pendingAttemptWasDeleted))
            ) {
                val conflict = RemotePhotoConflict(remotePhoto, downloaded)
                val values = ContentValues().apply {
                    put("conflict_kind", ConflictState.VERSION.dbValue)
                    put("conflict_json", json.encodeToString(conflict))
                }
                checkedUpdate(this, PHOTO_TABLE, values, accountId, existing.localId)
                updateItemServerVersion(this, accountId, itemLocalId, itemVersion)
                result = RemotePhotoUpsertResult(requireNotNull(queryPhoto(this, accountId, existing.localId)), false)
                return@inTransaction
            }
            val localId = existing?.localId ?: downloaded.localId
            val source = if (sameLocalContent) {
                downloaded.copy(
                    localId = localId,
                    remoteId = remoteId,
                    originalPath = existing!!.originalPath,
                    displayPath = existing.displayPath,
                    thumbPath = existing.thumbPath,
                )
            } else {
                downloaded.copy(localId = localId, remoteId = remoteId)
            }
            val values = photoValues(
                accountId, itemLocalId, source, DirtyState.CLEAN,
                existing?.createdAtMs ?: nowMs, nowMs, nowMs,
                itemVersion = itemVersion,
                localRevision = existing?.localRevision ?: 0,
            )
            if (pendingAttemptWasDeleted) {
                values.put("dirty_state", DirtyState.DELETE.dbValue)
                values.put("local_revision", existing!!.localRevision)
            }
            if (existing == null) insertOrThrow(PHOTO_TABLE, null, values)
            else checkedUpdate(this, PHOTO_TABLE, values, accountId, localId)
            updateItemServerVersion(this, accountId, parent.localId, itemVersion)
            result = RemotePhotoUpsertResult(requireNotNull(queryPhoto(this, accountId, localId)), true)
        }
        return requireNotNull(result)
    }

    fun applyRemoteItemDelete(accountId: String, remoteId: String, changedAt: String): List<String> {
        var removedPaths = emptyList<String>()
        writableDatabase.inTransaction {
            val existing = queryItemByRemoteId(this, accountId, remoteId) ?: return@inTransaction
            if (existing.dirtyState == DirtyState.CLEAN || existing.dirtyState == DirtyState.DELETE) {
                removedPaths = photos(accountId, existing.localId, includeDeleted = true)
                    .flatMap(LocalPhotoRecord::allPaths)
                    .distinct()
                delete(ITEM_TABLE, "account_id = ? AND local_id = ?", arrayOf(accountId, existing.localId))
            } else {
                val values = ContentValues().apply {
                    put("conflict_kind", ConflictState.REMOTE_DELETE.dbValue)
                    put("conflict_json", changedAt)
                }
                checkedUpdate(this, ITEM_TABLE, values, accountId, existing.localId)
            }
        }
        return removedPaths
    }

    fun applyRemotePhotoDelete(accountId: String, remoteId: String, changedAt: String): List<String> {
        var removedPaths = emptyList<String>()
        writableDatabase.inTransaction {
            val existing = queryPhotoByRemoteId(this, accountId, remoteId) ?: return@inTransaction
            if (existing.dirtyState == DirtyState.CLEAN || existing.dirtyState == DirtyState.DELETE) {
                removedPaths = existing.allPaths()
                delete(PHOTO_TABLE, "account_id = ? AND local_id = ?", arrayOf(accountId, existing.localId))
            } else {
                val values = ContentValues().apply {
                    if (existing.dirtyState == DirtyState.UPDATE) {
                        putNull("remote_id")
                        put("dirty_state", DirtyState.CREATE.dbValue)
                        put("remote_deleted", 0)
                        putNull("conflict_kind")
                        putNull("conflict_json")
                    } else {
                        put("conflict_kind", ConflictState.REMOTE_DELETE.dbValue)
                        put("conflict_json", changedAt)
                    }
                }
                checkedUpdate(this, PHOTO_TABLE, values, accountId, existing.localId)
            }
        }
        return removedPaths
    }

    fun applyRemoteValuation(accountId: String, remoteItemId: String, valuation: CollectionValuation) {
        writableDatabase.inTransaction {
            val existing = queryItemByRemoteId(this, accountId, remoteItemId) ?: return@inTransaction
            val values = ContentValues().apply {
                put("item_json", json.encodeToString(existing.item.copy(valuation = valuation)))
            }
            checkedUpdate(this, ITEM_TABLE, values, accountId, existing.localId)
        }
    }

    fun markItemConflict(accountId: String, localId: String, currentItem: CollectionItem?, currentVersion: Long?) {
        val values = ContentValues().apply {
            put("conflict_kind", ConflictState.VERSION.dbValue)
            putNullable("conflict_json", currentItem?.let(json::encodeToString))
            putNullable("server_version", currentVersion)
        }
        checkedUpdate(ITEM_TABLE, values, accountId, localId)
    }

    fun markPhotoConflict(accountId: String, photoLocalId: String, currentVersion: Long?) {
        val current = requireNotNull(photo(accountId, photoLocalId))
        val values = ContentValues().apply { put("conflict_kind", ConflictState.VERSION.dbValue) }
        checkedUpdate(PHOTO_TABLE, values, accountId, photoLocalId)
        if (currentVersion != null) updateItemServerVersion(accountId, current.itemLocalId, currentVersion)
    }

    fun conflictCount(accountId: String): Int {
        val itemCount = readableDatabase.rawQuery(
            "SELECT count(*) FROM $ITEM_TABLE WHERE account_id = ? AND conflict_kind IS NOT NULL",
            arrayOf(accountId),
        ).use { cursor -> cursor.moveToFirst(); cursor.getInt(0) }
        val photoCount = readableDatabase.rawQuery(
            "SELECT count(*) FROM $PHOTO_TABLE WHERE account_id = ? AND conflict_kind IS NOT NULL",
            arrayOf(accountId),
        ).use { cursor -> cursor.moveToFirst(); cursor.getInt(0) }
        return itemCount + photoCount
    }

    fun nextConflict(accountId: String): LocalSyncConflict? {
        requireAccount(accountId)
        readableDatabase.query(
            ITEM_TABLE,
            ITEM_COLUMNS,
            "account_id = ? AND conflict_kind IS NOT NULL",
            arrayOf(accountId),
            null,
            null,
            "updated_at_ms, local_id",
            "1",
        ).use { cursor ->
            if (cursor.moveToFirst()) {
                val item = cursor.toItem()
                return LocalSyncConflict(
                    entity = PendingEntity.ITEM,
                    localId = item.localId,
                    itemLocalId = item.localId,
                    itemTitle = item.item.title,
                    conflictState = item.conflictState,
                    remoteId = item.remoteId,
                    itemRemoteId = item.remoteId,
                    conflictJson = item.conflictJson,
                )
            }
        }
        readableDatabase.query(
            PHOTO_TABLE,
            PHOTO_COLUMNS,
            "account_id = ? AND conflict_kind IS NOT NULL",
            arrayOf(accountId),
            null,
            null,
            "updated_at_ms, local_id",
            "1",
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            val photo = cursor.toPhoto()
            val item = requireNotNull(get(accountId, photo.itemLocalId))
            return LocalSyncConflict(
                entity = PendingEntity.PHOTO,
                localId = photo.localId,
                itemLocalId = photo.itemLocalId,
                itemTitle = item.item.title,
                conflictState = photo.conflictState,
                remoteId = photo.remoteId,
                itemRemoteId = item.remoteId,
                conflictJson = photo.conflictJson,
                side = photo.side,
                sortOrder = photo.sortOrder,
            )
        }
    }

    /** Keeps the local edit and prepares it for a new conditional synchronization attempt. */
    fun keepLocalConflict(accountId: String, conflict: LocalSyncConflict): List<String> {
        requireAccount(accountId)
        val removablePaths = mutableListOf<String>()
        writableDatabase.inTransaction {
            when (conflict.entity) {
                PendingEntity.ITEM -> {
                    val current = requireNotNull(queryItem(this, accountId, conflict.localId))
                    if (current.conflictState == ConflictState.REMOTE_DELETE) {
                        val itemPhotos = photos(accountId, current.localId, includeDeleted = true)
                        itemPhotos.filter { it.dirtyState == DirtyState.DELETE }.forEach { photo ->
                            removablePaths += photo.allPaths()
                            delete(PHOTO_TABLE, "account_id = ? AND local_id = ?", arrayOf(accountId, photo.localId))
                        }
                        itemPhotos.filter { it.dirtyState != DirtyState.DELETE }.forEach { photo ->
                            val photoValues = ContentValues().apply {
                                putNull("remote_id")
                                put("dirty_state", DirtyState.CREATE.dbValue)
                                putNull("item_version")
                                put("local_revision", photo.localRevision + 1)
                                putNull("sync_revision")
                                putNull("conflict_kind")
                                putNull("conflict_json")
                                put("remote_deleted", 0)
                            }
                            checkedUpdate(this, PHOTO_TABLE, photoValues, accountId, photo.localId)
                        }
                    }
                    val values = ContentValues().apply {
                        if (current.conflictState == ConflictState.REMOTE_DELETE) {
                            putNull("remote_id")
                            put("dirty_state", DirtyState.CREATE.dbValue)
                            putNull("server_version")
                        }
                        put("local_revision", current.localRevision + 1)
                        putNull("sync_revision")
                        putNull("conflict_kind")
                        putNull("conflict_json")
                        put("remote_deleted", 0)
                    }
                    checkedUpdate(this, ITEM_TABLE, values, accountId, current.localId)
                }
                PendingEntity.PHOTO -> {
                    val current = requireNotNull(queryPhoto(this, accountId, conflict.localId))
                    conflict.conflictJson?.let { encoded ->
                        runCatching { json.decodeFromString<RemotePhotoConflict>(encoded) }.getOrNull()
                            ?.downloaded?.allPaths()
                            ?.filterNot { it in current.allPaths() }
                            ?.let(removablePaths::addAll)
                    }
                    val values = ContentValues().apply {
                        if (current.conflictState == ConflictState.REMOTE_DELETE) {
                            putNull("remote_id")
                            put("dirty_state", DirtyState.CREATE.dbValue)
                        }
                        put("local_revision", current.localRevision + 1)
                        putNull("sync_revision")
                        putNull("conflict_kind")
                        putNull("conflict_json")
                        put("remote_deleted", 0)
                    }
                    checkedUpdate(this, PHOTO_TABLE, values, accountId, current.localId)
                }
            }
        }
        return removablePaths.distinct()
    }

    /** Replaces one local conflict with the version already downloaded from the server. */
    fun useServerConflict(
        accountId: String,
        conflict: LocalSyncConflict,
        remotePhoto: CollectionPhoto? = null,
        downloadedPhoto: LocalPhotoDraft? = null,
    ): List<String> {
        requireAccount(accountId)
        val removablePaths = mutableListOf<String>()
        writableDatabase.inTransaction {
            when (conflict.entity) {
                PendingEntity.ITEM -> {
                    val current = requireNotNull(queryItem(this, accountId, conflict.localId))
                    if (current.conflictState == ConflictState.REMOTE_DELETE) {
                        removablePaths += photos(accountId, current.localId, includeDeleted = true)
                            .flatMap(LocalPhotoRecord::allPaths)
                        current.remoteId?.let { remoteId ->
                            delete(
                                REMOTE_PHOTO_QUEUE_TABLE,
                                "account_id = ? AND item_remote_id = ?",
                                arrayOf(accountId, remoteId),
                            )
                        }
                        delete(ITEM_TABLE, "account_id = ? AND local_id = ?", arrayOf(accountId, current.localId))
                    } else {
                        val remote = json.decodeFromString<CollectionItem>(
                            requireNotNull(current.conflictJson) { "Server item is missing" },
                        )
                        val values = ContentValues().apply {
                            put("item_json", json.encodeToString(remote.copy(id = current.localId)))
                            put("dirty_state", DirtyState.CLEAN.dbValue)
                            put("synced_at_ms", System.currentTimeMillis())
                            putNullable("server_updated_at", remote.updatedAt)
                            put("server_version", remote.version)
                            putNull("sync_revision")
                            putNull("conflict_kind")
                            putNull("conflict_json")
                            put("remote_deleted", 0)
                        }
                        checkedUpdate(this, ITEM_TABLE, values, accountId, current.localId)
                    }
                }
                PendingEntity.PHOTO -> {
                    val current = requireNotNull(queryPhoto(this, accountId, conflict.localId))
                    if (conflict.conflictState == ConflictState.REMOTE_DELETE || remotePhoto == null) {
                        removablePaths += current.allPaths()
                        delete(PHOTO_TABLE, "account_id = ? AND local_id = ?", arrayOf(accountId, current.localId))
                    } else {
                        val downloaded = requireNotNull(downloadedPhoto) { "Downloaded photo is missing" }
                        removablePaths += current.allPaths().filterNot { it in downloaded.allPaths() }
                        val values = photoValues(
                            accountId = accountId,
                            itemLocalId = current.itemLocalId,
                            photo = downloaded.copy(localId = current.localId, remoteId = remotePhoto.id),
                            dirtyState = DirtyState.CLEAN,
                            createdAtMs = current.createdAtMs,
                            updatedAtMs = System.currentTimeMillis(),
                            syncedAtMs = System.currentTimeMillis(),
                            itemVersion = remotePhoto.itemVersion,
                            localRevision = current.localRevision,
                        )
                        checkedUpdate(this, PHOTO_TABLE, values, accountId, current.localId)
                        remotePhoto.itemVersion?.let {
                            updateItemServerVersion(this, accountId, current.itemLocalId, it)
                        }
                    }
                }
            }
        }
        return removablePaths.distinct()
    }

    fun setItemServerVersion(accountId: String, itemLocalId: String, version: Long) {
        updateItemServerVersion(accountId, itemLocalId, version)
    }

    fun markPhotoSyncAttempt(accountId: String, photoLocalId: String, localRevision: Long) {
        val current = requireNotNull(photo(accountId, photoLocalId))
        check(current.localRevision == localRevision) { "Local photo changed before synchronization" }
        val values = ContentValues().apply { put("sync_revision", localRevision) }
        checkedUpdate(PHOTO_TABLE, values, accountId, photoLocalId)
    }

    fun markItemSyncAttempt(accountId: String, localId: String, localRevision: Long) {
        val current = requireNotNull(get(accountId, localId))
        check(current.localRevision == localRevision) { "Local item changed before synchronization" }
        val values = ContentValues().apply { put("sync_revision", localRevision) }
        checkedUpdate(ITEM_TABLE, values, accountId, localId)
    }

    fun photos(
        accountId: String,
        itemLocalId: String,
        includeDeleted: Boolean = false,
    ): List<LocalPhotoRecord> {
        requireAccount(accountId)
        val selection = buildString {
            append("account_id = ? AND item_local_id = ?")
            if (!includeDeleted) append(" AND dirty_state != 'delete' AND remote_deleted = 0")
        }
        return readableDatabase.query(
            PHOTO_TABLE,
            PHOTO_COLUMNS,
            selection,
            arrayOf(accountId, itemLocalId),
            null,
            null,
            "sort_order ASC, created_at_ms ASC, local_id ASC",
        ).use { cursor -> buildList { while (cursor.moveToNext()) add(cursor.toPhoto()) } }
    }

    fun firstPhotoThumbnailPaths(accountId: String): Map<String, String> {
        requireAccount(accountId)
        return readableDatabase.query(
            PHOTO_TABLE,
            arrayOf("item_local_id", "thumb_path"),
            "account_id = ? AND dirty_state != 'delete' AND remote_deleted = 0",
            arrayOf(accountId),
            null,
            null,
            "item_local_id ASC, sort_order ASC, created_at_ms ASC, local_id ASC",
        ).use { cursor ->
            buildMap {
                while (cursor.moveToNext()) {
                    putIfAbsent(cursor.getString(0), cursor.getString(1))
                }
            }
        }
    }

    fun photo(accountId: String, photoLocalId: String): LocalPhotoRecord? {
        requireAccount(accountId)
        return readableDatabase.query(
            PHOTO_TABLE,
            PHOTO_COLUMNS,
            "account_id = ? AND local_id = ?",
            arrayOf(accountId, photoLocalId),
            null,
            null,
            null,
            "1",
        ).use { cursor -> if (cursor.moveToFirst()) cursor.toPhoto() else null }
    }

    /** Ordered so parent creates precede photos and an item delete is handled last. */
    fun pendingOperations(accountId: String, limit: Int = 200): List<PendingSyncOperation> {
        requireAccount(accountId)
        require(limit in 1..MAX_PENDING_LIMIT)
        val operations = mutableListOf<PendingSyncOperation>()
        readableDatabase.rawQuery(
            """
            SELECT 'item' AS entity, account_id, local_id, remote_id, dirty_state, updated_at_ms,
                   item_json AS payload, create_request_json,
                   CASE dirty_state WHEN 'create' THEN 0 WHEN 'update' THEN 1 ELSE 4 END AS priority,
                   NULL AS item_local_id, NULL AS side, NULL AS sort_order, NULL AS mime_type,
                   NULL AS sha256, NULL AS byte_size, NULL AS original_path, NULL AS display_path,
                   NULL AS thumb_path, created_at_ms, synced_at_ms, server_version,
                   local_revision, NULL AS item_version
              FROM collection_item_local
             WHERE account_id = ? AND dirty_state != 'clean' AND conflict_kind IS NULL
            UNION ALL
            SELECT 'photo' AS entity, p.account_id, p.local_id, p.remote_id, p.dirty_state,
                   p.updated_at_ms, NULL AS payload, NULL AS create_request_json,
                   CASE p.dirty_state WHEN 'delete' THEN 2 ELSE 3 END AS priority,
                   p.item_local_id, p.side, p.sort_order, p.mime_type, p.sha256, p.byte_size,
                   p.original_path, p.display_path, p.thumb_path, p.created_at_ms, p.synced_at_ms,
                   NULL AS server_version, p.local_revision, p.item_version
              FROM collection_photo_local p
              JOIN collection_item_local i
                ON i.account_id = p.account_id AND i.local_id = p.item_local_id
             WHERE p.account_id = ? AND p.dirty_state != 'clean' AND i.dirty_state != 'delete'
               AND p.conflict_kind IS NULL AND i.conflict_kind IS NULL
             ORDER BY priority ASC, updated_at_ms ASC, local_id ASC
             LIMIT ?
            """.trimIndent(),
            arrayOf(accountId, accountId, limit.toString()),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                val entity = PendingEntity.fromDb(cursor.string("entity"))
                val localId = cursor.string("local_id")
                operations += PendingSyncOperation(
                    entity = entity,
                    localId = localId,
                    remoteId = cursor.nullableString("remote_id"),
                    mutation = DirtyState.fromDb(cursor.string("dirty_state")),
                    updatedAtMs = cursor.long("updated_at_ms"),
                    localRevision = cursor.long("local_revision"),
                    expectedVersion = if (entity == PendingEntity.ITEM) {
                        cursor.nullableLong("server_version")
                    } else {
                        cursor.nullableLong("item_version")
                    },
                    item = if (entity == PendingEntity.ITEM) {
                        json.decodeFromString<CollectionItem>(cursor.string("payload"))
                    } else {
                        null
                    },
                    createRequest = if (entity == PendingEntity.ITEM) {
                        cursor.nullableString("create_request_json")?.let(json::decodeFromString)
                    } else {
                        null
                    },
                    photo = if (entity == PendingEntity.PHOTO) cursor.toPhoto() else null,
                )
            }
        }
        return operations
    }

    /** Atomically accepts the canonical server item and any photo ids returned by its upload. */
    fun markSynced(
        accountId: String,
        localId: String,
        remoteItem: CollectionItem,
        photoRemoteIds: Map<String, String> = emptyMap(),
        expectedLocalRevision: Long? = null,
        nowMs: Long = System.currentTimeMillis(),
    ): LocalCollectionRecord {
        require(remoteItem.id.isNotBlank())
        writableDatabase.inTransaction {
            val current = requireNotNull(queryItem(this, accountId, localId)) { "Local item does not exist" }
            val unchanged = expectedLocalRevision == null || current.localRevision == expectedLocalRevision
            val nextDirty = dirtyStateAfterAcknowledgement(
                current.dirtyState, current.localRevision, expectedLocalRevision,
            )
            val values = ContentValues().apply {
                put("remote_id", remoteItem.id)
                if (unchanged) put("item_json", json.encodeToString(remoteItem.copy(id = localId)))
                put("dirty_state", nextDirty.dbValue)
                put("updated_at_ms", nowMs)
                put("synced_at_ms", nowMs)
                put("server_updated_at", remoteItem.updatedAt)
                put("server_version", remoteItem.version)
                putNull("conflict_kind")
                putNull("conflict_json")
                put("remote_deleted", 0)
                putNull("sync_revision")
                putNull("staging_session_id")
            }
            checkedUpdate(this, ITEM_TABLE, values, accountId, localId)
            if (unchanged) photoRemoteIds.forEach { (photoLocalId, photoRemoteId) ->
                require(photoRemoteId.isNotBlank())
                val localPhoto = requireNotNull(queryPhoto(this, accountId, photoLocalId)) {
                    "Local photo does not exist"
                }
                check(localPhoto.itemLocalId == localId) { "Photo belongs to a different item" }
                val photoValues = ContentValues().apply {
                    put("remote_id", photoRemoteId)
                    put("dirty_state", DirtyState.CLEAN.dbValue)
                    put("updated_at_ms", nowMs)
                    put("synced_at_ms", nowMs)
                    put("item_version", remoteItem.version)
                    putNull("conflict_kind")
                    putNull("conflict_json")
                    put("remote_deleted", 0)
                    putNull("sync_revision")
                }
                checkedUpdate(this, PHOTO_TABLE, photoValues, accountId, photoLocalId)
            }
        }
        return requireNotNull(get(accountId, localId))
    }

    fun markPhotoSynced(
        accountId: String,
        photoLocalId: String,
        remoteId: String,
        itemVersion: Long,
        expectedLocalRevision: Long? = null,
        nowMs: Long = System.currentTimeMillis(),
    ): LocalPhotoRecord {
        require(remoteId.isNotBlank())
        val current = requireNotNull(this.photo(accountId, photoLocalId)) { "Local photo does not exist" }
        val nextDirty = dirtyStateAfterAcknowledgement(
            current.dirtyState, current.localRevision, expectedLocalRevision,
        )
        val values = ContentValues().apply {
            put("remote_id", remoteId)
            put("dirty_state", nextDirty.dbValue)
            put("updated_at_ms", nowMs)
            put("synced_at_ms", nowMs)
            put("item_version", itemVersion)
            putNull("conflict_kind")
            putNull("conflict_json")
            put("remote_deleted", 0)
            putNull("sync_revision")
        }
        checkedUpdate(PHOTO_TABLE, values, accountId, photoLocalId)
        updateItemServerVersion(accountId, current.itemLocalId, itemVersion)
        return requireNotNull(this.photo(accountId, photoLocalId))
    }

    fun markDeletedSynced(accountId: String, localId: String, expectedLocalRevision: Long? = null): List<String> {
        val current = requireNotNull(get(accountId, localId)) { "Local item does not exist" }
        check(current.dirtyState == DirtyState.DELETE) { "Item is not pending deletion" }
        if (expectedLocalRevision != null && current.localRevision != expectedLocalRevision) return emptyList()
        val paths = photos(accountId, localId, includeDeleted = true).flatMap(LocalPhotoRecord::allPaths).distinct()
        checkedDelete(ITEM_TABLE, accountId, localId)
        return paths
    }

    fun markPhotoDeletedSynced(
        accountId: String,
        photoLocalId: String,
        expectedLocalRevision: Long? = null,
    ): List<String> {
        val current = requireNotNull(photo(accountId, photoLocalId)) { "Local photo does not exist" }
        check(current.dirtyState == DirtyState.DELETE) { "Photo is not pending deletion" }
        if (expectedLocalRevision != null && current.localRevision != expectedLocalRevision) return emptyList()
        checkedDelete(PHOTO_TABLE, accountId, photoLocalId)
        return current.allPaths()
    }

    /** Removes only clean server-backed rows that disappeared from a complete server snapshot. */
    fun removeCleanRemoteItemsNotIn(accountId: String, remoteIds: Set<String>): List<String> {
        val removable = list(accountId, includeDeleted = true).filter {
            it.dirtyState == DirtyState.CLEAN && it.remoteId != null && it.remoteId !in remoteIds
        }
        val paths = removable.flatMap { photos(accountId, it.localId, includeDeleted = true) }
            .flatMap(LocalPhotoRecord::allPaths)
            .distinct()
        writableDatabase.inTransaction {
            removable.forEach { delete(ITEM_TABLE, "account_id = ? AND local_id = ?", arrayOf(accountId, it.localId)) }
        }
        return paths
    }

    /** Same reconciliation boundary for a complete photo list of one item. */
    fun removeCleanRemotePhotosNotIn(
        accountId: String,
        itemLocalId: String,
        remoteIds: Set<String>,
    ): List<String> {
        val removable = photos(accountId, itemLocalId, includeDeleted = true).filter {
            it.dirtyState == DirtyState.CLEAN && it.remoteId != null && it.remoteId !in remoteIds
        }
        writableDatabase.inTransaction {
            removable.forEach { delete(PHOTO_TABLE, "account_id = ? AND local_id = ?", arrayOf(accountId, it.localId)) }
        }
        return removable.flatMap(LocalPhotoRecord::allPaths).distinct()
    }

    fun syncMetadata(accountId: String): CollectionSyncMetadata {
        requireAccount(accountId)
        return readableDatabase.query(
            SYNC_TABLE,
            SYNC_COLUMNS,
            "account_id = ?",
            arrayOf(accountId),
            null,
            null,
            null,
            "1",
        ).use { cursor ->
            if (cursor.moveToFirst()) cursor.toSyncMetadata()
            else CollectionSyncMetadata(accountId = accountId)
        }
    }

    /** Makes metadata visible without advancing the durable synchronization cursor. */
    fun applySyncChanges(
        accountId: String,
        changes: List<CollectionSyncChange>,
        preparedPhotos: Map<String, LocalPhotoDraft>,
    ): List<String> {
        val unusedDownloadedPaths = mutableListOf<String>()
        writableDatabase.inTransaction {
            applyRemoteChanges(accountId, changes, preparedPhotos, unusedDownloadedPaths)
        }
        return unusedDownloadedPaths.distinct()
    }

    /** Commits a validated, fully downloaded delta page together with its cursor. */
    fun applySyncPage(
        accountId: String,
        changes: List<CollectionSyncChange>,
        preparedPhotos: Map<String, LocalPhotoDraft>,
        nextCursor: String,
    ): List<String> {
        require(nextCursor.isNotBlank())
        val unusedDownloadedPaths = mutableListOf<String>()
        writableDatabase.inTransaction {
            applyRemoteChanges(accountId, changes, preparedPhotos, unusedDownloadedPaths)
            updateSyncMetadata(accountId, nextCursor, null, null)
        }
        return unusedDownloadedPaths.distinct()
    }

    /** Saves a delta page immediately and queues photo bodies for a resumable download. */
    fun applySyncPageWithDeferredPhotos(
        accountId: String,
        changes: List<CollectionSyncChange>,
        nextCursor: String,
    ): List<String> {
        require(nextCursor.isNotBlank())
        val unusedDownloadedPaths = mutableListOf<String>()
        writableDatabase.inTransaction {
            changes.forEach { change ->
                when {
                    defersPhotoBody(change) -> {
                        queueRemotePhoto(this, accountId, change)
                    }
                    change.entityKind == "photo" && change.operation == "delete" -> {
                        delete(
                            REMOTE_PHOTO_QUEUE_TABLE,
                            "account_id = ? AND remote_id = ?",
                            arrayOf(accountId, change.entityId),
                        )
                        unusedDownloadedPaths += applyRemotePhotoDelete(
                            accountId, change.entityId, change.changedAt,
                        )
                    }
                    change.entityKind == "item" && change.operation == "delete" -> {
                        delete(
                            REMOTE_PHOTO_QUEUE_TABLE,
                            "account_id = ? AND item_remote_id = ?",
                            arrayOf(accountId, change.itemId),
                        )
                        unusedDownloadedPaths += applyRemoteItemDelete(
                            accountId, change.entityId, change.changedAt,
                        )
                    }
                    else -> applyRemoteChanges(
                        accountId,
                        listOf(change),
                        emptyMap(),
                        unusedDownloadedPaths,
                    )
                }
            }
            updateSyncMetadata(accountId, nextCursor, null, null)
        }
        return unusedDownloadedPaths.distinct()
    }

    fun pendingRemotePhotos(accountId: String): List<PendingRemotePhoto> {
        requireAccount(accountId)
        return readableDatabase.query(
            REMOTE_PHOTO_QUEUE_TABLE,
            REMOTE_PHOTO_QUEUE_COLUMNS,
            "account_id = ?",
            arrayOf(accountId),
            null,
            null,
            "seq, remote_id",
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    add(
                        PendingRemotePhoto(
                            accountId = cursor.string("account_id"),
                            remoteId = cursor.string("remote_id"),
                            itemRemoteId = cursor.string("item_remote_id"),
                            seq = cursor.long("seq"),
                            photo = json.decodeFromString(cursor.string("photo_json")),
                            changedAt = cursor.string("changed_at"),
                            attemptCount = cursor.int("attempt_count"),
                            lastError = cursor.nullableString("last_error"),
                        ),
                    )
                }
            }
        }
    }

    fun pendingRemotePhotoCount(accountId: String): Int {
        requireAccount(accountId)
        return readableDatabase.rawQuery(
            "SELECT count(*) FROM $REMOTE_PHOTO_QUEUE_TABLE WHERE account_id = ?",
            arrayOf(accountId),
        ).use { cursor -> cursor.moveToFirst(); cursor.getInt(0) }
    }

    fun markRemotePhotoDownloaded(accountId: String, remoteId: String) {
        writableDatabase.delete(
            REMOTE_PHOTO_QUEUE_TABLE,
            "account_id = ? AND remote_id = ?",
            arrayOf(accountId, remoteId),
        )
    }

    fun markRemotePhotoDownloadFailed(accountId: String, remoteId: String, message: String?) {
        val values = ContentValues().apply {
            put("last_error", message?.take(500))
            put("updated_at_ms", System.currentTimeMillis())
        }
        writableDatabase.execSQL(
            """
            UPDATE $REMOTE_PHOTO_QUEUE_TABLE
            SET attempt_count = attempt_count + 1,
                last_error = ?,
                updated_at_ms = ?
            WHERE account_id = ? AND remote_id = ?
            """.trimIndent(),
            arrayOf(values.getAsString("last_error"), values.getAsLong("updated_at_ms"), accountId, remoteId),
        )
    }

    private fun queueRemotePhoto(
        db: SQLiteDatabase,
        accountId: String,
        change: CollectionSyncChange,
    ) {
        val photo = requireNotNull(change.photo) { "Remote photo is missing" }
        val values = ContentValues().apply {
            put("account_id", accountId)
            put("remote_id", photo.id)
            put("item_remote_id", change.itemId)
            put("seq", change.seq.toLong())
            put("photo_json", json.encodeToString(photo))
            put("changed_at", change.changedAt)
            put("attempt_count", 0)
            putNull("last_error")
            put("updated_at_ms", System.currentTimeMillis())
        }
        db.insertWithOnConflict(
            REMOTE_PHOTO_QUEUE_TABLE,
            null,
            values,
            SQLiteDatabase.CONFLICT_REPLACE,
        ).also { check(it != -1L) { "Could not queue remote photo" } }
    }

    private fun applyRemoteChanges(
        accountId: String,
        changes: List<CollectionSyncChange>,
        preparedPhotos: Map<String, LocalPhotoDraft>,
        unusedDownloadedPaths: MutableList<String>,
    ) {
        changes.forEach { change ->
            if (change.operation == "delete") {
                when (change.entityKind) {
                    "item" -> unusedDownloadedPaths += applyRemoteItemDelete(
                        accountId, change.entityId, change.changedAt,
                    )
                    "photo" -> unusedDownloadedPaths += applyRemotePhotoDelete(
                        accountId, change.entityId, change.changedAt,
                    )
                    "valuation" -> Unit
                    else -> error("Unknown sync entity: ${change.entityKind}")
                }
            } else {
                when (change.entityKind) {
                    "item" -> upsertRemote(
                        accountId,
                        requireNotNull(change.item),
                        change.clientMutationId,
                    )
                    "photo" -> {
                        val remote = requireNotNull(change.photo)
                        val parent = requireNotNull(getByRemoteId(accountId, change.itemId)) {
                            "Photo arrived before its item"
                        }
                        val prepared = requireNotNull(preparedPhotos[change.seq]) {
                            "Prepared photo is missing"
                        }
                        val result = reconcileRemotePhoto(accountId, parent.localId, remote, prepared)
                        if (result.applied && result.record.originalPath != prepared.originalPath) {
                            unusedDownloadedPaths += prepared.originalPath
                            unusedDownloadedPaths += prepared.displayPath
                            unusedDownloadedPaths += prepared.thumbPath
                        }
                    }
                    "valuation" -> applyRemoteValuation(
                        accountId,
                        change.itemId,
                        requireNotNull(change.valuation),
                    )
                    else -> error("Unknown sync entity: ${change.entityKind}")
                }
            }
        }
    }

    fun updateSyncMetadata(
        accountId: String,
        remoteCursor: String?,
        lastSyncAtMs: Long?,
        lastError: String?,
        nowMs: Long = System.currentTimeMillis(),
    ) {
        requireAccount(accountId)
        val values = ContentValues().apply {
            put("account_id", accountId)
            putNullable("remote_cursor", remoteCursor)
            putNullable("last_sync_at_ms", lastSyncAtMs)
            putNullable("last_error", lastError)
            put("updated_at_ms", nowMs)
        }
        writableDatabase.insertWithOnConflict(
            SYNC_TABLE,
            null,
            values,
            SQLiteDatabase.CONFLICT_REPLACE,
        ).also { check(it != -1L) { "Could not update sync metadata" } }
    }

    /** Returns owned files so the caller can remove them after the database transaction commits. */
    fun clearAccount(accountId: String): List<String> {
        requireAccount(accountId)
        val paths = mutableListOf<String>()
        writableDatabase.inTransaction {
            query(
                PHOTO_TABLE,
                arrayOf("original_path", "display_path", "thumb_path"),
                "account_id = ?",
                arrayOf(accountId),
                null,
                null,
                null,
            ).use { cursor ->
                while (cursor.moveToNext()) {
                    paths += cursor.string("original_path")
                    paths += cursor.string("display_path")
                    paths += cursor.string("thumb_path")
                }
            }
            delete(ITEM_TABLE, "account_id = ?", arrayOf(accountId))
            delete(SYNC_TABLE, "account_id = ?", arrayOf(accountId))
            delete(REMOTE_PHOTO_QUEUE_TABLE, "account_id = ?", arrayOf(accountId))
        }
        return paths.distinct()
    }

    private fun itemValues(
        accountId: String,
        localId: String,
        remoteId: String?,
        item: CollectionItem,
        createRequest: CreateItemRequest?,
        dirtyState: DirtyState,
        stagingSessionId: String?,
        createdAtMs: Long,
        updatedAtMs: Long,
        syncedAtMs: Long?,
        serverUpdatedAt: String?,
        serverVersion: Long? = null,
        localRevision: Long = 1,
    ) = ContentValues().apply {
        put("account_id", accountId)
        put("local_id", localId)
        putNullable("remote_id", remoteId)
        put("item_json", json.encodeToString(item))
        putNullable("create_request_json", createRequest?.let(json::encodeToString))
        put("dirty_state", dirtyState.dbValue)
        putNullable("staging_session_id", stagingSessionId)
        put("created_at_ms", createdAtMs)
        put("updated_at_ms", updatedAtMs)
        putNullable("synced_at_ms", syncedAtMs)
        putNullable("server_updated_at", serverUpdatedAt)
        putNullable("server_version", serverVersion)
        put("local_revision", localRevision)
        putNull("sync_revision")
        putNull("conflict_kind")
        putNull("conflict_json")
        put("remote_deleted", 0)
    }

    private fun photoValues(
        accountId: String,
        itemLocalId: String,
        photo: LocalPhotoDraft,
        dirtyState: DirtyState,
        createdAtMs: Long,
        updatedAtMs: Long = createdAtMs,
        syncedAtMs: Long?,
        itemVersion: Long? = null,
        localRevision: Long = 1,
    ) = ContentValues().apply {
        put("account_id", accountId)
        put("local_id", photo.localId)
        put("item_local_id", itemLocalId)
        putNullable("remote_id", photo.remoteId)
        put("side", photo.side)
        put("sort_order", photo.sortOrder)
        put("mime_type", photo.mimeType)
        put("sha256", photo.sha256.lowercase())
        put("byte_size", photo.byteSize)
        put("original_path", photo.originalPath)
        put("display_path", photo.displayPath)
        put("thumb_path", photo.thumbPath)
        put("dirty_state", dirtyState.dbValue)
        put("created_at_ms", createdAtMs)
        put("updated_at_ms", updatedAtMs)
        putNullable("synced_at_ms", syncedAtMs)
        putNullable("item_version", itemVersion)
        put("local_revision", localRevision)
        putNull("sync_revision")
        putNull("conflict_kind")
        putNull("conflict_json")
        put("remote_deleted", 0)
    }

    private fun queryItemByRemoteId(db: SQLiteDatabase, accountId: String, remoteId: String) =
        db.query(
            ITEM_TABLE,
            ITEM_COLUMNS,
            "account_id = ? AND remote_id = ?",
            arrayOf(accountId, remoteId),
            null,
            null,
            null,
            "1",
        ).use { cursor -> if (cursor.moveToFirst()) cursor.toItem() else null }

    private fun queryItem(db: SQLiteDatabase, accountId: String, localId: String) =
        db.query(
            ITEM_TABLE,
            ITEM_COLUMNS,
            "account_id = ? AND local_id = ?",
            arrayOf(accountId, localId),
            null,
            null,
            null,
            "1",
        ).use { cursor -> if (cursor.moveToFirst()) cursor.toItem() else null }

    private fun queryPhotoByRemoteId(db: SQLiteDatabase, accountId: String, remoteId: String) =
        db.query(
            PHOTO_TABLE,
            PHOTO_COLUMNS,
            "account_id = ? AND remote_id = ?",
            arrayOf(accountId, remoteId),
            null,
            null,
            null,
            "1",
        ).use { cursor -> if (cursor.moveToFirst()) cursor.toPhoto() else null }

    private fun queryPhoto(db: SQLiteDatabase, accountId: String, localId: String) =
        db.query(
            PHOTO_TABLE,
            PHOTO_COLUMNS,
            "account_id = ? AND local_id = ?",
            arrayOf(accountId, localId),
            null,
            null,
            null,
            "1",
        ).use { cursor -> if (cursor.moveToFirst()) cursor.toPhoto() else null }

    private fun updateItemServerVersion(accountId: String, localId: String, version: Long) =
        updateItemServerVersion(writableDatabase, accountId, localId, version)

    private fun updateItemServerVersion(db: SQLiteDatabase, accountId: String, localId: String, version: Long) {
        check(version > 0)
        val statement = db.compileStatement(
            """
            UPDATE $ITEM_TABLE
               SET server_version = CASE
                   WHEN server_version IS NULL OR server_version < ? THEN ?
                   ELSE server_version
               END
             WHERE account_id = ? AND local_id = ?
            """.trimIndent(),
        )
        statement.bindLong(1, version)
        statement.bindLong(2, version)
        statement.bindString(3, accountId)
        statement.bindString(4, localId)
        check(statement.executeUpdateDelete() == 1) { "Local item does not exist" }
    }

    private fun Cursor.toItem() = LocalCollectionRecord(
        accountId = string("account_id"),
        localId = string("local_id"),
        remoteId = nullableString("remote_id"),
        item = json.decodeFromString(string("item_json")),
        createRequest = nullableString("create_request_json")?.let(json::decodeFromString),
        dirtyState = DirtyState.fromDb(string("dirty_state")),
        stagingSessionId = nullableString("staging_session_id"),
        createdAtMs = long("created_at_ms"),
        updatedAtMs = long("updated_at_ms"),
        syncedAtMs = nullableLong("synced_at_ms"),
        serverUpdatedAt = nullableString("server_updated_at"),
        serverVersion = nullableLong("server_version"),
        localRevision = long("local_revision"),
        syncRevision = nullableLong("sync_revision"),
        conflictState = nullableString("conflict_kind")?.let(ConflictState::fromDb) ?: ConflictState.NONE,
        conflictJson = nullableString("conflict_json"),
        remoteDeleted = int("remote_deleted") != 0,
    )

    private fun Cursor.toPhoto() = LocalPhotoRecord(
        accountId = string("account_id"),
        localId = string("local_id"),
        itemLocalId = string("item_local_id"),
        remoteId = nullableString("remote_id"),
        side = string("side"),
        sortOrder = int("sort_order"),
        mimeType = string("mime_type"),
        sha256 = string("sha256"),
        byteSize = long("byte_size"),
        originalPath = string("original_path"),
        displayPath = string("display_path"),
        thumbPath = string("thumb_path"),
        dirtyState = DirtyState.fromDb(string("dirty_state")),
        createdAtMs = long("created_at_ms"),
        updatedAtMs = long("updated_at_ms"),
        syncedAtMs = nullableLong("synced_at_ms"),
        itemVersion = nullableLong("item_version"),
        localRevision = long("local_revision"),
        syncRevision = nullableLong("sync_revision"),
        conflictState = nullableString("conflict_kind")?.let(ConflictState::fromDb) ?: ConflictState.NONE,
        conflictJson = nullableString("conflict_json"),
        remoteDeleted = int("remote_deleted") != 0,
    )

    private fun Cursor.toSyncMetadata() = CollectionSyncMetadata(
        accountId = string("account_id"),
        remoteCursor = nullableString("remote_cursor"),
        lastSyncAtMs = nullableLong("last_sync_at_ms"),
        lastError = nullableString("last_error"),
        updatedAtMs = long("updated_at_ms"),
    )

    private fun checkedUpdate(table: String, values: ContentValues, accountId: String, localId: String) {
        checkedUpdate(writableDatabase, table, values, accountId, localId)
    }

    private fun checkedUpdate(
        db: SQLiteDatabase,
        table: String,
        values: ContentValues,
        accountId: String,
        localId: String,
    ) {
        check(db.update(table, values, "account_id = ? AND local_id = ?", arrayOf(accountId, localId)) == 1) {
            "Expected exactly one $table row to be updated"
        }
    }

    private fun checkedDelete(table: String, accountId: String, localId: String) {
        check(writableDatabase.delete(table, "account_id = ? AND local_id = ?", arrayOf(accountId, localId)) == 1) {
            "Expected exactly one $table row to be deleted"
        }
    }

    private fun validatePhotoDraft(photo: LocalPhotoDraft) {
        require(photo.localId.isNotBlank())
        require(photo.side in PHOTO_SIDES) { "Unsupported photo side: ${photo.side}" }
        require(photo.sortOrder >= 0)
        require(photo.mimeType.startsWith("image/"))
        require(photo.byteSize >= 0)
        require(SHA256_REGEX.matches(photo.sha256)) { "sha256 must contain 64 hexadecimal characters" }
        require(photo.originalPath.isNotBlank())
        require(photo.displayPath.isNotBlank())
        require(photo.thumbPath.isNotBlank())
    }

    private fun sameUserItemFields(local: CollectionItem, remote: CollectionItem): Boolean =
        local.typeId == remote.typeId &&
            local.issueId == remote.issueId &&
            local.identifiedYear == remote.identifiedYear &&
            local.userLabel == remote.userLabel &&
            local.gradeSystem == remote.gradeSystem &&
            local.gradeCode == remote.gradeCode &&
            local.slabStatus == remote.slabStatus &&
            local.gradingCompanyCode == remote.gradingCompanyCode &&
            local.gradeSource == remote.gradeSource &&
            local.slabCertificateNumber == remote.slabCertificateNumber &&
            local.purchasePriceMinor == remote.purchasePriceMinor &&
            local.purchaseCurrency == remote.purchaseCurrency &&
            local.purchaseDate == remote.purchaseDate &&
            local.purchaseSource == remote.purchaseSource &&
            local.notes == remote.notes &&
            local.status == remote.status &&
            local.soldPriceMinor == remote.soldPriceMinor &&
            local.soldCurrency == remote.soldCurrency &&
            local.soldAt == remote.soldAt

    private fun requireAccount(accountId: String) = require(accountId.isNotBlank()) { "accountId is required" }

    private inline fun <T> SQLiteDatabase.inTransaction(block: SQLiteDatabase.() -> T): T {
        if (inTransaction()) return block()
        beginTransaction()
        return try {
            val result = block()
            setTransactionSuccessful()
            result
        } finally {
            endTransaction()
        }
    }

    private fun Cursor.string(name: String): String = getString(getColumnIndexOrThrow(name))
    private fun Cursor.nullableString(name: String): String? =
        getColumnIndexOrThrow(name).let { if (isNull(it)) null else getString(it) }
    private fun Cursor.long(name: String): Long = getLong(getColumnIndexOrThrow(name))
    private fun Cursor.nullableLong(name: String): Long? =
        getColumnIndexOrThrow(name).let { if (isNull(it)) null else getLong(it) }
    private fun Cursor.int(name: String): Int = getInt(getColumnIndexOrThrow(name))

    private fun ContentValues.putNullable(key: String, value: String?) {
        if (value == null) putNull(key) else put(key, value)
    }

    private fun ContentValues.putNullable(key: String, value: Long?) {
        if (value == null) putNull(key) else put(key, value)
    }

    private companion object {
        const val DATABASE_NAME = "numismat_collection.db"
        const val DATABASE_VERSION = 4
        const val ITEM_TABLE = "collection_item_local"
        const val PHOTO_TABLE = "collection_photo_local"
        const val SYNC_TABLE = "collection_sync_metadata"
        const val REMOTE_PHOTO_QUEUE_TABLE = "collection_remote_photo_pending"
        const val MAX_PENDING_LIMIT = Int.MAX_VALUE
        val PHOTO_SIDES = setOf("obverse", "reverse", "other")
        val SHA256_REGEX = Regex("^[0-9a-fA-F]{64}$")
        val ITEM_COLUMNS = arrayOf(
            "account_id", "local_id", "remote_id", "item_json", "create_request_json", "dirty_state",
            "staging_session_id", "created_at_ms", "updated_at_ms", "synced_at_ms",
            "server_updated_at",
            "server_version", "local_revision", "sync_revision", "conflict_kind", "conflict_json", "remote_deleted",
        )
        val PHOTO_COLUMNS = arrayOf(
            "account_id", "local_id", "item_local_id", "remote_id", "side", "sort_order",
            "mime_type", "sha256", "byte_size", "original_path", "display_path", "thumb_path",
            "dirty_state", "created_at_ms", "updated_at_ms", "synced_at_ms",
            "item_version", "local_revision", "sync_revision", "conflict_kind", "conflict_json", "remote_deleted",
        )
        val SYNC_COLUMNS = arrayOf(
            "account_id", "remote_cursor", "last_sync_at_ms", "last_error", "updated_at_ms",
        )
        val REMOTE_PHOTO_QUEUE_COLUMNS = arrayOf(
            "account_id", "remote_id", "item_remote_id", "seq", "photo_json", "changed_at",
            "attempt_count", "last_error", "updated_at_ms",
        )
    }
}

enum class DirtyState(val dbValue: String) {
    CLEAN("clean"),
    CREATE("create"),
    UPDATE("update"),
    DELETE("delete");

    companion object {
        fun fromDb(value: String): DirtyState = entries.firstOrNull { it.dbValue == value }
            ?: error("Unknown dirty state: $value")
    }
}

internal fun dirtyStateAfterAcknowledgement(
    current: DirtyState,
    currentRevision: Long,
    expectedRevision: Long?,
): DirtyState = when {
    expectedRevision == null || currentRevision == expectedRevision -> DirtyState.CLEAN
    current == DirtyState.DELETE -> DirtyState.DELETE
    else -> DirtyState.UPDATE
}

enum class ConflictState(val dbValue: String) {
    NONE("none"),
    VERSION("version"),
    REMOTE_DELETE("remote_delete");

    companion object {
        fun fromDb(value: String): ConflictState = entries.firstOrNull { it.dbValue == value }
            ?: error("Unknown conflict state: $value")
    }
}

enum class PendingEntity(val dbValue: String) {
    ITEM("item"),
    PHOTO("photo");

    companion object {
        fun fromDb(value: String): PendingEntity = entries.firstOrNull { it.dbValue == value }
            ?: error("Unknown pending entity: $value")
    }
}

data class LocalCollectionRecord(
    val accountId: String,
    val localId: String,
    val remoteId: String?,
    val item: CollectionItem,
    val createRequest: CreateItemRequest?,
    val dirtyState: DirtyState,
    val stagingSessionId: String?,
    val createdAtMs: Long,
    val updatedAtMs: Long,
    val syncedAtMs: Long?,
    val serverUpdatedAt: String?,
    val serverVersion: Long?,
    val localRevision: Long,
    val syncRevision: Long?,
    val conflictState: ConflictState,
    val conflictJson: String?,
    val remoteDeleted: Boolean,
)

@Serializable
data class LocalPhotoDraft(
    val localId: String = UUID.randomUUID().toString(),
    val remoteId: String? = null,
    val side: String,
    val sortOrder: Int,
    val mimeType: String,
    val sha256: String,
    val byteSize: Long,
    val originalPath: String,
    val displayPath: String,
    val thumbPath: String,
) {
    fun allPaths(): List<String> = listOf(originalPath, displayPath, thumbPath).distinct()
}

data class LocalPhotoRecord(
    val accountId: String,
    val localId: String,
    val itemLocalId: String,
    val remoteId: String?,
    val side: String,
    val sortOrder: Int,
    val mimeType: String,
    val sha256: String,
    val byteSize: Long,
    val originalPath: String,
    val displayPath: String,
    val thumbPath: String,
    val dirtyState: DirtyState,
    val createdAtMs: Long,
    val updatedAtMs: Long,
    val syncedAtMs: Long?,
    val itemVersion: Long?,
    val localRevision: Long,
    val syncRevision: Long?,
    val conflictState: ConflictState,
    val conflictJson: String?,
    val remoteDeleted: Boolean,
) {
    fun allPaths(): List<String> = listOf(originalPath, displayPath, thumbPath).distinct()
}

data class PendingSyncOperation(
    val entity: PendingEntity,
    val localId: String,
    val remoteId: String?,
    val mutation: DirtyState,
    val updatedAtMs: Long,
    val localRevision: Long,
    val expectedVersion: Long?,
    val item: CollectionItem? = null,
    val createRequest: CreateItemRequest? = null,
    val photo: LocalPhotoRecord? = null,
)

@Serializable
data class RemotePhotoConflict(
    val remotePhoto: CollectionPhoto,
    val downloaded: LocalPhotoDraft,
)

data class RemoteUpsertResult(
    val record: LocalCollectionRecord,
    val applied: Boolean,
)

data class RemotePhotoUpsertResult(
    val record: LocalPhotoRecord,
    val applied: Boolean,
)

data class LocalDeleteResult(
    val needsRemoteDelete: Boolean,
    val filePaths: List<String>,
)

data class CollectionSyncMetadata(
    val accountId: String,
    val remoteCursor: String? = null,
    val lastSyncAtMs: Long? = null,
    val lastError: String? = null,
    val updatedAtMs: Long = 0,
)

data class PendingRemotePhoto(
    val accountId: String,
    val remoteId: String,
    val itemRemoteId: String,
    val seq: Long,
    val photo: CollectionPhoto,
    val changedAt: String,
    val attemptCount: Int,
    val lastError: String?,
)

data class LocalSyncConflict(
    val entity: PendingEntity,
    val localId: String,
    val itemLocalId: String,
    val itemTitle: String,
    val conflictState: ConflictState,
    val remoteId: String?,
    val itemRemoteId: String?,
    val conflictJson: String?,
    val side: String? = null,
    val sortOrder: Int? = null,
)
