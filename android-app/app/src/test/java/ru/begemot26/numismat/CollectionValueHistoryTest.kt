package ru.begemot26.numismat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import ru.begemot26.numismat.data.CollectionValuePoint

class CollectionValueHistoryTest {
    @Test
    fun calculatesChangeAcrossStoredDays() {
        val trend = collectionValueTrend(listOf(point("2026-09-11", 100_000), point("2026-09-12", 112_000)))

        assertEquals(112_000L, trend?.currentMinor)
        assertEquals(12_000L, trend?.differenceMinor)
        assertEquals(12, trend?.differencePercent)
    }

    @Test
    fun keepsSingleDayWithoutInventingChange() {
        val trend = collectionValueTrend(listOf(point("2026-09-12", 100_000)))

        assertEquals(100_000L, trend?.currentMinor)
        assertNull(trend?.differenceMinor)
        assertNull(trend?.differencePercent)
    }

    private fun point(date: String, value: Long) = CollectionValuePoint(
        date = date,
        activeCount = 1,
        valuedCount = 1,
        floorOnlyCount = 0,
        unvaluedCount = 0,
        marketTotalMinor = value,
        floorOnlyTotalMinor = 0,
        conservativeTotalMinor = value,
        capturedAt = "${date}T12:00:00Z",
    )
}
