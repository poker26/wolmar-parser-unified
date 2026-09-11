package ru.begemot26.numismat.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LocalCollectionStoreTest {
    private lateinit var context: Context
    private lateinit var store: LocalCollectionStore

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.deleteDatabase("numismat_collection.db")
        store = LocalCollectionStore(context)
    }

    @After
    fun tearDown() {
        store.close()
        context.deleteDatabase("numismat_collection.db")
    }

    @Test
    fun advancesCursorBeforePhotoBodyAndKeepsFailedDownloadQueued() {
        val item = item(version = 1)
        val photo = CollectionPhoto(
            id = "photo-1",
            itemId = item.id,
            side = "obverse",
            mimeType = "image/jpeg",
            byteSize = 123,
            status = "ready",
            sortOrder = 0,
            sha256 = "a".repeat(64),
            itemVersion = 1,
            originalUrl = "https://example.test/original",
            displayUrl = "https://example.test/display",
            originalUrlExpiresAt = "2026-09-12T00:00:00Z",
            createdAt = NOW,
            updatedAt = NOW,
        )
        val changes = listOf(
            CollectionSyncChange(
                seq = "1",
                entityKind = "item",
                entityId = item.id,
                itemId = item.id,
                operation = "upsert",
                changedAt = NOW,
                item = item,
            ),
            CollectionSyncChange(
                seq = "2",
                entityKind = "photo",
                entityId = photo.id,
                itemId = item.id,
                operation = "upsert",
                changedAt = NOW,
                photo = photo,
            ),
        )

        store.applySyncPageWithDeferredPhotos(ACCOUNT_ID, changes, "cursor-2")

        assertEquals("cursor-2", store.syncMetadata(ACCOUNT_ID).remoteCursor)
        assertEquals(item.id, store.list(ACCOUNT_ID).single().remoteId)
        assertEquals(1, store.pendingRemotePhotoCount(ACCOUNT_ID))

        store.markRemotePhotoDownloadFailed(ACCOUNT_ID, photo.id, "offline")
        val pending = store.pendingRemotePhotos(ACCOUNT_ID).single()
        assertEquals(1, pending.attemptCount)
        assertEquals("offline", pending.lastError)

        store.markRemotePhotoDownloaded(ACCOUNT_ID, photo.id)
        assertEquals(0, store.pendingRemotePhotoCount(ACCOUNT_ID))
    }

    @Test
    fun keepingLocalItemUsesLatestServerVersionOnNextAttempt() {
        val remote = item(version = 1)
        val localId = store.upsertRemote(ACCOUNT_ID, remote).record.localId
        store.updateLocal(ACCOUNT_ID, localId, remote.copy(id = localId, notes = "Моя заметка"))

        store.upsertRemote(ACCOUNT_ID, remote.copy(version = 2, notes = "Другое устройство"))

        val conflict = store.nextConflict(ACCOUNT_ID)
        assertNotNull(conflict)
        assertEquals(2L, store.get(ACCOUNT_ID, localId)?.serverVersion)
        store.keepLocalConflict(ACCOUNT_ID, conflict!!)

        assertEquals(0, store.conflictCount(ACCOUNT_ID))
        val operation = store.pendingOperations(ACCOUNT_ID).single()
        assertEquals(2L, operation.expectedVersion)
        assertEquals("Моя заметка", operation.item?.notes)
    }

    @Test
    fun choosingServerItemDiscardsOnlyTheConflictingLocalEdit() {
        val remote = item(version = 1)
        val localId = store.upsertRemote(ACCOUNT_ID, remote).record.localId
        store.updateLocal(ACCOUNT_ID, localId, remote.copy(id = localId, notes = "Моя заметка"))
        store.upsertRemote(ACCOUNT_ID, remote.copy(version = 2, notes = "Другое устройство"))

        store.useServerConflict(ACCOUNT_ID, store.nextConflict(ACCOUNT_ID)!!)

        val resolved = store.get(ACCOUNT_ID, localId)!!
        assertEquals(DirtyState.CLEAN, resolved.dirtyState)
        assertEquals(2L, resolved.serverVersion)
        assertEquals("Другое устройство", resolved.item.notes)
        assertEquals(0, store.conflictCount(ACCOUNT_ID))
    }

    @Test
    fun databaseUpgradeRefreshesCatalogDataOnNextSync() {
        store.updateSyncMetadata(
            accountId = ACCOUNT_ID,
            remoteCursor = "cursor-before-catalog-contract-change",
            lastSyncAtMs = 1L,
            lastError = null,
        )

        store.onUpgrade(store.writableDatabase, 4, 5)

        assertEquals(null, store.syncMetadata(ACCOUNT_ID).remoteCursor)
    }

    @Test
    fun sameVersionRemoteItemRefreshesMintageForCleanLocalRecord() {
        val remote = item(version = 1).copy(catalog = CatalogSnapshot(mintage = null))
        val localId = store.upsertRemote(ACCOUNT_ID, remote).record.localId

        store.upsertRemote(
            ACCOUNT_ID,
            remote.copy(catalog = CatalogSnapshot(mintage = 1_000)),
        )

        val refreshed = store.get(ACCOUNT_ID, localId)!!
        assertEquals(DirtyState.CLEAN, refreshed.dirtyState)
        assertEquals(1_000L, refreshed.item.catalog?.mintage)
    }

    @Test
    fun loadsFirstThumbnailForEveryItemInOneResult() {
        store.saveIdentifiedCoin(
            ACCOUNT_ID,
            item(version = 1),
            listOf(
                photo("photo-later", sortOrder = 1, thumbPath = "thumb/later.jpg"),
                photo("photo-first", sortOrder = 0, thumbPath = "thumb/first.jpg"),
            ),
        )
        store.saveIdentifiedCoin(
            ACCOUNT_ID,
            item(version = 1, id = "item-2"),
            listOf(photo("photo-second-item", sortOrder = 0, thumbPath = "thumb/item-2.jpg")),
        )

        assertEquals(
            mapOf("item-1" to "thumb/first.jpg", "item-2" to "thumb/item-2.jpg"),
            store.firstPhotoThumbnailPaths(ACCOUNT_ID),
        )
        assertEquals(5, store.pendingOperationCount(ACCOUNT_ID))

        store.deletePhotoLocal(ACCOUNT_ID, "photo-first")
        assertEquals("thumb/later.jpg", store.firstPhotoThumbnailPaths(ACCOUNT_ID)["item-1"])
        assertEquals(4, store.pendingOperationCount(ACCOUNT_ID))
    }

    private fun item(version: Long, id: String = "item-1") = CollectionItem(
        id = id,
        version = version,
        typeName = "Тестовая монета",
        identificationStatus = "linked",
        notes = null,
        status = "active",
        createdAt = NOW,
        updatedAt = NOW,
    )

    private fun photo(id: String, sortOrder: Int, thumbPath: String) = LocalPhotoDraft(
        localId = id,
        side = "other",
        sortOrder = sortOrder,
        mimeType = "image/jpeg",
        sha256 = "a".repeat(64),
        byteSize = 10,
        originalPath = "original/$id.jpg",
        displayPath = "display/$id.jpg",
        thumbPath = thumbPath,
    )

    private companion object {
        const val ACCOUNT_ID = "account-1"
        const val NOW = "2026-09-11T00:00:00Z"
    }
}
