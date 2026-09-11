package ru.begemot26.numismat.ui

import android.app.Application
import android.app.DownloadManager
import android.net.Uri
import android.os.Environment
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.serialization.json.Json
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
import ru.begemot26.numismat.data.IdentificationEvidence
import ru.begemot26.numismat.data.IdentifiedFields
import ru.begemot26.numismat.data.KrauseReference
import ru.begemot26.numismat.data.KrauseRange
import ru.begemot26.numismat.data.LocalCollectionStore
import ru.begemot26.numismat.data.LocalSyncConflict
import ru.begemot26.numismat.data.LocalPhotoDraft
import ru.begemot26.numismat.data.LocalPhotoMetadata
import ru.begemot26.numismat.data.LocalPhotoStore
import ru.begemot26.numismat.data.LocalPhotoVariant
import ru.begemot26.numismat.data.LocalSessionStore
import ru.begemot26.numismat.data.DirtyState
import ru.begemot26.numismat.data.LocalPhotoRecord
import ru.begemot26.numismat.data.RemotePhotoConflict
import ru.begemot26.numismat.data.syncPhotoDownload
import ru.begemot26.numismat.data.MarkSoldRequest
import ru.begemot26.numismat.data.MarketEvidence
import ru.begemot26.numismat.data.PendingSyncOperation
import ru.begemot26.numismat.data.PendingRemotePhoto
import ru.begemot26.numismat.data.User
import ru.begemot26.numismat.data.validateCollectionSyncPage
import java.io.File
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.util.UUID

enum class Screen { COLLECTION, IDENTIFICATION, EDITOR }

data class PreparedPhoto(
    val metadata: LocalPhotoMetadata,
)

data class IdentificationState(
    val photos: List<PreparedPhoto>,
    val identificationSessionId: String? = null,
    val requestId: String? = null,
    val recognizedName: String? = null,
    val catalogMatch: String = "not_found",
    val extracted: IdentifiedFields = IdentifiedFields(),
    val candidates: List<IdentificationCandidate> = emptyList(),
    val selectedTypeId: Long? = null,
    val selectedIssueId: Long? = null,
)

data class EditorState(
    val itemId: String? = null,
    val typeId: Long? = null,
    val issueId: Long? = null,
    val identifiedYear: Int? = null,
    val catalogTitle: String? = null,
    val krauseReference: KrauseReference? = null,
    val krauseRange: KrauseRange? = null,
    val label: String = "",
    val grade: String = "",
    val slabStatus: String = "unknown",
    val gradingCompanyCode: String? = null,
    val gradeSource: String = "unknown",
    val slabCertificateNumber: String? = null,
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
    val marketEvidence: MarketEvidence? = null,
)

data class PhotoState(
    val photo: CollectionPhoto,
    val url: String? = null,
)

data class SyncConflictReview(val conflict: LocalSyncConflict)

data class MainUiState(
    val booting: Boolean = true,
    val busy: Boolean = false,
    val user: User? = null,
    val screen: Screen = Screen.COLLECTION,
    val items: List<CollectionItem> = emptyList(),
    val itemImageUrls: Map<String, String> = emptyMap(),
    val summary: CollectionSummary? = null,
    val editor: EditorState? = null,
    val identification: IdentificationState? = null,
    val error: String? = null,
    val notice: String? = null,
    val pendingSyncCount: Int = 0,
    val pendingPhotoDownloadCount: Int = 0,
    val syncConflictCount: Int = 0,
    val syncConflictReview: SyncConflictReview? = null,
    val needsInitialSync: Boolean = false,
    val photoBusy: Boolean = false,
    val valuationBusy: Boolean = false,
    val dataBusy: Boolean = false,
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val api = ApiClient(application)
    private val drafts = DraftStore(application)
    private val local = LocalCollectionStore(application)
    private val localPhotos = LocalPhotoStore(application)
    private val sessions = LocalSessionStore(application)
    private var searchJob: Job? = null
    private var draftJob: Job? = null
    private val syncMutex = Mutex()
    private val syncJson = Json { ignoreUnknownKeys = true }

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
            sessions.save(user)
            state.value = state.value.copy(user = user, screen = Screen.COLLECTION)
            loadLocalCollection(user.id)
        }
    }

    fun logout() {
        drafts.clear()
        sessions.clearCurrent()
        api.clearSession()
        state.value = MainUiState(booting = false)
    }

    fun reloadCollection() {
        if (state.value.busy) return
        viewModelScope.launch {
            state.value = state.value.copy(busy = true, error = null, notice = null)
            val user = state.value.user
            if (user == null) {
                setError("Войдите в аккаунт")
                return@launch
            }
            val result = runCatching { syncCollection(user.id) }
            runCatching { loadLocalCollection(user.id) }
                .onFailure { setError(readable(it)) }
            result.onSuccess { pendingPhotos ->
                val conflicts = local.conflictCount(user.id)
                if (conflicts > 0) {
                    setNotice("Не удалось объединить изменения в $conflicts записях.")
                } else if (pendingPhotos > 0) {
                    setNotice("Монеты синхронизированы. Осталось скачать фотографий: $pendingPhotos.")
                } else {
                    setNotice("Синхронизация завершена.")
                }
            }
                .onFailure { setError(readable(it)) }
            state.value = state.value.copy(busy = false)
        }
    }

    fun reviewSyncConflicts() {
        val accountId = state.value.user?.id ?: return
        viewModelScope.launch(Dispatchers.IO) {
            val conflict = local.nextConflict(accountId)
            withContext(Dispatchers.Main) {
                state.value = state.value.copy(
                    syncConflictReview = conflict?.let(::SyncConflictReview),
                )
            }
        }
    }

    fun keepLocalConflict() = resolveSyncConflict(keepLocal = true)

    fun useServerConflict() = resolveSyncConflict(keepLocal = false)

    fun closeConflictReview() {
        state.value = state.value.copy(syncConflictReview = null)
    }

    private fun resolveSyncConflict(keepLocal: Boolean) {
        if (state.value.busy) return
        val accountId = state.value.user?.id ?: return
        val conflict = state.value.syncConflictReview?.conflict ?: return
        viewModelScope.launch {
            state.value = state.value.copy(busy = true, error = null, notice = null)
            runCatching {
                val paths = withContext(Dispatchers.IO) {
                    if (keepLocal) {
                        local.keepLocalConflict(accountId, conflict)
                    } else {
                        resolveWithServer(accountId, conflict)
                    }
                }
                deleteLocalPaths(paths)
                loadLocalCollection(accountId)
                val next = withContext(Dispatchers.IO) { local.nextConflict(accountId) }
                state.value = state.value.copy(syncConflictReview = next?.let(::SyncConflictReview))
                if (next == null) {
                    syncCollection(accountId)
                    loadLocalCollection(accountId)
                    setNotice("Изменения синхронизированы.")
                }
            }.onFailure { setError(readable(it)) }
            state.value = state.value.copy(busy = false)
        }
    }

    private suspend fun resolveWithServer(accountId: String, conflict: LocalSyncConflict): List<String> {
        if (conflict.entity == ru.begemot26.numismat.data.PendingEntity.ITEM ||
            conflict.conflictState == ru.begemot26.numismat.data.ConflictState.REMOTE_DELETE
        ) {
            return local.useServerConflict(accountId, conflict)
        }
        val stored = conflict.conflictJson?.let { encoded ->
            runCatching { syncJson.decodeFromString<RemotePhotoConflict>(encoded) }.getOrNull()
        }
        if (stored != null && verifyLocalDraft(stored.downloaded)) {
            return local.useServerConflict(accountId, conflict, stored.remotePhoto, stored.downloaded)
        }
        val itemRemoteId = requireNotNull(conflict.itemRemoteId) { "Монета ещё не синхронизирована." }
        val remote = api.photos(itemRemoteId).firstOrNull { photo ->
            photo.id == conflict.remoteId ||
                (photo.side == conflict.side && photo.sortOrder == conflict.sortOrder)
        } ?: return local.useServerConflict(accountId, conflict)
        val queued = PendingRemotePhoto(
            accountId = accountId,
            remoteId = remote.id,
            itemRemoteId = itemRemoteId,
            seq = 0,
            photo = remote,
            changedAt = remote.updatedAt,
            attemptCount = 0,
            lastError = null,
        )
        val prepared = prepareRemotePhoto(accountId, queued, reuseCleanLocalCopy = false)
        return try {
            local.useServerConflict(accountId, conflict, remote, prepared.draft)
        } catch (error: Throwable) {
            if (prepared.ownsFiles) deleteLocalPaths(prepared.draft.allPaths())
            throw error
        }
    }

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
                    val accountId = state.value.user?.id
                    if (accountId != null) {
                        deleteLocalPaths(local.clearAccount(accountId))
                    }
                    drafts.clear()
                    sessions.clearCurrent()
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
                    importPhoto(uri)
                } finally {
                    runCatching(onConsumed)
                }
                state.value = state.value.copy(
                    screen = Screen.IDENTIFICATION,
                    identification = IdentificationState(
                        photos = listOf(PreparedPhoto(prepared)),
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
            var imported: LocalPhotoMetadata? = null
            runCatching {
                val prepared = try {
                    importPhoto(uri)
                } finally {
                    runCatching(onConsumed)
                }
                imported = prepared
                val combined = (current.photos.map { it.metadata } + prepared).map {
                    it.mimeType to localPhotos.open(it, LocalPhotoVariant.ORIGINAL)
                }
                val result = api.identify(combined)
                val exactCandidate = result.candidates.singleOrNull()
                    ?.takeIf { result.catalogMatch == "exact" }
                state.value = state.value.copy(
                    identification = current.copy(
                        photos = current.photos + PreparedPhoto(prepared),
                        identificationSessionId = result.identificationSessionId,
                        requestId = result.requestId,
                        recognizedName = result.recognizedName,
                        catalogMatch = result.catalogMatch,
                        extracted = result.extracted,
                        candidates = result.candidates,
                        selectedTypeId = exactCandidate?.id,
                        selectedIssueId = exactCandidate?.issueId,
                    ),
                )
                imported = null
            }.onFailure {
                imported?.let { photo ->
                    state.value.user?.id?.let { accountId -> localPhotos.deleteDraftPhoto(accountId, photo.photoId) }
                }
                setError(readable(it))
            }
            state.value = state.value.copy(busy = false, photoBusy = false)
        }
    }

    fun selectIdentificationCandidate(typeId: Long) {
        val identification = state.value.identification ?: return
        val candidate = identification.candidates.firstOrNull { it.id == typeId } ?: return
        state.value = state.value.copy(
            identification = identification.copy(
                selectedTypeId = typeId,
                selectedIssueId = candidate.issueId,
            ),
            error = null,
        )
    }

    fun cancelIdentification() {
        val identification = state.value.identification
        identification?.identificationSessionId?.let { sessionId ->
            viewModelScope.launch { runCatching { api.discardIdentificationPhotos(sessionId) } }
        }
        val accountId = state.value.user?.id
        if (accountId != null) {
            identification?.photos?.forEach { localPhotos.deleteDraftPhoto(accountId, it.metadata.photoId) }
        }
        state.value = state.value.copy(
            screen = Screen.COLLECTION,
            identification = null,
            error = null,
        )
    }

    fun confirmIdentification() {
        val identification = state.value.identification ?: return
        if (identification.photos.size < 2) {
            setError("Сфотографируйте другую сторону")
            return
        }
        val typeId = identification.selectedTypeId
        val recognizedName = identification.recognizedName?.trim()?.takeIf { it.isNotEmpty() }
        if (identification.candidates.isNotEmpty() && typeId == null) {
            setError("Выберите подходящий вариант")
            return
        }
        if (typeId == null && recognizedName == null) {
            setError("Монета не распознана")
            return
        }
        launchBusy {
            val accountId = requireNotNull(state.value.user?.id) { "Войдите в аккаунт" }
            val proposedTypeIds = identification.candidates.map { it.id }
            val identificationEvidence = typeId?.let { selectedTypeId ->
                IdentificationEvidence(
                    catalogMatch = identification.catalogMatch,
                    proposedTypeIds = proposedTypeIds,
                    decision = if (proposedTypeIds.firstOrNull() == selectedTypeId) {
                        "accepted_top"
                    } else {
                        "selected_alternative"
                    },
                    recognizedName = recognizedName,
                    extracted = identification.extracted,
                )
            }
            val now = Instant.now().toString()
            val localId = UUID.randomUUID().toString()
            val selectedCandidate = identification.candidates.firstOrNull { it.id == typeId }
            val item = CollectionItem(
                id = localId,
                typeId = typeId,
                issueId = identification.selectedIssueId,
                identifiedYear = identification.extracted.year,
                typeName = selectedCandidate?.name,
                userLabel = if (typeId == null) recognizedName else null,
                identificationStatus = if (typeId == null) "unlinked" else "linked",
                gradeCode = identification.extracted.gradeCode,
                slabStatus = identification.extracted.slabStatus,
                gradingCompanyCode = identification.extracted.gradingCompanyCode,
                gradingCompanyRaw = identification.extracted.gradingCompanyRaw,
                gradeSource = identification.extracted.gradeSource,
                slabCertificateNumber = identification.extracted.slabCertificateNumber,
                status = "active",
                createdAt = now,
                updatedAt = now,
                catalog = ru.begemot26.numismat.data.CatalogSnapshot(
                    year = identification.extracted.year,
                    country = identification.extracted.country,
                    metal = identification.extracted.metal,
                    mint = identification.extracted.mint,
                ),
            )
            local.saveIdentifiedCoin(
                accountId = accountId,
                item = item,
                photos = identification.photos.mapIndexed { index, photo ->
                    photo.metadata.toDraft(if (index == 0) "obverse" else "reverse", index)
                },
                stagingSessionId = identification.identificationSessionId,
                createRequest = item.toCreateRequest(
                    evidence = identificationEvidence,
                    identificationRequestId = identification.requestId,
                ),
            )
            drafts.clear()
            loadLocalCollection(accountId)
            state.value = state.value.copy(screen = Screen.COLLECTION, identification = null)
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
                issueId = item.issueId,
                identifiedYear = item.identifiedYear,
                catalogTitle = item.typeName,
                krauseReference = item.krauseReference,
                krauseRange = item.krauseRange,
                label = item.userLabel.orEmpty(),
                grade = item.gradeCode.orEmpty(),
                slabStatus = item.slabStatus,
                gradingCompanyCode = item.gradingCompanyCode,
                gradeSource = item.gradeSource,
                slabCertificateNumber = item.slabCertificateNumber,
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
            runCatching {
                coroutineScope {
                    listOf(
                        async { loadLocalPhotosIntoEditor(item.id) },
                        async { loadMarketEvidenceIntoEditor(item.id) },
                        async { loadValuationHistoryIntoEditor(item.id) },
                    ).awaitAll()
                }
            }.onFailure { setError(readable(it)) }
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
                    importPhoto(uri)
                } finally {
                    runCatching(onConsumed)
                }
                val accountId = requireNotNull(state.value.user?.id) { "Войдите в аккаунт" }
                detachStagingPhotos(accountId, itemId)
                val existing = local.photos(accountId, itemId)
                local.addPhotoLocal(
                    accountId,
                    itemId,
                    prepared.toDraft(side, (existing.maxOfOrNull { it.sortOrder } ?: -1) + 1),
                )
                loadLocalPhotosIntoEditor(itemId)
                loadLocalCollection(accountId)
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
                val accountId = requireNotNull(state.value.user?.id) { "Войдите в аккаунт" }
                detachStagingPhotos(accountId, itemId)
                val deleted = local.deletePhotoLocal(accountId, photoId)
                if (!deleted.needsRemoteDelete) deleteLocalPaths(deleted.filePaths)
                loadLocalPhotosIntoEditor(itemId)
                loadLocalCollection(accountId)
            }.onFailure { setError(readable(it)) }
            state.value = state.value.copy(photoBusy = false)
        }
    }

    fun recalculateValuation() {
        val localItemId = state.value.editor?.itemId ?: return
        if (state.value.valuationBusy) return
        viewModelScope.launch {
            state.value = state.value.copy(valuationBusy = true, error = null)
            runCatching {
                val accountId = requireNotNull(state.value.user?.id) { "Войдите в аккаунт" }
                val record = requireNotNull(local.get(accountId, localItemId)) { "Монета не найдена" }
                if (record.dirtyState != DirtyState.CLEAN || record.remoteId == null) {
                    throw IllegalStateException("Сначала синхронизируйте изменения")
                }
                val response = api.recalculateValuation(record.remoteId)
                val details = coroutineScope {
                    val history = async { api.valuationHistory(record.remoteId) }
                    val market = async { runCatching { api.marketEvidence(record.remoteId) }.getOrNull() }
                    history.await() to market.await()
                }
                local.upsertRemote(accountId, record.item.copy(
                    id = record.remoteId,
                    valuation = response.valuation,
                ))
                loadLocalCollection(accountId)
                val editor = state.value.editor
                if (editor?.itemId == localItemId) {
                    state.value = state.value.copy(
                        editor = editor.copy(
                            valuationStatus = response.status,
                            valuation = response.valuation,
                            valuationHistory = details.first,
                            marketEvidence = details.second,
                        ),
                    )
                }
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
                issueId = null,
                identifiedYear = type.year,
                catalogTitle = type.name,
                krauseReference = null,
                krauseRange = null,
                catalogQuery = "",
                catalogResults = emptyList(),
                valuationStatus = "not_calculated",
                valuation = null,
                valuationHistory = emptyList(),
                marketEvidence = null,
            )
        }
    }

    fun useOwnLabel() {
        updateEditor { it.copy(
            typeId = null,
            issueId = null,
            identifiedYear = null,
            catalogTitle = null,
            krauseReference = null,
            krauseRange = null,
            catalogResults = emptyList(),
            valuationStatus = "not_calculated",
            valuation = null,
            valuationHistory = emptyList(),
            marketEvidence = null,
        ) }
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
            val accountId = requireNotNull(state.value.user?.id) { "Войдите в аккаунт" }
            val now = Instant.now().toString()
            if (editor.itemId == null) {
                val localId = UUID.randomUUID().toString()
                local.saveIdentifiedCoin(
                    accountId,
                    CollectionItem(
                        id = localId,
                        typeId = editor.typeId,
                        issueId = editor.issueId,
                        identifiedYear = editor.identifiedYear,
                        typeName = editor.catalogTitle,
                        userLabel = label,
                        identificationStatus = if (editor.typeId == null) "unlinked" else "linked",
                        gradeCode = editor.grade.trim().ifEmpty { null },
                        slabStatus = editor.slabStatus,
                        gradingCompanyCode = editor.gradingCompanyCode,
                        gradingCompanyRaw = editor.gradingCompanyCode,
                        gradeSource = editor.gradeSource,
                        slabCertificateNumber = editor.slabCertificateNumber,
                        purchasePriceMinor = priceMinor,
                        purchaseCurrency = if (priceMinor == null) null else "RUB",
                        purchaseDate = date,
                        purchaseSource = editor.purchaseSource.trim().ifEmpty { null },
                        notes = editor.notes.trim().ifEmpty { null },
                        status = "active",
                        createdAt = now,
                        updatedAt = now,
                    ),
                    emptyList(),
                )
                drafts.clear()
            } else {
                val current = requireNotNull(local.get(accountId, editor.itemId)) { "Монета не найдена" }
                local.updateLocal(accountId, editor.itemId, current.item.copy(
                    typeId = editor.typeId,
                    issueId = editor.issueId,
                    identifiedYear = editor.identifiedYear,
                    typeName = editor.catalogTitle,
                    userLabel = label,
                    identificationStatus = if (editor.typeId == null) "unlinked" else "linked",
                    gradeSystem = null,
                    gradeCode = editor.grade.trim().ifEmpty { null },
                    slabStatus = editor.slabStatus,
                    gradingCompanyCode = editor.gradingCompanyCode,
                    gradingCompanyRaw = editor.gradingCompanyCode,
                    gradeSource = editor.gradeSource,
                    slabCertificateNumber = editor.slabCertificateNumber,
                    purchasePriceMinor = priceMinor,
                    purchaseCurrency = if (priceMinor == null) null else "RUB",
                    purchaseDate = date,
                    purchaseSource = editor.purchaseSource.trim().ifEmpty { null },
                    notes = editor.notes.trim().ifEmpty { null },
                    updatedAt = now,
                    valuation = null,
                ))
            }
            loadLocalCollection(accountId)
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
            val accountId = requireNotNull(state.value.user?.id) { "Войдите в аккаунт" }
            val current = requireNotNull(local.get(accountId, id)) { "Монета не найдена" }
            local.updateLocal(accountId, id, current.item.copy(
                status = "sold",
                soldPriceMinor = priceMinor,
                soldCurrency = if (priceMinor == null) null else "RUB",
                soldAt = date,
                updatedAt = Instant.now().toString(),
            ))
            loadLocalCollection(accountId)
            state.value = state.value.copy(screen = Screen.COLLECTION, editor = null)
        }
    }

    fun activateItem() {
        val id = state.value.editor?.itemId ?: return
        launchBusy {
            val accountId = requireNotNull(state.value.user?.id) { "Войдите в аккаунт" }
            val current = requireNotNull(local.get(accountId, id)) { "Монета не найдена" }
            local.updateLocal(accountId, id, current.item.copy(
                status = "active", soldPriceMinor = null, soldCurrency = null, soldAt = null,
                updatedAt = Instant.now().toString(),
            ))
            loadLocalCollection(accountId)
            state.value = state.value.copy(screen = Screen.COLLECTION, editor = null)
        }
    }

    fun deleteItem() {
        val id = state.value.editor?.itemId ?: return
        launchBusy {
            val accountId = requireNotNull(state.value.user?.id) { "Войдите в аккаунт" }
            val deleted = local.deleteLocal(accountId, id)
            if (!deleted.needsRemoteDelete) deleteLocalPaths(deleted.filePaths)
            loadLocalCollection(accountId)
            state.value = state.value.copy(screen = Screen.COLLECTION, editor = null)
        }
    }

    fun clearError() { state.value = state.value.copy(error = null) }
    fun clearNotice() { state.value = state.value.copy(notice = null) }

    private fun restoreSession() {
        viewModelScope.launch {
            val user = sessions.load()
            state.value = MainUiState(booting = false, user = user)
            if (user != null) {
                runCatching { loadLocalCollection(user.id) }
                    .onFailure { setError(readable(it)) }
            }
        }
    }

    private suspend fun importPhoto(uri: Uri): LocalPhotoMetadata = withContext(Dispatchers.IO) {
        val accountId = requireNotNull(state.value.user?.id) { "Войдите в аккаунт" }
        localPhotos.importPhoto(accountId, UUID.randomUUID().toString(), uri)
    }

    private fun LocalPhotoMetadata.toDraft(side: String, sortOrder: Int) = LocalPhotoDraft(
        localId = photoId,
        side = side,
        sortOrder = sortOrder,
        mimeType = mimeType,
        sha256 = sha256,
        byteSize = byteSize,
        originalPath = originalPath,
        displayPath = displayPath,
        thumbPath = thumbnailPath,
    )

    private suspend fun loadLocalCollection(accountId: String) = withContext(Dispatchers.IO) {
        val records = local.list(accountId)
        val items = records.map { it.item }
        val images = records.mapNotNull { record ->
            local.photos(accountId, record.localId).firstOrNull()?.thumbPath?.let { path ->
                record.localId to localPhotos.openRelative(path).absolutePath
            }
        }.toMap()
        val pendingPhotoCount = local.pendingRemotePhotoCount(accountId)
        val pendingCount = local.pendingOperations(accountId, Int.MAX_VALUE).size + pendingPhotoCount
        val conflictCount = local.conflictCount(accountId)
        val needsInitialSync = items.isEmpty() && local.syncMetadata(accountId).lastSyncAtMs == null
        withContext(Dispatchers.Main) {
            state.value = state.value.copy(
                items = items,
                itemImageUrls = images,
                summary = summarizeLocalCollection(items),
                pendingSyncCount = pendingCount,
                pendingPhotoDownloadCount = pendingPhotoCount,
                syncConflictCount = conflictCount,
                needsInitialSync = needsInitialSync,
            )
        }
    }

    private suspend fun loadMarketEvidenceIntoEditor(itemLocalId: String) {
        val accountId = requireNotNull(state.value.user?.id) { "Войдите в аккаунт" }
        val record = withContext(Dispatchers.IO) { local.get(accountId, itemLocalId) } ?: return
        if (record.dirtyState != DirtyState.CLEAN) return
        val remoteId = record.remoteId ?: return
        val market = runCatching { api.marketEvidence(remoteId) }.getOrNull() ?: return
        val editor = state.value.editor
        if (editor?.itemId == itemLocalId) {
            state.value = state.value.copy(editor = editor.copy(marketEvidence = market))
        }
    }

    private suspend fun loadValuationHistoryIntoEditor(itemLocalId: String) {
        val accountId = requireNotNull(state.value.user?.id) { "Войдите в аккаунт" }
        val record = withContext(Dispatchers.IO) { local.get(accountId, itemLocalId) } ?: return
        if (record.dirtyState != DirtyState.CLEAN) return
        val remoteId = record.remoteId ?: return
        val history = runCatching { api.valuationHistory(remoteId) }.getOrNull() ?: return
        val editor = state.value.editor
        if (editor?.itemId == itemLocalId) {
            state.value = state.value.copy(editor = editor.copy(valuationHistory = history))
        }
    }

    private suspend fun loadLocalPhotosIntoEditor(itemLocalId: String) = withContext(Dispatchers.IO) {
        val accountId = requireNotNull(state.value.user?.id) { "Войдите в аккаунт" }
        val photos = local.photos(accountId, itemLocalId).map { record ->
            val timestamp = Instant.ofEpochMilli(record.updatedAtMs).toString()
            PhotoState(
                photo = CollectionPhoto(
                    id = record.localId,
                    itemId = itemLocalId,
                    side = record.side,
                    mimeType = record.mimeType,
                    byteSize = record.byteSize,
                    status = "ready",
                    sortOrder = record.sortOrder,
                    createdAt = timestamp,
                    updatedAt = timestamp,
                ),
                url = localPhotos.openRelative(record.displayPath).absolutePath,
            )
        }
        withContext(Dispatchers.Main) {
            val editor = state.value.editor
            if (editor?.itemId == itemLocalId) {
                state.value = state.value.copy(editor = editor.copy(photos = photos))
            }
        }
    }

    private suspend fun syncCollection(accountId: String): Int = withContext(Dispatchers.IO) {
        syncMutex.withLock {
            try {
                pullRemoteChanges(accountId)
                pushLocalChanges(accountId)
                pullRemoteChanges(accountId)
                downloadPendingRemotePhotos(accountId)
                val metadata = local.syncMetadata(accountId)
                val pendingPhotos = local.pendingRemotePhotoCount(accountId)
                local.updateSyncMetadata(
                    accountId,
                    metadata.remoteCursor,
                    System.currentTimeMillis(),
                    pendingPhotos.takeIf { it > 0 }?.let { "Не скачано фотографий: $it" },
                )
                pendingPhotos
            } catch (error: Throwable) {
                Log.e(SYNC_LOG_TAG, "Collection synchronization failed", error)
                val metadata = local.syncMetadata(accountId)
                local.updateSyncMetadata(accountId, metadata.remoteCursor, metadata.lastSyncAtMs, error.message)
                throw error
            }
        }
    }

    private suspend fun pullRemoteChanges(accountId: String) {
        var cursor = local.syncMetadata(accountId).remoteCursor
        do {
            val page = api.collectionSync(cursor, 200)
            validateCollectionSyncPage(page)
            if (page.hasMore && page.nextCursor == cursor) {
                error("Сервер не продвинул позицию синхронизации.")
            }
            val cleanup = local.applySyncPageWithDeferredPhotos(accountId, page.changes, page.nextCursor)
            deleteLocalPaths(cleanup)
            cursor = page.nextCursor
            loadLocalCollection(accountId)
        } while (page.hasMore)
    }

    private suspend fun downloadPendingRemotePhotos(accountId: String) = coroutineScope {
        val pending = local.pendingRemotePhotos(accountId)
        val semaphore = Semaphore(SYNC_PHOTO_CONCURRENCY)
        pending.chunked(SYNC_PHOTO_BATCH_SIZE).forEach { batch ->
            val outcomes = batch.map { entry ->
                    async {
                        semaphore.withPermit {
                            runCatching { entry to prepareRemotePhoto(accountId, entry) }
                        }
                    }
                }
                .awaitAll()
            outcomes.forEachIndexed { index, outcome ->
                outcome.onSuccess { (entry, prepared) ->
                    try {
                        val parent = requireNotNull(local.getByRemoteId(accountId, entry.itemRemoteId)) {
                            "Фотография получена раньше монеты."
                        }
                        val applied = local.reconcileRemotePhoto(
                            accountId,
                            parent.localId,
                            entry.photo,
                            prepared.draft,
                        )
                        if (applied.applied && applied.record.originalPath != prepared.draft.originalPath) {
                            deleteLocalPaths(prepared.draft.allPaths())
                        }
                        local.markRemotePhotoDownloaded(accountId, entry.remoteId)
                    } catch (error: Throwable) {
                        if (prepared.ownsFiles) deleteLocalPaths(prepared.draft.allPaths())
                        local.markRemotePhotoDownloadFailed(accountId, entry.remoteId, error.message)
                    }
                }.onFailure { error ->
                    local.markRemotePhotoDownloadFailed(accountId, batch[index].remoteId, error.message)
                }
            }
            loadLocalCollection(accountId)
        }
    }

    private suspend fun prepareRemotePhoto(
        accountId: String,
        pending: PendingRemotePhoto,
        reuseCleanLocalCopy: Boolean = true,
    ): PreparedSyncPhoto {
        val remote = pending.photo
        val sha256 = requireNotNull(remote.sha256) { "Сервер не передал контрольную сумму фотографии." }
        requireNotNull(remote.itemVersion) { "Сервер не передал версию монеты." }
        val download = syncPhotoDownload(remote)
        val parent = local.getByRemoteId(accountId, pending.itemRemoteId)

        val existing = parent?.let {
            local.photos(accountId, it.localId, includeDeleted = true).firstOrNull { photo -> photo.remoteId == remote.id }
        }
        if (reuseCleanLocalCopy && existing != null && existing.dirtyState == DirtyState.CLEAN &&
            existing.conflictState == ru.begemot26.numismat.data.ConflictState.NONE && verifyLocalPhoto(existing)
        ) {
            return PreparedSyncPhoto(existing.toDraft(), ownsFiles = false)
        }
        if (existing?.conflictJson != null) {
            val prior = runCatching {
                syncJson.decodeFromString<RemotePhotoConflict>(existing.conflictJson)
            }.getOrNull()
            if (prior?.remotePhoto?.id == remote.id &&
                prior.remotePhoto.sha256.equals(sha256, true) &&
                verifyLocalDraft(prior.downloaded)
            ) return PreparedSyncPhoto(prior.downloaded, ownsFiles = false)
        }

        val temporary = File.createTempFile("numismat-delta-", ".img", getApplication<Application>().cacheDir)
        try {
            if (download.url == null) {
                api.downloadVerified(
                    api.photoUrl(remote.id),
                    temporary,
                    requireNotNull(download.expectedOriginalSize),
                    requireNotNull(download.expectedOriginalSha256),
                )
            } else if (!download.verifiesOriginal) {
                api.download(download.url, temporary, MAX_SYNC_DISPLAY_BYTES)
            } else {
                api.downloadVerified(
                    download.url,
                    temporary,
                    requireNotNull(download.expectedOriginalSize),
                    requireNotNull(download.expectedOriginalSha256),
                )
            }
            val metadata = localPhotos.importPhoto(
                accountId,
                UUID.randomUUID().toString(),
                temporary,
                remote.mimeType,
            )
            check(!download.verifiesOriginal ||
                (metadata.byteSize == remote.byteSize && metadata.sha256.equals(sha256, true))) {
                "Проверка сохранённой фотографии не прошла."
            }
            val draft = metadata.toDraft(remote.side, remote.sortOrder).copy(remoteId = remote.id)
            return PreparedSyncPhoto(draft, ownsFiles = true)
        } finally {
            temporary.delete()
        }
    }

    private suspend fun pushLocalChanges(accountId: String) {
        val operations = local.pendingOperations(accountId, Int.MAX_VALUE)
        operations.forEach { operation ->
            when (operation.entity) {
                ru.begemot26.numismat.data.PendingEntity.ITEM -> when (operation.mutation) {
                    DirtyState.CREATE -> syncNewItem(accountId, operation.localId, operation.localRevision)
                    DirtyState.UPDATE -> syncUpdatedItem(
                        accountId,
                        operation.localId,
                        operation.localRevision,
                        requireNotNull(operation.expectedVersion) { "Нет версии монеты." },
                    )
                    DirtyState.DELETE -> {
                        operation.remoteId?.let { remoteId ->
                            try {
                                api.delete(remoteId, requireNotNull(operation.expectedVersion) { "Нет версии монеты." })
                            } catch (error: ApiException) {
                                if (error.status == 412) {
                                    local.markItemConflict(
                                        accountId, operation.localId, error.currentItem, error.currentVersion,
                                    )
                                    return@forEach
                                }
                                if (error.status != 404) throw error
                            }
                        }
                        deleteLocalPaths(local.markDeletedSynced(
                            accountId, operation.localId, operation.localRevision,
                        ))
                    }
                    DirtyState.CLEAN -> Unit
                }
                ru.begemot26.numismat.data.PendingEntity.PHOTO -> when (operation.mutation) {
                    DirtyState.CREATE, DirtyState.UPDATE -> {
                        syncPhotoUpsert(accountId, operation)
                    }
                    DirtyState.DELETE -> {
                        val photo = requireNotNull(local.photo(accountId, operation.localId))
                        val parent = requireNotNull(local.get(accountId, photo.itemLocalId))
                        operation.remoteId?.let { remoteId ->
                            try {
                                val version = api.deletePhoto(
                                    remoteId,
                                    requireNotNull(parent.serverVersion) { "Нет версии монеты." },
                                )
                                local.setItemServerVersion(accountId, parent.localId, version)
                            } catch (error: ApiException) {
                                if (error.status == 412) {
                                    local.markPhotoConflict(accountId, operation.localId, error.currentVersion)
                                    return@forEach
                                }
                                if (error.status != 404) throw error
                            }
                        }
                        deleteLocalPaths(local.markPhotoDeletedSynced(
                            accountId, operation.localId, operation.localRevision,
                        ))
                    }
                    DirtyState.CLEAN -> Unit
                }
        }
    }
    }

    private suspend fun syncPhotoUpsert(
        accountId: String,
        operation: PendingSyncOperation,
        allowRecoveryPull: Boolean = true,
    ) {
        val photo = local.photo(accountId, operation.localId) ?: return
        if (photo.dirtyState == DirtyState.CLEAN || photo.conflictState != ru.begemot26.numismat.data.ConflictState.NONE) {
            return
        }
        var parent = requireNotNull(local.get(accountId, photo.itemLocalId))
        val remoteItemId = requireNotNull(parent.remoteId) { "Сначала синхронизируйте монету." }
        var expectedVersion = requireNotNull(parent.serverVersion) { "Нет версии монеты." }
        local.markPhotoSyncAttempt(accountId, photo.localId, operation.localRevision)
        try {
            if (operation.mutation == DirtyState.UPDATE && photo.remoteId != null) {
                expectedVersion = try {
                    api.deletePhoto(photo.remoteId, expectedVersion)
                } catch (error: ApiException) {
                    if (error.status != 404) throw error
                    val current = api.item(remoteItemId)
                    current.version
                }
                local.setItemServerVersion(accountId, parent.localId, expectedVersion)
            }
            val uploaded = api.uploadPhoto(
                remoteItemId,
                photo.side,
                photo.mimeType,
                localPhotos.openRelative(photo.originalPath),
                photo.sortOrder,
                expectedVersion,
            )
            local.markPhotoSynced(
                accountId,
                photo.localId,
                uploaded.id,
                requireNotNull(uploaded.itemVersion) { "Сервер не вернул версию монеты." },
                operation.localRevision,
            )
        } catch (error: ApiException) {
            val recoverable = error.status == 412 || error.errorCode in setOf(
                "photo_side_exists", "photo_order_exists",
            )
            if (!recoverable || !allowRecoveryPull) {
                if (error.status == 412) {
                    local.markPhotoConflict(accountId, operation.localId, error.currentVersion)
                    return
                }
                throw error
            }
            pullRemoteChanges(accountId)
            val refreshed = local.photo(accountId, operation.localId) ?: return
            if (refreshed.dirtyState == DirtyState.CLEAN ||
                refreshed.conflictState != ru.begemot26.numismat.data.ConflictState.NONE
            ) return
            parent = requireNotNull(local.get(accountId, refreshed.itemLocalId))
            syncPhotoUpsert(
                accountId,
                operation.copy(
                    mutation = refreshed.dirtyState,
                    remoteId = refreshed.remoteId,
                    localRevision = refreshed.localRevision,
                    expectedVersion = parent.serverVersion,
                ),
                allowRecoveryPull = false,
            )
        }
    }

    private suspend fun syncNewItem(accountId: String, localId: String, expectedLocalRevision: Long) {
        val record = requireNotNull(local.get(accountId, localId))
        local.markItemSyncAttempt(accountId, localId, expectedLocalRevision)
        val request = record.item.toCreateRequest(record.createRequest?.identificationEvidence)
        val stagedItem = record.stagingSessionId?.let { sessionId ->
            try {
                api.saveIdentifiedItem(sessionId, request)
            } catch (error: ApiException) {
                if (error.status !in setOf(404, 409, 410)) throw error
                null
            }
        }
        if (stagedItem != null) {
            var remoteItem = stagedItem
            if (record.item.status == "sold") {
                remoteItem = api.markSold(remoteItem.id, MarkSoldRequest(
                    record.item.soldPriceMinor, record.item.soldCurrency, record.item.soldAt,
                ), remoteItem.version)
            }
            val remotePhotos = api.photos(stagedItem.id)
            val localPhotosForItem = local.photos(accountId, localId)
            val remoteIds = localPhotosForItem.mapNotNull { photo ->
                remotePhotos.firstOrNull {
                    it.side == photo.side && it.sortOrder == photo.sortOrder &&
                        it.byteSize == photo.byteSize && it.sha256.equals(photo.sha256, true)
                }
                    ?.let { photo.localId to it.id }
            }.toMap()
            local.markSynced(accountId, localId, remoteItem, remoteIds, expectedLocalRevision)
            return
        }

        var remote = api.create(request, idempotencyKey = localId)
        if (record.item.status == "sold") {
            remote = api.markSold(remote.id, MarkSoldRequest(
                record.item.soldPriceMinor, record.item.soldCurrency, record.item.soldAt,
            ), remote.version)
        }
        local.markSynced(accountId, localId, remote, expectedLocalRevision = expectedLocalRevision)
    }

    private suspend fun syncUpdatedItem(
        accountId: String,
        localId: String,
        expectedLocalRevision: Long,
        expectedVersion: Long,
    ) {
        val record = requireNotNull(local.get(accountId, localId))
        val remoteId = requireNotNull(record.remoteId)
        local.markItemSyncAttempt(accountId, localId, expectedLocalRevision)
        try {
            var remote = api.update(remoteId, record.item.toUpdateJson(), expectedVersion)
            remote = when (record.item.status) {
                "sold" -> api.markSold(remoteId, MarkSoldRequest(
                    record.item.soldPriceMinor, record.item.soldCurrency, record.item.soldAt,
                ), remote.version)
                "active" -> api.activate(remoteId, remote.version)
                else -> remote
            }
            local.markSynced(
                accountId, localId, remote, expectedLocalRevision = expectedLocalRevision,
            )
        } catch (error: ApiException) {
            if (error.status == 412) {
                local.markItemConflict(accountId, localId, error.currentItem, error.currentVersion)
            } else {
                throw error
            }
        }
    }

    private fun LocalPhotoRecord.toDraft() = LocalPhotoDraft(
        localId = localId,
        remoteId = remoteId,
        side = side,
        sortOrder = sortOrder,
        mimeType = mimeType,
        sha256 = sha256,
        byteSize = byteSize,
        originalPath = originalPath,
        displayPath = displayPath,
        thumbPath = thumbPath,
    )

    private data class PreparedSyncPhoto(val draft: LocalPhotoDraft, val ownsFiles: Boolean)

    private fun verifyLocalPhoto(photo: LocalPhotoRecord) = verifyLocalDraft(photo.toDraft())

    private fun verifyLocalDraft(photo: LocalPhotoDraft): Boolean {
        val file = localPhotos.openRelative(photo.originalPath)
        if (!file.isFile || file.length() != photo.byteSize) return false
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        return actual.equals(photo.sha256, ignoreCase = true)
    }

    private fun CollectionItem.toCreateRequest(
        evidence: IdentificationEvidence? = null,
        identificationRequestId: String? = null,
    ) = CreateItemRequest(
        typeId = typeId,
        issueId = issueId,
        identifiedYear = identifiedYear,
        userLabel = userLabel,
        identificationRequestId = identificationRequestId,
        gradeSystem = gradeSystem,
        gradeCode = gradeCode,
        slabStatus = slabStatus,
        gradingCompanyCode = gradingCompanyCode,
        gradeSource = gradeSource,
        slabCertificateNumber = slabCertificateNumber,
        purchasePriceMinor = purchasePriceMinor,
        purchaseCurrency = purchaseCurrency,
        purchaseDate = purchaseDate,
        purchaseSource = purchaseSource,
        notes = notes,
        identificationEvidence = evidence,
    )

    private fun CollectionItem.toUpdateJson() = buildJsonObject {
        put("typeId", typeId?.let(::JsonPrimitive) ?: JsonNull)
        put("issueId", issueId?.let(::JsonPrimitive) ?: JsonNull)
        put("identifiedYear", identifiedYear?.let(::JsonPrimitive) ?: JsonNull)
        put("userLabel", userLabel?.let(::JsonPrimitive) ?: JsonNull)
        put("gradeSystem", gradeSystem?.let(::JsonPrimitive) ?: JsonNull)
        put("gradeCode", gradeCode?.let(::JsonPrimitive) ?: JsonNull)
        put("slabStatus", slabStatus)
        put("gradingCompanyCode", gradingCompanyCode?.let(::JsonPrimitive) ?: JsonNull)
        put("gradeSource", gradeSource)
        put("slabCertificateNumber", slabCertificateNumber?.let(::JsonPrimitive) ?: JsonNull)
        put("purchasePriceMinor", purchasePriceMinor?.let(::JsonPrimitive) ?: JsonNull)
        put("purchaseCurrency", purchaseCurrency?.let(::JsonPrimitive) ?: JsonNull)
        put("purchaseDate", purchaseDate?.let(::JsonPrimitive) ?: JsonNull)
        put("purchaseSource", purchaseSource?.let(::JsonPrimitive) ?: JsonNull)
        put("notes", notes?.let(::JsonPrimitive) ?: JsonNull)
    }

    private fun deleteLocalPaths(paths: List<String>) {
        paths.forEach { path -> runCatching { localPhotos.openRelative(path).delete() } }
    }

    private fun detachStagingPhotos(accountId: String, itemLocalId: String) {
        val sessionId = local.detachStagingSession(accountId, itemLocalId) ?: return
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { api.discardIdentificationPhotos(sessionId) }
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
        is IllegalStateException -> error.message ?: "Операция сейчас недоступна"
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
        private const val SYNC_LOG_TAG = "NumismatSync"
        private const val SYNC_PHOTO_CONCURRENCY = 4
        private const val SYNC_PHOTO_BATCH_SIZE = 20
        private const val MAX_SYNC_DISPLAY_BYTES = 12L * 1024 * 1024
    }
}

internal fun summarizeLocalCollection(items: List<CollectionItem>): CollectionSummary {
    val activeItems = items.filter { it.status == "active" }
    val valuations = activeItems.mapNotNull { it.valuation }
    val valued = valuations.filter { it.medianMinor != null }
    val floorOnly = valuations.filter { it.medianMinor == null && it.valueFloorMinor != null }
    fun sum(selector: (CollectionValuation) -> Long?): Long? =
        valuations.mapNotNull(selector).takeIf { it.isNotEmpty() }?.sum()
    return CollectionSummary(
        total = items.size,
        active = activeItems.size,
        sold = items.count { it.status == "sold" },
        archived = items.count { it.status == "archived" },
        unlinked = items.count { it.identificationStatus == "unlinked" },
        distinctTypes = items.mapNotNull { it.typeId }.distinct().size,
        duplicates = items.filter { it.typeId != null }.groupingBy { it.typeId }.eachCount()
            .values.sumOf { (it - 1).coerceAtLeast(0) },
        valuation = ru.begemot26.numismat.data.CollectionValuationSummary(
            valuedCount = valued.size,
            floorOnlyCount = floorOnly.size,
            coveredCount = valued.size + floorOnly.size,
            unvaluedCount = activeItems.size - valued.size - floorOnly.size,
            lowMinor = sum { it.lowMinor },
            medianMinor = sum { it.medianMinor },
            highMinor = sum { it.highMinor },
            valueFloorMinor = sum { it.valueFloorMinor },
            conservativeTotalMinor = valuations.mapNotNull { it.medianMinor ?: it.valueFloorMinor }
                .takeIf { it.isNotEmpty() }?.sum(),
            rangeAvailable = valued.isNotEmpty(),
        ),
    )
}
