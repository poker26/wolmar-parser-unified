package ru.begemot26.numismat.ui

import android.app.Application
import android.app.DownloadManager
import android.net.Uri
import android.os.Environment
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import ru.begemot26.numismat.data.ApiClient
import ru.begemot26.numismat.data.ApiException
import ru.begemot26.numismat.data.CatalogType
import ru.begemot26.numismat.data.CollectionDraft
import ru.begemot26.numismat.data.CollectionItem
import ru.begemot26.numismat.data.CollectionPhoto
import ru.begemot26.numismat.data.CollectionSummary
import ru.begemot26.numismat.data.CollectionValuation
import ru.begemot26.numismat.data.CreateItemRequest
import ru.begemot26.numismat.data.DraftStore
import ru.begemot26.numismat.data.IdentificationCandidate
import ru.begemot26.numismat.data.IdentifiedFields
import ru.begemot26.numismat.data.MarkSoldRequest
import ru.begemot26.numismat.data.User
import java.math.BigDecimal
import java.math.RoundingMode

enum class Screen { COLLECTION, IDENTIFICATION, EDITOR }

data class PreparedPhoto(
    val mimeType: String,
    val bytes: ByteArray,
)

data class IdentificationState(
    val photos: List<PreparedPhoto>,
    val extracted: IdentifiedFields,
    val candidates: List<IdentificationCandidate>,
    val selectedTypeId: Long? = candidates.firstOrNull()?.id,
)

data class EditorState(
    val itemId: String? = null,
    val typeId: Long? = null,
    val catalogTitle: String? = null,
    val label: String = "",
    val grade: String = "",
    val priceRub: String = "",
    val purchaseDate: String = "",
    val purchaseSource: String = "",
    val notes: String = "",
    val catalogQuery: String = "",
    val catalogResults: List<CatalogType> = emptyList(),
    val searching: Boolean = false,
    val itemStatus: String = "active",
    val soldPriceRub: String = "",
    val soldDate: String = "",
    val photos: List<PhotoState> = emptyList(),
    val valuationStatus: String = "not_calculated",
    val valuation: CollectionValuation? = null,
    val valuationHistory: List<CollectionValuation> = emptyList(),
)

data class PhotoState(
    val photo: CollectionPhoto,
    val url: String? = null,
)

data class MainUiState(
    val booting: Boolean = true,
    val busy: Boolean = false,
    val user: User? = null,
    val screen: Screen = Screen.COLLECTION,
    val items: List<CollectionItem> = emptyList(),
    val summary: CollectionSummary? = null,
    val editor: EditorState? = null,
    val identification: IdentificationState? = null,
    val error: String? = null,
    val notice: String? = null,
    val photoBusy: Boolean = false,
    val valuationBusy: Boolean = false,
    val dataBusy: Boolean = false,
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val api = ApiClient(application)
    private val drafts = DraftStore(application)
    private var searchJob: Job? = null
    private var draftJob: Job? = null

    var state = androidx.compose.runtime.mutableStateOf(MainUiState())
        private set

    init { restoreSession() }

    fun login(email: String, password: String) {
        if (email.isBlank() || password.isBlank()) {
            setError("Введите почту и пароль")
            return
        }
        launchBusy {
            val user = api.login(email.trim(), password)
            state.value = state.value.copy(user = user, screen = Screen.COLLECTION)
            loadCollectionInternal()
        }
    }

    fun logout() {
        viewModelScope.launch {
            state.value = state.value.copy(busy = true, error = null)
            runCatching { api.logout() }
            drafts.clear()
            state.value = MainUiState(booting = false)
        }
    }

    fun reloadCollection() = launchBusy { loadCollectionInternal() }

    fun requestExport(password: String) {
        if (password.isBlank()) {
            setError("Введите пароль")
            return
        }
        if (state.value.dataBusy) return
        viewModelScope.launch {
            state.value = state.value.copy(dataBusy = true, error = null, notice = null)
            runCatching {
                val request = api.requestExport(password)
                repeat(120) {
                    val status = api.exportStatus(request.export.id)
                    when (status.export.status) {
                        "ready" -> {
                            val download = requireNotNull(status.download) { "Ссылка на архив не получена" }
                            enqueueDownload(download.url)
                            setNotice("Архив сохранится в папку «Загрузки»")
                            return@runCatching
                        }
                        "failed", "expired" -> throw IllegalArgumentException("Не удалось подготовить архив")
                    }
                    delay(1_000)
                }
                setNotice("Архив ещё создаётся. Нажмите «Скачать архив» позже")
            }.onFailure { setError(readable(it)) }
            state.value = state.value.copy(dataBusy = false)
        }
    }

    fun deleteAccount(password: String) {
        if (password.isBlank()) {
            setError("Введите пароль")
            return
        }
        if (state.value.dataBusy) return
        viewModelScope.launch {
            state.value = state.value.copy(dataBusy = true, error = null, notice = null)
            runCatching { api.deleteAccount(password) }
                .onSuccess {
                    drafts.clear()
                    state.value = MainUiState(
                        booting = false,
                        notice = "Аккаунт поставлен на удаление",
                    )
                }
                .onFailure {
                    state.value = state.value.copy(dataBusy = false)
                    setError(readable(it))
                }
        }
    }

    fun newItem() {
        val restored = drafts.load()?.toEditorState() ?: EditorState()
        state.value = state.value.copy(
            screen = Screen.EDITOR,
            editor = restored,
            error = null,
        )
    }

    fun identifyCoin(uri: Uri, onConsumed: () -> Unit = {}) {
        if (state.value.busy || state.value.photoBusy) return
        viewModelScope.launch {
            state.value = state.value.copy(busy = true, photoBusy = true, error = null)
            runCatching {
                val prepared = try {
                    readPhoto(uri)
                } finally {
                    runCatching(onConsumed)
                }
                val result = api.identify(prepared.first, prepared.second)
                state.value = state.value.copy(
                    screen = Screen.IDENTIFICATION,
                    identification = IdentificationState(
                        photos = listOf(PreparedPhoto(prepared.first, prepared.second)),
                        extracted = result.extracted,
                        candidates = result.candidates,
                    ),
                )
            }.onFailure { setError(readable(it)) }
            state.value = state.value.copy(busy = false, photoBusy = false)
        }
    }

    fun identifyOtherSide(uri: Uri, onConsumed: () -> Unit = {}) {
        val current = state.value.identification ?: return
        if (state.value.busy || current.photos.size >= 2) return
        viewModelScope.launch {
            state.value = state.value.copy(busy = true, photoBusy = true, error = null)
            runCatching {
                val prepared = try {
                    readPhoto(uri)
                } finally {
                    runCatching(onConsumed)
                }
                val result = api.identify(prepared.first, prepared.second)
                state.value = state.value.copy(
                    identification = current.copy(
                        photos = current.photos + PreparedPhoto(prepared.first, prepared.second),
                        extracted = result.extracted,
                        candidates = result.candidates,
                        selectedTypeId = result.candidates.firstOrNull()?.id,
                    ),
                )
            }.onFailure { setError(readable(it)) }
            state.value = state.value.copy(busy = false, photoBusy = false)
        }
    }

    fun selectIdentificationCandidate(typeId: Long) {
        val identification = state.value.identification ?: return
        if (identification.candidates.none { it.id == typeId }) return
        state.value = state.value.copy(
            identification = identification.copy(selectedTypeId = typeId),
            error = null,
        )
    }

    fun cancelIdentification() {
        state.value = state.value.copy(
            screen = Screen.COLLECTION,
            identification = null,
            error = null,
        )
    }

    fun confirmIdentification() {
        val identification = state.value.identification ?: return
        val typeId = identification.selectedTypeId ?: run {
            setError("Выберите монету")
            return
        }
        launchBusy {
            val item = api.create(CreateItemRequest(typeId = typeId))
            try {
                identification.photos.forEachIndexed { index, photo ->
                    uploadPreparedPhoto(
                        item.id,
                        if (index == 0) "obverse" else "reverse",
                        photo.mimeType to photo.bytes,
                    )
                }
            } catch (error: Throwable) {
                runCatching { api.delete(item.id) }
                throw error
            }
            drafts.clear()
            loadCollectionInternal()
            state.value = state.value.copy(
                screen = Screen.COLLECTION,
                identification = null,
                notice = "Монета добавлена в коллекцию",
            )
        }
    }

    fun cameraUnavailable() {
        setError("Не удалось открыть камеру")
    }

    fun editItem(item: CollectionItem) {
        state.value = state.value.copy(
            screen = Screen.EDITOR,
            editor = EditorState(
                itemId = item.id,
                typeId = item.typeId,
                catalogTitle = item.typeName,
                label = item.userLabel.orEmpty(),
                grade = item.gradeCode.orEmpty(),
                priceRub = item.purchasePriceMinor?.let(::formatRubles).orEmpty(),
                purchaseDate = item.purchaseDate.orEmpty(),
                purchaseSource = item.purchaseSource.orEmpty(),
                notes = item.notes.orEmpty(),
                itemStatus = item.status,
                soldPriceRub = item.soldPriceMinor?.let(::formatRubles).orEmpty(),
                soldDate = item.soldAt.orEmpty(),
                valuationStatus = item.valuation?.status ?: "not_calculated",
                valuation = item.valuation,
            ),
            error = null,
        )
        viewModelScope.launch {
            runCatching { loadPhotosInternal(item.id) }
                .onFailure { setError(readable(it)) }
        }
        viewModelScope.launch {
            runCatching { loadValuationInternal(item.id) }
                .onFailure { setError(readable(it)) }
        }
    }

    fun closeEditor() {
        searchJob?.cancel()
        state.value = state.value.copy(screen = Screen.COLLECTION, editor = null, error = null)
    }

    fun uploadPhoto(uri: Uri, side: String, onConsumed: () -> Unit = {}) {
        val itemId = state.value.editor?.itemId ?: return
        if (state.value.photoBusy) return
        viewModelScope.launch {
            state.value = state.value.copy(photoBusy = true, error = null)
            runCatching {
                val prepared = try {
                    readPhoto(uri)
                } finally {
                    runCatching(onConsumed)
                }
                uploadPreparedPhoto(itemId, side, prepared)
            }.onFailure { setError(readable(it)) }
            state.value = state.value.copy(photoBusy = false)
        }
    }

    fun deletePhoto(photoId: String) {
        val itemId = state.value.editor?.itemId ?: return
        if (state.value.photoBusy) return
        viewModelScope.launch {
            state.value = state.value.copy(photoBusy = true, error = null)
            runCatching {
                api.deletePhoto(photoId)
                loadPhotosInternal(itemId)
            }.onFailure { setError(readable(it)) }
            state.value = state.value.copy(photoBusy = false)
        }
    }

    fun recalculateValuation() {
        val itemId = state.value.editor?.itemId ?: return
        if (state.value.valuationBusy) return
        viewModelScope.launch {
            val previousId = state.value.editor?.valuation?.id
            state.value = state.value.copy(valuationBusy = true, error = null)
            runCatching {
                api.recalculateValuation(itemId)
                updateEditor { it.copy(valuationStatus = "pending") }
                repeat(20) {
                    delay(1_000)
                    val response = api.valuation(itemId)
                    if (response.valuation?.id != null && response.valuation.id != previousId) {
                        loadValuationInternal(itemId)
                        return@runCatching
                    }
                }
                loadValuationInternal(itemId)
            }.onFailure { setError(readable(it)) }
            state.value = state.value.copy(valuationBusy = false)
        }
    }

    fun updateEditor(transform: (EditorState) -> EditorState) {
        val current = state.value.editor ?: return
        val updated = transform(current)
        state.value = state.value.copy(editor = updated, error = null)
        if (updated.itemId == null) scheduleDraft(updated)
    }

    fun searchCatalog(query: String) {
        updateEditor { it.copy(catalogQuery = query) }
        searchJob?.cancel()
        if (query.trim().length < 2) {
            updateEditor { it.copy(catalogResults = emptyList(), searching = false) }
            return
        }
        searchJob = viewModelScope.launch {
            delay(350)
            updateEditor { it.copy(searching = true) }
            runCatching { api.searchCatalog(query) }
                .onSuccess { results -> updateEditor { it.copy(catalogResults = results, searching = false) } }
                .onFailure { error ->
                    updateEditor { it.copy(searching = false) }
                    setError(readable(error))
                }
        }
    }

    fun selectCatalog(type: CatalogType) {
        updateEditor {
            it.copy(
                typeId = type.id,
                catalogTitle = type.name,
                catalogQuery = "",
                catalogResults = emptyList(),
            )
        }
    }

    fun useOwnLabel() {
        updateEditor { it.copy(typeId = null, catalogTitle = null, catalogResults = emptyList()) }
    }

    fun saveEditor() {
        val editor = state.value.editor ?: return
        val label = editor.label.trim().ifEmpty { null }
        if (editor.typeId == null && label == null) {
            setError("Укажите название или выберите монету из каталога")
            return
        }
        val priceMinor = parseRubles(editor.priceRub) ?: if (editor.priceRub.isBlank()) null else {
            setError("Проверьте цену покупки")
            return
        }
        val date = editor.purchaseDate.trim().ifEmpty { null }
        if (date != null && !DATE.matches(date)) {
            setError("Дата должна быть в формате ГГГГ-ММ-ДД")
            return
        }
        launchBusy {
            if (editor.itemId == null) {
                api.create(
                    CreateItemRequest(
                        typeId = editor.typeId,
                        userLabel = label,
                        gradeCode = editor.grade.trim().ifEmpty { null },
                        purchasePriceMinor = priceMinor,
                        purchaseCurrency = if (priceMinor == null) null else "RUB",
                        purchaseDate = date,
                        purchaseSource = editor.purchaseSource.trim().ifEmpty { null },
                        notes = editor.notes.trim().ifEmpty { null },
                    ),
                )
                drafts.clear()
            } else {
                api.update(editor.itemId, buildJsonObject {
                    put("typeId", editor.typeId?.let(::JsonPrimitive) ?: JsonNull)
                    put("userLabel", label?.let(::JsonPrimitive) ?: JsonNull)
                    put("gradeCode", editor.grade.trim().ifEmpty { null }?.let(::JsonPrimitive) ?: JsonNull)
                    put("gradeSystem", JsonNull)
                    put("purchasePriceMinor", priceMinor?.let(::JsonPrimitive) ?: JsonNull)
                    put("purchaseCurrency", if (priceMinor == null) JsonNull else JsonPrimitive("RUB"))
                    put("purchaseDate", date?.let(::JsonPrimitive) ?: JsonNull)
                    put("purchaseSource", editor.purchaseSource.trim().ifEmpty { null }?.let(::JsonPrimitive) ?: JsonNull)
                    put("notes", editor.notes.trim().ifEmpty { null }?.let(::JsonPrimitive) ?: JsonNull)
                })
            }
            loadCollectionInternal()
            state.value = state.value.copy(screen = Screen.COLLECTION, editor = null)
        }
    }

    fun markSold(priceRub: String, soldDate: String) {
        val editor = state.value.editor ?: return
        val id = editor.itemId ?: return
        val priceMinor = parseRubles(priceRub) ?: if (priceRub.isBlank()) null else {
            setError("Проверьте цену продажи")
            return
        }
        val date = soldDate.trim()
        if (!DATE.matches(date)) {
            setError("Дата продажи должна быть в формате ГГГГ-ММ-ДД")
            return
        }
        launchBusy {
            api.markSold(
                id,
                MarkSoldRequest(
                    soldPriceMinor = priceMinor,
                    soldCurrency = if (priceMinor == null) null else "RUB",
                    soldAt = date,
                ),
            )
            loadCollectionInternal()
            state.value = state.value.copy(screen = Screen.COLLECTION, editor = null)
        }
    }

    fun activateItem() {
        val id = state.value.editor?.itemId ?: return
        launchBusy {
            api.activate(id)
            loadCollectionInternal()
            state.value = state.value.copy(screen = Screen.COLLECTION, editor = null)
        }
    }

    fun deleteItem() {
        val id = state.value.editor?.itemId ?: return
        launchBusy {
            api.delete(id)
            loadCollectionInternal()
            state.value = state.value.copy(screen = Screen.COLLECTION, editor = null)
        }
    }

    fun clearError() { state.value = state.value.copy(error = null) }
    fun clearNotice() { state.value = state.value.copy(notice = null) }

    private fun restoreSession() {
        viewModelScope.launch {
            val user = runCatching { api.me() }.getOrNull()
            state.value = MainUiState(booting = false, user = user)
            if (user != null) {
                runCatching { loadCollectionInternal() }
                    .onFailure { setError(readable(it)) }
            }
        }
    }

    private suspend fun loadCollectionInternal() {
        val items = api.collection()
        val summary = api.collectionSummary()
        state.value = state.value.copy(items = items, summary = summary)
    }

    private suspend fun loadPhotosInternal(itemId: String): List<PhotoState> {
        val photos = api.photos(itemId).map { photo ->
            PhotoState(
                photo = photo,
                url = if (photo.status == "ready") runCatching { api.photoUrl(photo.id) }.getOrNull() else null,
            )
        }
        val editor = state.value.editor
        if (editor?.itemId == itemId) {
            state.value = state.value.copy(editor = editor.copy(photos = photos))
        }
        return photos
    }

    private suspend fun uploadPreparedPhoto(
        itemId: String,
        side: String,
        prepared: Pair<String, ByteArray>,
    ) {
        api.uploadPhoto(itemId, side, prepared.first, prepared.second)
        for (attempt in 0 until 15) {
            delay(1_000)
            val photos = loadPhotosInternal(itemId)
            if (photos.none { it.photo.status == "pending" || it.photo.status == "processing" }) break
        }
    }

    private suspend fun loadValuationInternal(itemId: String) {
        val response = api.valuation(itemId)
        val history = api.valuationHistory(itemId)
        val editor = state.value.editor
        if (editor?.itemId == itemId) {
            state.value = state.value.copy(
                editor = editor.copy(
                    valuationStatus = response.status,
                    valuation = response.valuation,
                    valuationHistory = history,
                ),
            )
        }
    }

    private suspend fun readPhoto(uri: Uri): Pair<String, ByteArray> = withContext(Dispatchers.IO) {
        val resolver = getApplication<Application>().contentResolver
        val mimeType = when (resolver.getType(uri)?.lowercase()) {
            "image/jpg" -> "image/jpeg"
            "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif" -> resolver.getType(uri)!!.lowercase()
            else -> throw IllegalArgumentException("Поддерживаются JPEG, PNG, WebP и HEIC")
        }
        val input = resolver.openInputStream(uri) ?: throw IllegalArgumentException("Не удалось открыть фотографию")
        input.use {
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(64 * 1024)
            var total = 0
            while (true) {
                val read = it.read(buffer)
                if (read < 0) break
                total += read
                if (total > MAX_PHOTO_BYTES) throw IllegalArgumentException("Фотография больше 20 МБ")
                output.write(buffer, 0, read)
            }
            if (total == 0) throw IllegalArgumentException("Фотография пуста")
            mimeType to output.toByteArray()
        }
    }

    private fun enqueueDownload(url: String) {
        val application = getApplication<Application>()
        val manager = application.getSystemService(DownloadManager::class.java)
            ?: throw IllegalStateException("Системная загрузка недоступна")
        val fileName = "numismat-collection-${System.currentTimeMillis()}.zip"
        val request = DownloadManager.Request(Uri.parse(url))
            .setTitle("Архив коллекции")
            .setMimeType("application/zip")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
        manager.enqueue(request)
    }

    private fun launchBusy(block: suspend () -> Unit) {
        if (state.value.busy) return
        viewModelScope.launch {
            state.value = state.value.copy(busy = true, error = null)
            runCatching { block() }
                .onFailure { setError(readable(it)) }
            state.value = state.value.copy(busy = false)
        }
    }

    private fun scheduleDraft(editor: EditorState) {
        draftJob?.cancel()
        draftJob = viewModelScope.launch {
            delay(300)
            drafts.save(editor.toDraft())
        }
    }

    private fun setError(message: String) {
        state.value = state.value.copy(error = message, busy = false)
    }

    private fun setNotice(message: String) {
        state.value = state.value.copy(notice = message)
    }

    private fun readable(error: Throwable): String = when (error) {
        is ApiException -> error.message
        is IllegalArgumentException -> error.message ?: "Некорректная фотография"
        else -> "Не удалось связаться с сервером"
    }

    private fun parseRubles(value: String): Long? = runCatching {
        BigDecimal(value.trim().replace(',', '.'))
            .movePointRight(2)
            .setScale(0, RoundingMode.HALF_UP)
            .longValueExact()
            .also { require(it >= 0) }
    }.getOrNull()

    private fun formatRubles(minor: Long): String = BigDecimal(minor).movePointLeft(2).stripTrailingZeros().toPlainString()

    private fun CollectionDraft.toEditorState() = EditorState(
        typeId = typeId,
        catalogTitle = catalogTitle,
        label = label,
        grade = grade,
        priceRub = priceRub,
        purchaseDate = purchaseDate,
        purchaseSource = purchaseSource,
        notes = notes,
        catalogQuery = catalogQuery,
    )

    private fun EditorState.toDraft() = CollectionDraft(
        typeId = typeId,
        catalogTitle = catalogTitle,
        label = label,
        grade = grade,
        priceRub = priceRub,
        purchaseDate = purchaseDate,
        purchaseSource = purchaseSource,
        notes = notes,
        catalogQuery = catalogQuery,
    )

    private companion object {
        val DATE = Regex("\\d{4}-\\d{2}-\\d{2}")
        const val MAX_PHOTO_BYTES = 12 * 1024 * 1024
    }
}
