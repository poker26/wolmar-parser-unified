package ru.begemot26.numismat.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import ru.begemot26.numismat.data.CollectionValuation

class SoldCoinComparisonTest {
    @Test
    fun `uses latest valuation no later than sale date`() {
        val result = soldCoinComparison(
            purchaseRubles = "1000",
            saleRubles = "1750,50",
            soldDate = "2026-09-10",
            currentValuation = valuation("after", 200_000, "2026-09-11T08:00:00Z"),
            valuationHistory = listOf(
                valuation("older", 140_000, "2026-09-08T08:00:00Z"),
                valuation("eligible", 160_000, "2026-09-10T07:00:00Z"),
            ),
        )

        assertEquals(100_000L, result.purchaseMinor)
        assertEquals(175_050L, result.saleMinor)
        assertEquals(160_000L, result.referenceMinor)
        assertEquals(SaleReferenceKind.MARKET, result.referenceKind)
        assertEquals("2026-09-10", result.referenceDate)
        assertEquals(75_050L, result.differenceFromPurchaseMinor)
        assertEquals(15_050L, result.differenceFromReferenceMinor)
    }

    @Test
    fun `uses metal floor when market estimate is unavailable`() {
        val floor = CollectionValuation(
            id = "floor",
            status = "floor_only",
            valueFloorMinor = 90_000,
            calculatedAt = "2026-09-09T12:00:00Z",
        )

        val result = soldCoinComparison("", "1200", "2026-09-10", floor, emptyList())

        assertNull(result.purchaseMinor)
        assertEquals(120_000L, result.saleMinor)
        assertEquals(90_000L, result.referenceMinor)
        assertEquals(SaleReferenceKind.METAL_FLOOR, result.referenceKind)
        assertEquals(30_000L, result.differenceFromReferenceMinor)
    }

    @Test
    fun `does not use valuation calculated after sale`() {
        val result = soldCoinComparison(
            purchaseRubles = "500",
            saleRubles = "",
            soldDate = "2026-09-10",
            currentValuation = valuation("after", 60_000, "2026-09-11T00:00:00Z"),
            valuationHistory = emptyList(),
        )

        assertEquals(50_000L, result.purchaseMinor)
        assertNull(result.saleMinor)
        assertNull(result.referenceMinor)
        assertNull(result.differenceFromPurchaseMinor)
    }

    private fun valuation(id: String, medianMinor: Long, calculatedAt: String) = CollectionValuation(
        id = id,
        status = "ready",
        medianMinor = medianMinor,
        calculatedAt = calculatedAt,
    )
}
