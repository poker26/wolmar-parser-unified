package ru.begemot26.numismat.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import ru.begemot26.numismat.data.CollectionItem
import ru.begemot26.numismat.data.CollectionValuation

class CollectionSummaryTest {
    @Test
    fun `valuation totals include only active coins`() {
        val activeReady = coin(
            id = "active-ready",
            status = "active",
            valuation = valuation(medianMinor = 12_000, lowMinor = 10_000, highMinor = 14_000),
        )
        val activeFloor = coin(
            id = "active-floor",
            status = "active",
            valuation = valuation(medianMinor = null, valueFloorMinor = 7_000, status = "floor_only"),
        )
        val activeUnknown = coin(id = "active-unknown", status = "active")
        val sold = coin(
            id = "sold",
            status = "sold",
            valuation = valuation(medianMinor = 90_000, lowMinor = 80_000, highMinor = 100_000),
        )
        val archived = coin(
            id = "archived",
            status = "archived",
            valuation = valuation(medianMinor = 50_000, lowMinor = 40_000, highMinor = 60_000),
        )

        val result = summarizeLocalCollection(listOf(activeReady, activeFloor, activeUnknown, sold, archived))

        assertEquals(5, result.total)
        assertEquals(3, result.active)
        assertEquals(1, result.sold)
        assertEquals(1, result.archived)
        assertEquals(1, result.valuation.valuedCount)
        assertEquals(1, result.valuation.floorOnlyCount)
        assertEquals(2, result.valuation.coveredCount)
        assertEquals(1, result.valuation.unvaluedCount)
        assertEquals(12_000L, result.valuation.medianMinor)
        assertEquals(19_000L, result.valuation.conservativeTotalMinor)
    }

    private fun coin(
        id: String,
        status: String,
        valuation: CollectionValuation? = null,
    ) = CollectionItem(
        id = id,
        userLabel = id,
        identificationStatus = "unlinked",
        status = status,
        createdAt = "2026-09-11T00:00:00Z",
        updatedAt = "2026-09-11T00:00:00Z",
        valuation = valuation,
    )

    private fun valuation(
        medianMinor: Long?,
        lowMinor: Long? = null,
        highMinor: Long? = null,
        valueFloorMinor: Long? = null,
        status: String = "ready",
    ) = CollectionValuation(
        id = "valuation-${medianMinor ?: valueFloorMinor}",
        itemId = "item",
        lowMinor = lowMinor,
        medianMinor = medianMinor,
        highMinor = highMinor,
        valueFloorMinor = valueFloorMinor,
        status = status,
        calculatedAt = "2026-09-11T00:00:00Z",
    )
}
