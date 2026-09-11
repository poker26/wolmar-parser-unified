package ru.begemot26.numismat

import org.junit.Assert.assertEquals
import org.junit.Test
import ru.begemot26.numismat.data.CollectionItem

class CollectionShelfTest {
    @Test
    fun keepsEveryCollectionStatusReachable() {
        val items = listOf(
            item("active", "active"),
            item("sold", "sold"),
            item("archived", "archived"),
        )

        assertEquals(listOf("active"), collectionShelfItems(items, CollectionShelf.ACTIVE).map { it.id })
        assertEquals(listOf("sold"), collectionShelfItems(items, CollectionShelf.SOLD).map { it.id })
        assertEquals(listOf("archived"), collectionShelfItems(items, CollectionShelf.ARCHIVED).map { it.id })
    }

    private fun item(id: String, status: String) = CollectionItem(
        id = id,
        identificationStatus = "unlinked",
        status = status,
        createdAt = "2026-09-11T00:00:00Z",
        updatedAt = "2026-09-11T00:00:00Z",
    )
}
