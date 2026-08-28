package ru.begemot26.numismat.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import ru.begemot26.numismat.BuildConfig
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

class ApiException(
    val status: Int,
    val errorCode: String? = null,
    override val message: String,
) : IOException(message)

class ApiClient(context: Context) {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }
    private val cookies = PersistentCookieJar(context.applicationContext)
    private val http = OkHttpClient.Builder()
        .cookieJar(cookies)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(130, TimeUnit.SECONDS)
        .build()
    private val baseUrl = BuildConfig.API_BASE_URL.trimEnd('/')
    private val mediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun login(email: String, password: String): User =
        execute<UserResponse>(
            Request.Builder()
                .url(url("/api/v1/auth/login"))
                .post(json.encodeToString(LoginRequest(email, password)).toRequestBody(mediaType))
                .build(),
        ).user

    suspend fun me(): User = execute<UserResponse>(
        Request.Builder().url(url("/api/v1/me")).get().build(),
    ).user

    suspend fun logout() {
        try {
            executeEmpty(mutation(Request.Builder().url(url("/api/v1/auth/logout"))).post(EMPTY_BODY).build())
        } finally {
            cookies.clear()
        }
    }

    suspend fun collection(): List<CollectionItem> = execute<CollectionListResponse>(
        Request.Builder().url(url("/api/v1/collection/items?limit=100")).get().build(),
    ).items

    suspend fun collectionSummary(): CollectionSummary = execute(
        Request.Builder().url(url("/api/v1/collection/summary")).get().build(),
    )

    suspend fun searchCatalog(query: String): List<CatalogType> {
        val encoded = okhttp3.HttpUrl.Builder()
            .scheme("https")
            .host("placeholder.invalid")
            .addPathSegments("api/coincat/types")
            .addQueryParameter("q", query.trim())
            .addQueryParameter("limit", "30")
            .addQueryParameter("sort", "passes")
            .build()
            .encodedQuery
        return execute(Request.Builder().url(url("/api/coincat/types?$encoded")).get().build())
    }

    suspend fun identify(images: List<Pair<String, ByteArray>>): IdentificationResponse {
        require(images.size in 1..2) { "Нужна одна или две фотографии" }
        require(images.sumOf { it.second.size.toLong() } <= MAX_IDENTIFY_BYTES) {
            "Фотографии больше 12 МБ"
        }
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            images.forEachIndexed { index, image ->
                addFormDataPart(
                    "images",
                    "coin-${index + 1}.${extensionFor(image.first)}",
                    image.second.toRequestBody(image.first.toMediaType()),
                )
            }
        }.build()
        return execute(
            mutation(Request.Builder().url(url("/api/v1/collection/identify")))
                .post(body)
                .build(),
        )
    }

    suspend fun valuation(itemId: String): ValuationResponse = execute(
        Request.Builder().url(url("/api/v1/collection/items/$itemId/valuation")).get().build(),
    )

    suspend fun valuationHistory(itemId: String): List<CollectionValuation> =
        execute<ValuationHistoryResponse>(
            Request.Builder().url(url("/api/v1/collection/items/$itemId/valuations?limit=10")).get().build(),
        ).valuations

    suspend fun recalculateValuation(itemId: String): ValuationRecalculateResponse = execute(
        mutation(Request.Builder().url(url("/api/v1/collection/items/$itemId/valuation/recalculate")))
            .post(EMPTY_BODY)
            .build(),
    )

    suspend fun create(input: CreateItemRequest): CollectionItem = execute<ItemResponse>(
        mutation(Request.Builder().url(url("/api/v1/collection/items")))
            .header("Idempotency-Key", UUID.randomUUID().toString())
            .post(json.encodeToString(input).toRequestBody(mediaType))
            .build(),
    ).item

    suspend fun update(id: String, changes: JsonObject): CollectionItem = execute<ItemResponse>(
        mutation(Request.Builder().url(url("/api/v1/collection/items/$id")))
            .patch(changes.toString().toRequestBody(mediaType))
            .build(),
    ).item

    suspend fun markSold(id: String, input: MarkSoldRequest): CollectionItem = execute<ItemResponse>(
        mutation(Request.Builder().url(url("/api/v1/collection/items/$id/sold")))
            .post(json.encodeToString(input).toRequestBody(mediaType))
            .build(),
    ).item

    suspend fun activate(id: String): CollectionItem = execute<ItemResponse>(
        mutation(Request.Builder().url(url("/api/v1/collection/items/$id/activate")))
            .post(EMPTY_BODY)
            .build(),
    ).item

    suspend fun delete(id: String) {
        executeEmpty(
            mutation(Request.Builder().url(url("/api/v1/collection/items/$id")))
                .delete()
                .build(),
        )
    }

    suspend fun photos(itemId: String): List<CollectionPhoto> = execute<PhotoListResponse>(
        Request.Builder().url(url("/api/v1/collection/items/$itemId/photos")).get().build(),
    ).photos

    suspend fun uploadPhoto(itemId: String, side: String, mimeType: String, bytes: ByteArray): CollectionPhoto {
        val intent = execute<PhotoUploadIntentResponse>(
            mutation(Request.Builder().url(url("/api/v1/collection/items/$itemId/photos/upload-intent")))
                .post(
                    json.encodeToString(
                        PhotoUploadIntentRequest(side, mimeType, bytes.size),
                    ).toRequestBody(mediaType),
                )
                .build(),
        )
        val uploadType = mimeType.toMediaType()
        withContext(Dispatchers.IO) {
            http.newCall(
                Request.Builder()
                    .url(intent.upload.url)
                    .put(bytes.toRequestBody(uploadType))
                    .build(),
            ).execute().use { response ->
                if (!response.isSuccessful) throw IOException("Photo upload failed: ${response.code}")
            }
        }
        return execute<PhotoResponse>(
            mutation(Request.Builder().url(url("/api/v1/collection/items/$itemId/photos/complete")))
                .post(
                    json.encodeToString(PhotoCompleteRequest(intent.photo.id)).toRequestBody(mediaType),
                )
                .build(),
        ).photo
    }

    suspend fun photoUrl(photoId: String): String = execute<PhotoUrlResponse>(
        Request.Builder().url(url("/api/v1/collection/photos/$photoId/url")).get().build(),
    ).url

    suspend fun deletePhoto(photoId: String) {
        executeEmpty(
            mutation(Request.Builder().url(url("/api/v1/collection/photos/$photoId")))
                .delete()
                .build(),
        )
    }

    suspend fun requestExport(password: String): ExportCreateResponse = execute(
        mutation(Request.Builder().url(url("/api/v1/collection/exports")))
            .post(json.encodeToString(PasswordConfirmationRequest(password)).toRequestBody(mediaType))
            .build(),
    )

    suspend fun exportStatus(exportId: String): ExportStatusResponse = execute(
        Request.Builder().url(url("/api/v1/collection/exports/$exportId")).get().build(),
    )

    suspend fun deleteAccount(password: String): AccountDeletionResponse {
        val result: AccountDeletionResponse = execute(
            mutation(Request.Builder().url(url("/api/v1/account/deletion")))
                .post(json.encodeToString(PasswordConfirmationRequest(password)).toRequestBody(mediaType))
                .build(),
        )
        cookies.clear()
        return result
    }

    private fun mutation(builder: Request.Builder): Request.Builder {
        val csrf = cookies.value("__Host-wolmar_csrf") ?: cookies.value("wolmar_csrf")
        if (csrf != null) builder.header("X-CSRF-Token", csrf)
        return builder
    }

    private fun url(path: String) = "$baseUrl/${path.trimStart('/')}"

    private suspend inline fun <reified T> execute(request: Request): T = withContext(Dispatchers.IO) {
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw apiError(response.code, body)
            json.decodeFromString<T>(body)
        }
    }

    private suspend fun executeEmpty(request: Request) = withContext(Dispatchers.IO) {
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw apiError(response.code, body)
        }
    }

    private fun apiError(status: Int, body: String): ApiException {
        val parsed = runCatching { json.decodeFromString<ApiErrorEnvelope>(body).error }.getOrNull()
        val message = when (parsed?.code) {
            "reauthentication_failed" -> "Неверный пароль"
            "rate_limited" -> "Слишком много попыток. Попробуйте позже"
            "export_queue_unavailable" -> "Экспорт временно недоступен"
            "deletion_queue_unavailable" -> "Удаление аккаунта временно недоступно"
            "recognition_unavailable" -> "Распознавание временно недоступно"
            "recognition_failed", "invalid_recognition_response" -> "Не удалось распознать монету"
            "image_too_large" -> "Фотография слишком большая"
            "unsupported_image_type" -> "Формат фотографии не поддерживается"
            else -> parsed?.message
        } ?: when (status) {
            401 -> "Неверная почта или пароль"
            403 -> "Сервер не разрешил доступ"
            else -> "Ошибка сервера: $status"
        }
        return ApiException(status, parsed?.code, message)
    }

    private fun extensionFor(mimeType: String): String = when (mimeType) {
        "image/png" -> "png"
        "image/webp" -> "webp"
        "image/heic" -> "heic"
        "image/heif" -> "heif"
        else -> "jpg"
    }

    private companion object {
        val EMPTY_BODY = ByteArray(0).toRequestBody(null)
        const val MAX_IDENTIFY_BYTES = 12L * 1024 * 1024
    }
}
