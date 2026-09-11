package ru.begemot26.numismat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import ru.begemot26.numismat.data.CollectionItem
import ru.begemot26.numismat.data.CollectionValuation

class CollectionPerformanceTest {
    @Test
    fun `compares only active coins with purchase and market values`() {
        val items = listOf(
            coin("both", "active", 100_000, market(150_000)),
            coin("purchase-only", "active", 50_000, null),
            coin("floor", "active", 70_000, floor(80_000)),
            coin("market-only", "active", null, market(200_000)),
            coin("sold", "sold", 10_000, market(90_000)),
        )

        val result = summarizeCollectionPerformance(items)

        assertEquals(4, result.activeCount)
        assertEquals(3, result.purchaseKnownCount)
        assertEquals(220_000L, result.purchaseTotalMinor)
        assertEquals(1, result.comparableCount)
        assertEquals(100_000L, result.comparablePurchaseMinor)
        assertEquals(150_000L, result.comparableMarketMinor)
        assertEquals(50_000L, result.differenceMinor)
        assertEquals(50, result.differencePercent)
    }

    @Test
    fun `returns no totals when purchase prices are absent`() {
        val result = summarizeCollectionPerformance(listOf(coin("coin", "active", null, market(100_000))))

        assertEquals(1, result.activeCount)
        assertEquals(0, result.purchaseKnownCount)
        assertNull(result.purchaseTotalMinor)
        assertNull(result.differenceMinor)
        assertNull(result.differencePercent)
    }

    private fun coin(
        id: String,
        status: String,
        purchaseMinor: Long?,
        valuation: CollectionValuation?,
    ) = CollectionItem(
        id = id,
        userLabel = id,
        identificationStatus = "unlinked",
        purchasePriceMinor = purchaseMinor,
        purchaseCurrency = purchaseMinor?.let { "RUB" },
        status = status,
        createdAt = "2026-09-11T00:00:00Z",
        updatedAt = "2026-09-11T00:00:00Z",
        valuation = valuation,
    )

    private fun market(valueMinor: Long) = CollectionValuation(
        id = "market-$valueMinor",
        status = "ready",
        medianMinor = valueMinor,
        calculatedAt = "2026-09-11T00:00:00Z",
    )

    private fun floor(valueMinor: Long) = CollectionValuation(
        id = "floor-$valueMinor",
        status = "floor_only",
        valueFloorMinor = valueMinor,
        calculatedAt = "2026-09-11T00:00:00Z",
    )
}
