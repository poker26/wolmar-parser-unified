package ru.begemot26.numismat.ui

import ru.begemot26.numismat.data.CollectionValuation
import java.math.BigDecimal
import java.math.RoundingMode

internal enum class SaleReferenceKind { MARKET, METAL_FLOOR }

internal data class SoldCoinComparison(
    val purchaseMinor: Long?,
    val saleMinor: Long?,
    val referenceMinor: Long?,
    val referenceKind: SaleReferenceKind?,
    val referenceDate: String?,
) {
    val differenceFromPurchaseMinor: Long?
        get() = purchaseMinor?.let { purchase -> saleMinor?.minus(purchase) }

    val differenceFromReferenceMinor: Long?
        get() = referenceMinor?.let { reference -> saleMinor?.minus(reference) }
}

internal fun soldCoinComparison(
    purchaseRubles: String,
    saleRubles: String,
    soldDate: String,
    currentValuation: CollectionValuation?,
    valuationHistory: List<CollectionValuation>,
): SoldCoinComparison {
    val reference = (listOfNotNull(currentValuation) + valuationHistory)
        .distinctBy { it.id }
        .filter { valuation ->
            (valuation.status == "ready" && valuation.medianMinor != null) ||
                (valuation.status == "floor_only" && valuation.valueFloorMinor != null)
        }
        .filter { valuation -> soldDate.isBlank() || valuation.calculatedAt.take(10) <= soldDate }
        .maxByOrNull { it.calculatedAt }

    val referenceMinor = reference?.medianMinor ?: reference?.valueFloorMinor
    val referenceKind = when {
        reference?.medianMinor != null -> SaleReferenceKind.MARKET
        reference?.valueFloorMinor != null -> SaleReferenceKind.METAL_FLOOR
        else -> null
    }

    return SoldCoinComparison(
        purchaseMinor = parseRublesToMinor(purchaseRubles),
        saleMinor = parseRublesToMinor(saleRubles),
        referenceMinor = referenceMinor,
        referenceKind = referenceKind,
        referenceDate = reference?.calculatedAt?.take(10),
    )
}

internal fun parseRublesToMinor(value: String): Long? {
    if (value.isBlank()) return null
    return runCatching {
        BigDecimal(value.trim().replace(',', '.'))
            .movePointRight(2)
            .setScale(0, RoundingMode.HALF_UP)
            .longValueExact()
            .also { require(it >= 0) }
    }.getOrNull()
}
