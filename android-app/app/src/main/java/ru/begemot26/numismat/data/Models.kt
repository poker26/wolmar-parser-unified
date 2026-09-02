package ru.begemot26.numismat.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class User(
    val id: String,
    val email: String,
    val displayName: String? = null,
)

@Serializable data class UserResponse(val user: User)
@Serializable data class LoginRequest(val email: String, val password: String)

@Serializable
data class ApiErrorEnvelope(val error: ApiError? = null)

@Serializable
data class ApiError(val code: String? = null, val message: String? = null)

@Serializable
data class CatalogType(
    val id: Long,
    @SerialName("name_full") val name: String,
    val year: Int? = null,
    @SerialName("year_start") val yearStart: Int? = null,
    @SerialName("year_end") val yearEnd: Int? = null,
    val country: String? = null,
    val metal: String? = null,
    @SerialName("bitkin_number") val bitkinNumber: String? = null,
    @SerialName("cbr_cat_num") val cbrNumber: String? = null,
    val passes: Int = 0,
    @SerialName("auction_med") val auctionMedian: Long? = null,
    @SerialName("market_med") val marketMedian: Long? = null,
    val thumb: String? = null,
)

@Serializable
data class IdentifiedFields(
    val country: String? = null,
    val denominationValue: String? = null,
    val denominationUnit: String? = null,
    val year: Int? = null,
    val metal: String? = null,
    val ruler: String? = null,
    val mint: String? = null,
    val confidence: Double? = null,
    val slabStatus: String = "unknown",
    val gradingCompanyCode: String? = null,
    val gradingCompanyRaw: String? = null,
    val gradeCode: String? = null,
    val gradeSource: String = "unknown",
    val slabCertificateNumber: String? = null,
)

@Serializable
data class IdentificationCandidate(
    val id: Long,
    val name: String,
    val country: String? = null,
    val year: Int? = null,
    val denomination: String? = null,
    val bitkinNumber: String? = null,
    val score: Double = 0.0,
    val issueId: Long? = null,
    val issueYear: Int? = null,
    val issueMatch: String? = null,
    val krauseReference: KrauseReference? = null,
    val krauseRange: KrauseRange? = null,
)

@Serializable
data class IdentificationResponse(
    val recognizedName: String? = null,
    val catalogMatch: String = "not_found",
    val extracted: IdentifiedFields,
    val candidates: List<IdentificationCandidate>,
)

@Serializable
data class CatalogSnapshot(
    val year: Int? = null,
    val country: String? = null,
    val era: String? = null,
    val metal: String? = null,
    val mint: String? = null,
    val imageUrl: String? = null,
    val cbrNumber: String? = null,
    val bitkinNumber: String? = null,
)

@Serializable
data class KrauseReference(
    val source: String = "scwc",
    val issueId: Long,
    val year: Int? = null,
    val yearLabel: String? = null,
    val mint: String? = null,
    val variety: String? = null,
    val mintage: Long? = null,
    val currency: String = "USD",
    val publicationYear: Int? = null,
    val basisGradeCode: String? = null,
    val basisAmountMinor: Long? = null,
    val uncirculatedLowMinor: Long? = null,
    val uncirculatedHighMinor: Long? = null,
    val prices: Map<String, Long> = emptyMap(),
    val refPdfSrc: String? = null,
    val refPdfPage: Int? = null,
)

@Serializable
data class KrauseRange(
    val source: String = "scwc",
    val year: Int? = null,
    val currency: String = "USD",
    val publicationYear: Int? = null,
    val variantCount: Int,
    val basisGradeCode: String,
    val lowMinor: Long,
    val highMinor: Long,
)

@Serializable
data class CollectionItem(
    val id: String,
    val typeId: Long? = null,
    val issueId: Long? = null,
    val identifiedYear: Int? = null,
    val typeName: String? = null,
    val userLabel: String? = null,
    val identificationStatus: String,
    val gradeSystem: String? = null,
    val gradeCode: String? = null,
    val slabStatus: String = "unknown",
    val gradingCompanyCode: String? = null,
    val gradingCompanyRaw: String? = null,
    val gradeSource: String = "unknown",
    val slabCertificateNumber: String? = null,
    val purchasePriceMinor: Long? = null,
    val purchaseCurrency: String? = null,
    val purchaseDate: String? = null,
    val purchaseSource: String? = null,
    val notes: String? = null,
    val status: String,
    val soldPriceMinor: Long? = null,
    val soldCurrency: String? = null,
    val soldAt: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val catalog: CatalogSnapshot? = null,
    val krauseReference: KrauseReference? = null,
    val krauseRange: KrauseRange? = null,
    val valuation: CollectionValuation? = null,
) {
    val title: String get() = typeName ?: userLabel ?: "Монета без названия"
}

@Serializable
data class CollectionValuation(
    val id: String,
    val itemId: String? = null,
    val currency: String = "RUB",
    val lowMinor: Long? = null,
    val medianMinor: Long? = null,
    val highMinor: Long? = null,
    val gradeCode: String? = null,
    val comparableCount: Int = 0,
    val confidence: Double? = null,
    val status: String,
    val method: String? = null,
    val modelVersion: String? = null,
    val abstainReason: String? = null,
    val estimateKind: String = "none",
    val rangeAvailable: Boolean = false,
    val calculatedAt: String,
)

@Serializable
data class ValuationResponse(
    val status: String,
    val valuation: CollectionValuation? = null,
)

@Serializable data class ValuationHistoryResponse(val valuations: List<CollectionValuation>)

@Serializable
data class ValuationRecalculateResponse(
    val status: String,
    val valuation: CollectionValuation,
)

@Serializable
data class CollectionListResponse(
    val items: List<CollectionItem>,
    val nextCursor: String? = null,
)

@Serializable
data class CollectionValuationSummary(
    val currency: String = "RUB",
    val valuedCount: Int = 0,
    val unvaluedCount: Int = 0,
    val lowMinor: Long? = null,
    val medianMinor: Long? = null,
    val highMinor: Long? = null,
    val rangeAvailable: Boolean = false,
)

@Serializable
data class CollectionSummary(
    val total: Int,
    val active: Int,
    val sold: Int,
    val archived: Int,
    val unlinked: Int,
    val distinctTypes: Int,
    val duplicates: Int,
    val valuation: CollectionValuationSummary,
)

@Serializable data class ItemResponse(val item: CollectionItem)

@Serializable
data class CreateItemRequest(
    val typeId: Long? = null,
    val issueId: Long? = null,
    val identifiedYear: Int? = null,
    val userLabel: String? = null,
    val gradeSystem: String? = null,
    val gradeCode: String? = null,
    val slabStatus: String = "unknown",
    val gradingCompanyCode: String? = null,
    val gradeSource: String = "unknown",
    val slabCertificateNumber: String? = null,
    val purchasePriceMinor: Long? = null,
    val purchaseCurrency: String? = null,
    val purchaseDate: String? = null,
    val purchaseSource: String? = null,
    val notes: String? = null,
)

@Serializable
data class MarkSoldRequest(
    val soldPriceMinor: Long? = null,
    val soldCurrency: String? = null,
    val soldAt: String? = null,
)

@Serializable
data class CollectionPhoto(
    val id: String,
    val itemId: String,
    val side: String,
    val mimeType: String,
    val byteSize: Long,
    val width: Int? = null,
    val height: Int? = null,
    val status: String,
    val sortOrder: Int,
    val errorCode: String? = null,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable data class PhotoListResponse(val photos: List<CollectionPhoto>)
@Serializable data class PhotoResponse(val photo: CollectionPhoto)

@Serializable
data class PhotoUploadIntentRequest(
    val side: String,
    val mimeType: String,
    val byteSize: Int,
)

@Serializable
data class PhotoUploadTarget(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val expiresAt: String,
)

@Serializable
data class PhotoUploadIntentResponse(
    val photo: CollectionPhoto,
    val upload: PhotoUploadTarget,
)

@Serializable data class PhotoCompleteRequest(val photoId: String)
@Serializable data class PhotoUrlResponse(val url: String, val expiresAt: String)

@Serializable data class PasswordConfirmationRequest(val password: String)

@Serializable
data class CollectionExport(
    val id: String,
    val status: String,
    val byteSize: Long? = null,
    val sha256: String? = null,
    val itemCount: Int? = null,
    val photoCount: Int? = null,
    val errorCode: String? = null,
    val expiresAt: String? = null,
    val createdAt: String,
    val completedAt: String? = null,
)

@Serializable data class ExportCreateResponse(val export: CollectionExport, val created: Boolean)

@Serializable
data class ExportDownload(
    val url: String,
    val expiresAt: String,
    val fileName: String,
)

@Serializable
data class ExportStatusResponse(
    val export: CollectionExport,
    val download: ExportDownload? = null,
)

@Serializable
data class AccountDeletionResponse(
    val deletionId: String,
    val status: String,
    val executeAt: String,
)
