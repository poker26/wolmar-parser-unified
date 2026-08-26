package ru.begemot26.numismat.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import ru.begemot26.numismat.data.ApiClient
import ru.begemot26.numismat.data.ApiException
import ru.begemot26.numismat.data.CatalogType
import ru.begemot26.numismat.data.CollectionItem
import ru.begemot26.numismat.data.CreateItemRequest
import ru.begemot26.numismat.data.User
import java.math.BigDecimal
import java.math.RoundingMode

enum class Screen { COLLECTION, EDITOR }

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
)

data class MainUiState(
    val booting: Boolean = true,
    val busy: Boolean = false,
    val user: User? = null,
    val screen: Screen = Screen.COLLECTION,
    val items: List<CollectionItem> = emptyList(),
    val editor: EditorState? = null,
    val error: String? = null,
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val api = ApiClient(application)
    private var searchJob: Job? = null

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
            state.value = MainUiState(booting = false)
        }
    }

    fun reloadCollection() = launchBusy { loadCollectionInternal() }

    fun newItem() {
        state.value = state.value.copy(
            screen = Screen.EDITOR,
            editor = EditorState(),
            error = null,
        )
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
            ),
            error = null,
        )
    }

    fun closeEditor() {
        searchJob?.cancel()
        state.value = state.value.copy(screen = Screen.COLLECTION, editor = null, error = null)
    }

    fun updateEditor(transform: (EditorState) -> EditorState) {
        val current = state.value.editor ?: return
        state.value = state.value.copy(editor = transform(current), error = null)
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

    fun clearError() { state.value = state.value.copy(error = null) }

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
        state.value = state.value.copy(items = api.collection())
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

    private fun setError(message: String) {
        state.value = state.value.copy(error = message, busy = false)
    }

    private fun readable(error: Throwable): String = when (error) {
        is ApiException -> error.message
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

    private companion object {
        val DATE = Regex("\\d{4}-\\d{2}-\\d{2}")
    }
}
