package ru.begemot26.numismat

import org.junit.Assert.assertEquals
import org.junit.Test
import ru.begemot26.numismat.data.CollectionItem
import ru.begemot26.numismat.data.CollectionValuation

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

    @Test
    fun sortsUnknownYearsAndValuesAfterKnownOnes() {
        val items = listOf(
            item("unknown", "active"),
            item("older", "active", year = 1990, value = 10_000),
            item("newer", "active", year = 2024, value = 5_000),
        )

        assertEquals(
            listOf("newer", "older", "unknown"),
            sortedCollectionItems(items, CollectionSort.YEAR).map { it.id },
        )
        assertEquals(
            listOf("older", "newer", "unknown"),
            sortedCollectionItems(items, CollectionSort.VALUE).map { it.id },
        )
    }

    @Test
    fun sortsNewestAddedCoinFirst() {
        val items = listOf(
            item("first", "active", createdAt = "2026-09-10T00:00:00Z"),
            item("second", "active", createdAt = "2026-09-11T00:00:00Z"),
        )

        assertEquals(
            listOf("second", "first"),
            sortedCollectionItems(items, CollectionSort.ADDED).map { it.id },
        )
    }

    @Test
    fun groupsYearsIntoStableOverviewPeriods() {
        assertEquals("До 1800 года", collectionPeriod(1799))
        assertEquals("XIX век", collectionPeriod(1800))
        assertEquals("XIX век", collectionPeriod(1899))
        assertEquals("1900–1945", collectionPeriod(1945))
        assertEquals("1946–1991", collectionPeriod(1991))
        assertEquals("С 1992 года", collectionPeriod(1992))
    }

    private fun item(
        id: String,
        status: String,
        year: Int? = null,
        value: Long? = null,
        createdAt: String = "2026-09-11T00:00:00Z",
    ) = CollectionItem(
        id = id,
        identifiedYear = year,
        identificationStatus = "unlinked",
        status = status,
        createdAt = createdAt,
        updatedAt = "2026-09-11T00:00:00Z",
        valuation = value?.let {
            CollectionValuation(
                id = "valuation-$id",
                medianMinor = it,
                status = "ready",
                calculatedAt = "2026-09-11T00:00:00Z",
            )
        },
    )
}
