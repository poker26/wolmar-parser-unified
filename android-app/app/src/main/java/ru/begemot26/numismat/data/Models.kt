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
data class CollectionItem(
    val id: String,
    val typeId: Long? = null,
    val typeName: String? = null,
    val userLabel: String? = null,
    val identificationStatus: String,
    val gradeSystem: String? = null,
    val gradeCode: String? = null,
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
) {
    val title: String get() = typeName ?: userLabel ?: "Монета без названия"
}

@Serializable
data class CollectionListResponse(
    val items: List<CollectionItem>,
    val nextCursor: String? = null,
)

@Serializable data class ItemResponse(val item: CollectionItem)

@Serializable
data class CreateItemRequest(
    val typeId: Long? = null,
    val userLabel: String? = null,
    val gradeSystem: String? = null,
    val gradeCode: String? = null,
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
