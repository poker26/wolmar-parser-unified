package ru.begemot26.numismat.data

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MarketEvidenceModelsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun decodesMarketEvidenceWithoutMixingCurrencyOrSpecimenProfile() {
        val response = json.decodeFromString<MarketEvidenceResponse>(
            """
            {
              "market": {
                "issue": {
                  "typeId": 17558,
                  "name": "150 рублей. Бот Святой Гавриил",
                  "year": 1990,
                  "metal": "Pt"
                },
                "specimen": {
                  "gradeCode": "PF",
                  "slabStatus": "raw"
                },
                "activity": {
                  "confirmedSalesCount": 2,
                  "venuesCount": 2,
                  "lastConfirmedSaleAt": "2026-07-01",
                  "lastConfirmedSalePriceMinor": 11000000,
                  "lastConfirmedSaleCurrency": "RUB",
                  "exactGradeSalesCount": 2,
                  "exactSpecimenSalesCount": 1,
                  "marketEventsCount": 75
                },
                "gradeBuckets": [
                  {
                    "gradeCode": "PF",
                    "slabStatus": "raw",
                    "currency": "RUB",
                    "salesCount": 1,
                    "minPriceMinor": 9840000,
                    "medianPriceMinor": 9840000,
                    "maxPriceMinor": 9840000
                  },
                  {
                    "gradeCode": "PF69",
                    "slabStatus": "slabbed",
                    "gradingCompanyCode": "NGC",
                    "currency": "USD",
                    "salesCount": 1,
                    "minPriceMinor": 120000,
                    "medianPriceMinor": 120000,
                    "maxPriceMinor": 120000
                  }
                ],
                "events": [],
                "excludedEvidence": [{ "id": 99, "kind": "excluded" }],
                "metalFloor": {
                  "currency": "RUB",
                  "valueMinor": 6524280,
                  "metal": "Pt",
                  "pureWeightGrams": 15.534,
                  "pricePerGramMinor": 420000,
                  "priceDate": "2026-09-08"
                }
              }
            }
            """.trimIndent(),
        )

        val market = requireNotNull(response.market)
        assertEquals(1, market.activity.exactSpecimenSalesCount)
        assertEquals(75, market.activity.marketEventsCount)
        assertEquals("RUB", market.activity.lastConfirmedSaleCurrency)
        assertEquals(listOf("RUB", "USD"), market.gradeBuckets.map { it.currency })
        assertEquals("slabbed", market.gradeBuckets[1].slabStatus)
        assertEquals("NGC", market.gradeBuckets[1].gradingCompanyCode)
        assertEquals(6_524_280L, market.metalFloor?.valueMinor)
    }

    @Test
    fun decodesAnUnlinkedItemWithoutMarketEvidence() {
        val response = json.decodeFromString<MarketEvidenceResponse>("""{"market":null}""")
        assertNull(response.market)
    }
}
