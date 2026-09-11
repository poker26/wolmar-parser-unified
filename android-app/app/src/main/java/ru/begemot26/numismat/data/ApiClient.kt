package ru.begemot26.numismat.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import ru.begemot26.numismat.BuildConfig
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

class ApiException(
    val status: Int,
    val errorCode: String? = null,
    val currentVersion: Long? = null,
    val currentItem: CollectionItem? = null,
    val resetRequired: Boolean = false,
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

    fun clearSession() = cookies.clear()

    suspend fun collectionPage(cursor: String? = null): CollectionListResponse {
        val query = okhttp3.HttpUrl.Builder()
            .scheme("https")
            .host("placeholder.invalid")
            .addPathSegments("api/v1/collection/items")
            .addQueryParameter("limit", "100")
            .apply { if (cursor != null) addQueryParameter("cursor", cursor) }
            .build()
            .encodedQuery
        return execute(Request.Builder().url(url("/api/v1/collection/items?$query")).get().build())
    }

    suspend fun collection(): List<CollectionItem> {
        val result = mutableListOf<CollectionItem>()
        var cursor: String? = null
        do {
            val page = collectionPage(cursor)
            result += page.items
            cursor = page.nextCursor
        } while (cursor != null)
        return result
    }

    suspend fun collectionSync(cursor: String?, limit: Int = 200): CollectionSyncResponse {
        require(limit in 1..500)
        val query = okhttp3.HttpUrl.Builder()
            .scheme("https")
            .host("placeholder.invalid")
            .addPathSegments("api/v1/collection/sync")
            .addQueryParameter("limit", limit.toString())
            .apply { if (cursor != null) addQueryParameter("cursor", cursor) }
            .build()
            .encodedQuery
        return execute(Request.Builder().url(url("/api/v1/collection/sync?$query")).get().build())
    }

    suspend fun collectionSummary(): CollectionSummary = execute(
        Request.Builder().url(url("/api/v1/collection/summary")).get().build(),
    )

    suspend fun item(id: String): CollectionItem = execute<ItemResponse>(
        Request.Builder().url(url("/api/v1/collection/items/$id")).get().build(),
    ).item

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

    suspend fun identify(images: List<Pair<String, File>>): IdentificationResponse {
        require(images.size in 1..2) { "Нужна одна или две фотографии" }
        require(images.sumOf { it.second.length() } <= MAX_IDENTIFY_BYTES) {
            "Фотографии больше 12 МБ"
        }
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            images.forEachIndexed { index, image ->
                addFormDataPart(
                    "images",
                    "coin-${index + 1}.${extensionFor(image.first)}",
                    image.second.asRequestBody(image.first.toMediaType()),
                )
            }
        }.build()
        return execute(
            mutation(Request.Builder().url(url("/api/v1/collection/identify")))
                .post(body)
                .build(),
        )
    }

    suspend fun claimIdentificationPhotos(sessionId: String, itemId: String) {
        executeEmpty(
            mutation(Request.Builder().url(url("/api/v1/collection/identifications/$sessionId/claim")))
                .post(buildJsonObject { put("itemId", itemId) }.toString().toRequestBody(mediaType))
                .build(),
        )
    }

    suspend fun saveIdentifiedItem(sessionId: String, input: CreateItemRequest): CollectionItem =
        execute<ItemResponse>(
            mutation(Request.Builder().url(url("/api/v1/collection/identifications/$sessionId/save")))
                .post(json.encodeToString(input).toRequestBody(mediaType))
                .build(),
        ).item

    suspend fun discardIdentificationPhotos(sessionId: String) {
        executeEmpty(
            mutation(Request.Builder().url(url("/api/v1/collection/identifications/$sessionId")))
                .delete()
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

    suspend fun marketEvidence(itemId: String): MarketEvidence? =
        execute<MarketEvidenceResponse>(
            Request.Builder().url(url("/api/v1/collection/items/$itemId/market")).get().build(),
        ).market

    suspend fun recalculateValuation(itemId: String): ValuationRecalculateResponse = execute(
        mutation(Request.Builder().url(url("/api/v1/collection/items/$itemId/valuation/recalculate")))
            .post(EMPTY_BODY)
            .build(),
    )

    suspend fun create(input: CreateItemRequest, idempotencyKey: String = UUID.randomUUID().toString()): CollectionItem = execute<ItemResponse>(
        mutation(Request.Builder().url(url("/api/v1/collection/items")))
            .header("Idempotency-Key", idempotencyKey)
            .post(json.encodeToString(input).toRequestBody(mediaType))
            .build(),
    ).item

    suspend fun update(id: String, changes: JsonObject, expectedVersion: Long): CollectionItem = execute<ItemResponse>(
        mutation(Request.Builder().url(url("/api/v1/collection/items/$id")))
            .header("If-Match", quotedVersion(expectedVersion))
            .patch(changes.toString().toRequestBody(mediaType))
            .build(),
    ).item

    suspend fun markSold(id: String, input: MarkSoldRequest, expectedVersion: Long): CollectionItem = execute<ItemResponse>(
        mutation(Request.Builder().url(url("/api/v1/collection/items/$id/sold")))
            .header("If-Match", quotedVersion(expectedVersion))
            .post(json.encodeToString(input).toRequestBody(mediaType))
            .build(),
    ).item

    suspend fun archive(id: String, expectedVersion: Long): CollectionItem = execute<ItemResponse>(
        mutation(Request.Builder().url(url("/api/v1/collection/items/$id/archive")))
            .header("If-Match", quotedVersion(expectedVersion))
            .post(EMPTY_BODY)
            .build(),
    ).item

    suspend fun activate(id: String, expectedVersion: Long): CollectionItem = execute<ItemResponse>(
        mutation(Request.Builder().url(url("/api/v1/collection/items/$id/activate")))
            .header("If-Match", quotedVersion(expectedVersion))
            .post(EMPTY_BODY)
            .build(),
    ).item

    suspend fun delete(id: String, expectedVersion: Long) {
        executeEmpty(
            mutation(Request.Builder().url(url("/api/v1/collection/items/$id")))
                .header("If-Match", quotedVersion(expectedVersion))
                .delete()
                .build(),
        )
    }

    suspend fun photos(itemId: String): List<CollectionPhoto> = execute<PhotoListResponse>(
        Request.Builder().url(url("/api/v1/collection/items/$itemId/photos")).get().build(),
    ).photos

    suspend fun uploadPhoto(
        itemId: String,
        side: String,
        mimeType: String,
        file: File,
        sortOrder: Int? = null,
        expectedVersion: Long,
    ): CollectionPhoto {
        require(file.isFile) { "Local photo does not exist" }
        require(file.length() in 1..Int.MAX_VALUE.toLong()) { "Invalid local photo size" }
        val intent = execute<PhotoUploadIntentResponse>(
            mutation(Request.Builder().url(url("/api/v1/collection/items/$itemId/photos/upload-intent")))
                .header("If-Match", quotedVersion(expectedVersion))
                .post(
                    json.encodeToString(
                        PhotoUploadIntentRequest(side, mimeType, file.length().toInt(), sortOrder),
                    ).toRequestBody(mediaType),
                )
                .build(),
        )
        val uploadType = mimeType.toMediaType()
        withContext(Dispatchers.IO) {
            http.newCall(
                Request.Builder()
                    .url(intent.upload.url)
                    .put(file.asRequestBody(uploadType))
                    .build(),
            ).execute().use { response ->
                if (!response.isSuccessful) throw IOException("Photo upload failed: ${response.code}")
            }
        }
        return execute<PhotoResponse>(
            mutation(Request.Builder().url(url("/api/v1/collection/items/$itemId/photos/complete")))
                .header("If-Match", quotedVersion(expectedVersion))
                .post(
                    json.encodeToString(PhotoCompleteRequest(intent.photo.id)).toRequestBody(mediaType),
                )
                .build(),
        ).photo
    }

    suspend fun photoUrl(photoId: String): String = execute<PhotoUrlResponse>(
        Request.Builder().url(url("/api/v1/collection/photos/$photoId/url")).get().build(),
    ).url

    suspend fun download(url: String, target: File, maxBytes: Long = MAX_PHOTO_DOWNLOAD_BYTES) =
        withContext(Dispatchers.IO) {
            require(maxBytes > 0)
            target.parentFile?.mkdirs()
            val temporary = File(target.parentFile, ".${target.name}.${UUID.randomUUID()}.part")
            try {
                http.newCall(Request.Builder().url(url).get().build()).execute().use { response ->
                    if (!response.isSuccessful) throw IOException("Photo download failed: ${response.code}")
                    val body = response.body ?: throw IOException("Photo download returned an empty body")
                    val declaredLength = body.contentLength()
                    if (declaredLength > maxBytes) throw IOException("Фотография слишком большая")
                    body.byteStream().use { input ->
                        FileOutputStream(temporary).use { output ->
                            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                            var copied = 0L
                            while (true) {
                                val count = input.read(buffer)
                                if (count < 0) break
                                copied += count
                                if (copied > maxBytes) throw IOException("Фотография слишком большая")
                                output.write(buffer, 0, count)
                            }
                            output.fd.sync()
                        }
                    }
                }
                if (!temporary.renameTo(target)) {
                    temporary.copyTo(target, overwrite = true)
                    temporary.delete()
                }
            } finally {
                temporary.delete()
            }
        }

    suspend fun downloadVerified(url: String, target: File, expectedSize: Long, expectedSha256: String) =
        withContext(Dispatchers.IO) {
            require(expectedSize >= 0)
            require(expectedSha256.matches(Regex("^[0-9a-fA-F]{64}$")))
            target.parentFile?.mkdirs()
            val temporary = File(target.parentFile, ".${target.name}.${UUID.randomUUID()}.part")
            try {
                val digest = MessageDigest.getInstance("SHA-256")
                var copied = 0L
                http.newCall(Request.Builder().url(url).get().build()).execute().use { response ->
                    if (!response.isSuccessful) throw IOException("Photo download failed: ${response.code}")
                    val body = response.body ?: throw IOException("Photo download returned an empty body")
                    body.byteStream().use { input ->
                        FileOutputStream(temporary).use { output ->
                            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                            while (true) {
                                val count = input.read(buffer)
                                if (count < 0) break
                                copied += count
                                if (copied > expectedSize) throw IOException("Размер фотографии не совпадает")
                                digest.update(buffer, 0, count)
                                output.write(buffer, 0, count)
                            }
                            output.fd.sync()
                        }
                    }
                }
                val actualSha256 = digest.digest().joinToString("") { "%02x".format(it) }
                if (copied != expectedSize || !actualSha256.equals(expectedSha256, ignoreCase = true)) {
                    throw IOException("Контрольная сумма фотографии не совпадает")
                }
                if (!temporary.renameTo(target)) {
                    temporary.copyTo(target, overwrite = true)
                    temporary.delete()
                }
            } finally {
                temporary.delete()
            }
        }

    suspend fun deletePhoto(photoId: String, expectedVersion: Long): Long {
        return executeEmptyVersion(
            mutation(Request.Builder().url(url("/api/v1/collection/photos/$photoId")))
                .header("If-Match", quotedVersion(expectedVersion))
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

    private suspend fun executeEmptyVersion(request: Request): Long = withContext(Dispatchers.IO) {
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw apiError(response.code, body)
            response.header("ETag")?.trim()?.removeSurrounding("\"")?.toLongOrNull()
                ?: throw IOException("Сервер не вернул версию монеты.")
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
        return ApiException(
            status = status,
            errorCode = parsed?.code,
            currentVersion = parsed?.currentVersion,
            currentItem = parsed?.currentItem,
            resetRequired = parsed?.resetRequired == true,
            message = message,
        )
    }

    private fun quotedVersion(version: Long): String {
        require(version > 0)
        return "\"$version\""
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
        const val MAX_PHOTO_DOWNLOAD_BYTES = 12L * 1024 * 1024
    }
}
