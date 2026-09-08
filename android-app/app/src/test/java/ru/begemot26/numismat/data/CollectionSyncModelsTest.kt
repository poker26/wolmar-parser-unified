package ru.begemot26.numismat.data

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class CollectionSyncModelsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun keepsIdentificationRequestIdFromRecognitionToCreatePayload() {
        val response = json.decodeFromString<IdentificationResponse>(
            """
            {
              "identificationSessionId": "session-1",
              "requestId": "request-1",
              "catalogMatch": "exact",
              "extracted": {},
              "candidates": []
            }
            """.trimIndent(),
        )

        assertEquals("request-1", response.requestId)
        val payload = json.encodeToString(
            CreateItemRequest(
                typeId = 42,
                identificationRequestId = response.requestId,
            ),
        )
        assertTrue(payload.contains("\"identificationRequestId\":\"request-1\""))
    }

    @Test
    fun decodesItemPhotoAndValuationChanges() {
        val response = json.decodeFromString<CollectionSyncResponse>(
            """
            {
              "changes": [
                {
                  "seq": "41", "entityKind": "item", "entityId": "item-1",
                  "itemId": "item-1", "operation": "upsert", "changedAt": "2026-09-05T00:00:00Z",
                  "clientMutationId": "local-item-12345678",
                  "item": {
                    "id": "item-1", "version": 7, "identificationStatus": "linked",
                    "status": "active", "createdAt": "2026-09-05T00:00:00Z",
                    "updatedAt": "2026-09-05T00:00:00Z"
                  }
                },
                {
                  "seq": "42", "entityKind": "photo", "entityId": "photo-1",
                  "itemId": "item-1", "operation": "upsert", "changedAt": "2026-09-05T00:00:01Z",
                  "photo": {
                    "id": "photo-1", "itemId": "item-1", "side": "obverse",
                    "mimeType": "image/jpeg", "byteSize": 123, "status": "ready",
                    "sortOrder": 0, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "itemVersion": 8, "originalUrl": "https://example.test/photo",
                    "displayUrl": "https://example.test/photo-display",
                    "originalUrlExpiresAt": "2026-09-05T01:00:00Z",
                    "createdAt": "2026-09-05T00:00:00Z", "updatedAt": "2026-09-05T00:00:01Z"
                  }
                },
                {
                  "seq": "43", "entityKind": "valuation", "entityId": "valuation-1",
                  "itemId": "item-1", "operation": "upsert", "changedAt": "2026-09-05T00:00:02Z",
                  "valuation": {
                    "id": "valuation-1", "status": "calculated",
                    "calculatedAt": "2026-09-05T00:00:02Z"
                  }
                }
              ],
              "nextCursor": "eyJzZXEiOiI0MyJ9",
              "hasMore": false
            }
            """.trimIndent(),
        )

        assertEquals(3, response.changes.size)
        assertEquals(7L, response.changes[0].item?.version)
        assertEquals("local-item-12345678", response.changes[0].clientMutationId)
        assertEquals(8L, response.changes[1].photo?.itemVersion)
        assertEquals(123L, response.changes[1].photo?.byteSize)
        assertEquals("https://example.test/photo-display", response.changes[1].photo?.displayUrl)
        assertTrue(response.changes[2].valuation != null)
        assertEquals("eyJzZXEiOiI0MyJ9", response.nextCursor)
    }

    @Test
    fun decodesDeleteWithoutEntityPayload() {
        val response = json.decodeFromString<CollectionSyncResponse>(
            """
            {
              "changes": [{
                "seq": "44", "entityKind": "photo", "entityId": "photo-1",
                "itemId": "item-1", "operation": "delete", "changedAt": "2026-09-05T00:00:03Z"
              }],
              "nextCursor": "eyJzZXEiOiI0NCJ9", "hasMore": false
            }
            """.trimIndent(),
        )

        assertEquals("delete", response.changes.single().operation)
        assertEquals(null, response.changes.single().photo)
    }

    @Test
    fun prefersDisplayPhotoAndKeepsOriginalFallbackCompatible() {
        val base = CollectionPhoto(
            id = "photo-1",
            itemId = "item-1",
            side = "obverse",
            mimeType = "image/jpeg",
            byteSize = 3_400_000,
            status = "ready",
            sortOrder = 0,
            sha256 = "a".repeat(64),
            itemVersion = 8,
            originalUrl = "https://example.test/original",
            createdAt = "2026-09-05T00:00:00Z",
            updatedAt = "2026-09-05T00:00:01Z",
        )

        val display = syncPhotoDownload(base.copy(displayUrl = "https://example.test/display"))
        assertEquals("https://example.test/display", display.url)
        assertEquals(false, display.verifiesOriginal)

        val original = syncPhotoDownload(base)
        assertEquals("https://example.test/original", original.url)
        assertEquals(true, original.verifiesOriginal)
        assertEquals(3_400_000L, original.expectedOriginalSize)
        assertEquals("a".repeat(64), original.expectedOriginalSha256)
    }

    @Test
    fun rejectsUnknownEventBeforeApplication() {
        val page = CollectionSyncResponse(
            changes = listOf(
                CollectionSyncChange(
                    seq = "45",
                    entityKind = "future-kind",
                    entityId = "entity-1",
                    itemId = "item-1",
                    operation = "upsert",
                    changedAt = "2026-09-05T00:00:04Z",
                ),
            ),
            nextCursor = "eyJzZXEiOiI0NSJ9",
            hasMore = false,
        )

        assertThrows(IllegalArgumentException::class.java) {
            validateCollectionSyncPage(page)
        }
    }

    @Test
    fun deleteDuringNetworkOperationSurvivesOldAcknowledgement() {
        assertEquals(
            DirtyState.DELETE,
            dirtyStateAfterAcknowledgement(
                current = DirtyState.DELETE,
                currentRevision = 12,
                expectedRevision = 11,
            ),
        )
    }

    @Test
    fun editDuringNetworkOperationRemainsPending() {
        assertEquals(
            DirtyState.UPDATE,
            dirtyStateAfterAcknowledgement(
                current = DirtyState.UPDATE,
                currentRevision = 8,
                expectedRevision = 7,
            ),
        )
        assertEquals(
            DirtyState.CLEAN,
            dirtyStateAfterAcknowledgement(
                current = DirtyState.UPDATE,
                currentRevision = 8,
                expectedRevision = 8,
            ),
        )
    }
}
