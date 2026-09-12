package ru.begemot26.numismat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items as listItems
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import ru.begemot26.numismat.data.CollectionItem
import ru.begemot26.numismat.data.CollectionSummary
import ru.begemot26.numismat.data.CollectionValuation
import ru.begemot26.numismat.data.CollectionValuePoint
import ru.begemot26.numismat.data.ConflictState
import ru.begemot26.numismat.data.PendingEntity
import ru.begemot26.numismat.ui.SyncConflictReview
import java.math.BigDecimal
import java.io.File
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

private enum class HomeSection { ALBUM, OVERVIEW }

internal enum class CollectionShelf(val status: String) {
    ACTIVE("active"),
    SOLD("sold"),
    ARCHIVED("archived"),
}

internal enum class CollectionSort {
    ADDED,
    YEAR,
    VALUE,
}

internal fun collectionShelfItems(
    items: List<CollectionItem>,
    shelf: CollectionShelf,
): List<CollectionItem> = items.filter { it.status == shelf.status }

internal fun sortedCollectionItems(
    items: List<CollectionItem>,
    sort: CollectionSort,
): List<CollectionItem> = when (sort) {
    CollectionSort.ADDED -> items.sortedWith(
        compareByDescending<CollectionItem> { it.createdAt }.thenByDescending { it.id },
    )
    CollectionSort.YEAR -> items.sortedWith(
        compareByDescending<CollectionItem> { it.identifiedYear ?: it.catalog?.year ?: Int.MIN_VALUE }
            .thenByDescending { it.createdAt },
    )
    CollectionSort.VALUE -> items.sortedWith(
        compareByDescending<CollectionItem> {
            it.valuation?.medianMinor ?: it.valuation?.valueFloorMinor ?: Long.MIN_VALUE
        }.thenByDescending { it.createdAt },
    )
}

internal fun collectionPeriod(year: Int): String = when {
    year < 1800 -> "До 1800 года"
    year < 1900 -> "XIX век"
    year <= 1945 -> "1900–1945"
    year <= 1991 -> "1946–1991"
    else -> "С 1992 года"
}

internal data class CollectionPerformance(
    val activeCount: Int,
    val purchaseKnownCount: Int,
    val purchaseTotalMinor: Long?,
    val comparableCount: Int,
    val comparablePurchaseMinor: Long?,
    val comparableMarketMinor: Long?,
) {
    val differenceMinor: Long?
        get() = comparablePurchaseMinor?.let { purchase -> comparableMarketMinor?.minus(purchase) }

    val differencePercent: Int?
        get() = comparablePurchaseMinor
            ?.takeIf { it > 0 }
            ?.let { purchase -> differenceMinor?.times(100)?.div(purchase)?.toInt() }
}

internal fun summarizeCollectionPerformance(items: List<CollectionItem>): CollectionPerformance {
    val active = items.filter { it.status == "active" }
    val withPurchase = active.filter { it.purchasePriceMinor != null }
    val comparable = withPurchase.filter { item ->
        item.valuation?.status == "ready" && item.valuation.medianMinor != null
    }
    return CollectionPerformance(
        activeCount = active.size,
        purchaseKnownCount = withPurchase.size,
        purchaseTotalMinor = withPurchase.mapNotNull { it.purchasePriceMinor }.takeIf { it.isNotEmpty() }?.sum(),
        comparableCount = comparable.size,
        comparablePurchaseMinor = comparable.mapNotNull { it.purchasePriceMinor }.takeIf { it.isNotEmpty() }?.sum(),
        comparableMarketMinor = comparable.mapNotNull { it.valuation?.medianMinor }.takeIf { it.isNotEmpty() }?.sum(),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CollectionScreen(
    items: List<CollectionItem>,
    itemImageUrls: Map<String, String>,
    summary: CollectionSummary?,
    valueHistory: List<CollectionValuePoint>,
    busy: Boolean,
    pendingSyncCount: Int,
    syncConflictCount: Int,
    syncConflictReview: SyncConflictReview?,
    needsInitialSync: Boolean,
    onAdd: () -> Unit,
    onEdit: (CollectionItem) -> Unit,
    onRefresh: () -> Unit,
    onReviewConflicts: () -> Unit,
    onKeepLocalConflict: () -> Unit,
    onUseServerConflict: () -> Unit,
    onCloseConflictReview: () -> Unit,
    onLogout: () -> Unit,
    dataBusy: Boolean,
    onExport: (String) -> Unit,
    onDeleteAccount: (String) -> Unit,
    snackbar: SnackbarHostState,
) {
    val uriHandler = LocalUriHandler.current
    var section by rememberSaveable { mutableStateOf(HomeSection.ALBUM) }
    var showProfile by remember { mutableStateOf(false) }
    var showDeleteAccount by remember { mutableStateOf(false) }
    var accountPassword by remember { mutableStateOf("") }

    syncConflictReview?.conflict?.let { conflict ->
        val isPhoto = conflict.entity == PendingEntity.PHOTO
        val deletedRemotely = conflict.conflictState == ConflictState.REMOTE_DELETE
        AlertDialog(
            onDismissRequest = { if (!busy) onCloseConflictReview() },
            title = { Text(if (deletedRemotely) "Объект удалён на другом устройстве" else "Изменения расходятся") },
            text = {
                Text(
                    when {
                        isPhoto && deletedRemotely ->
                            "Фотографию монеты «${conflict.itemTitle}» удалили на другом устройстве. Как поступить?"
                        isPhoto ->
                            "Фотографию монеты «${conflict.itemTitle}» изменили на другом устройстве. Какую версию сохранить?"
                        deletedRemotely ->
                            "Монету «${conflict.itemTitle}» удалили на другом устройстве. Как поступить?"
                        else ->
                            "Монету «${conflict.itemTitle}» изменили на другом устройстве. Какую версию сохранить?"
                    },
                )
            },
            confirmButton = {
                TextButton(onClick = onKeepLocalConflict, enabled = !busy) {
                    Text(
                        when {
                            isPhoto && deletedRemotely -> "Оставить фотографию"
                            deletedRemotely -> "Оставить монету"
                            else -> "Сохранить с этого устройства"
                        },
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = onUseServerConflict, enabled = !busy) {
                    Text(if (deletedRemotely) "Удалить здесь" else "Загрузить с сервера")
                }
            },
        )
    }

    if (showProfile) {
        AlertDialog(
            onDismissRequest = { if (!dataBusy) showProfile = false },
            title = { Text("Профиль и данные") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = accountPassword,
                        onValueChange = { accountPassword = it },
                        label = { Text("Пароль для операций с данными") },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedButton(
                        onClick = {
                            showProfile = false
                            onExport(accountPassword)
                            accountPassword = ""
                        },
                        enabled = !dataBusy && accountPassword.isNotBlank(),
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Скачать архив") }
                    OutlinedButton(
                        onClick = {
                            showProfile = false
                            accountPassword = ""
                            onLogout()
                        },
                        enabled = !dataBusy,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Выйти") }
                    TextButton(
                        onClick = { uriHandler.openUri("https://coins.begemot26.ru/privacy.html") },
                        enabled = !dataBusy,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Политика конфиденциальности") }
                    TextButton(
                        onClick = {
                            showProfile = false
                            showDeleteAccount = true
                        },
                        enabled = !dataBusy && accountPassword.isNotBlank(),
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Удалить аккаунт", color = MaterialTheme.colorScheme.error) }
                }
            },
            confirmButton = {
                TextButton(onClick = { showProfile = false }, enabled = !dataBusy) { Text("Закрыть") }
            },
        )
    }

    if (showDeleteAccount) {
        AlertDialog(
            onDismissRequest = { if (!dataBusy) showDeleteAccount = false },
            title = { Text("Удалить аккаунт?") },
            text = {
                Text("Вход будет отключён сразу. Через 7 дней коллекция и фотографии будут удалены без восстановления.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteAccount = false
                        onDeleteAccount(accountPassword)
                        accountPassword = ""
                    },
                    enabled = !dataBusy,
                ) { Text("Удалить", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showDeleteAccount = false
                        accountPassword = ""
                    },
                    enabled = !dataBusy,
                ) { Text("Отмена") }
            },
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            CenterAlignedTopAppBar(
                title = { BrandTitle() },
                navigationIcon = {
                    TextButton(onClick = onRefresh, enabled = !busy) {
                        Text(
                            "Синхр.",
                            color = if (pendingSyncCount > 0) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                    }
                },
                actions = {
                    if (syncConflictCount > 0) {
                        TextButton(onClick = onReviewConflicts, enabled = !busy) {
                            Text("Конфликты $syncConflictCount", color = MaterialTheme.colorScheme.error)
                        }
                    }
                    TextButton(onClick = { showProfile = true }, enabled = !busy && !dataBusy) {
                        Text("•••", fontSize = 20.sp)
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    titleContentColor = MaterialTheme.colorScheme.onBackground,
                ),
            )
        },
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                NavigationBarItem(
                    selected = section == HomeSection.ALBUM,
                    onClick = { section = HomeSection.ALBUM },
                    icon = { Text("◉") },
                    label = { Text("Альбом") },
                )
                NavigationBarItem(
                    selected = false,
                    onClick = onAdd,
                    icon = {
                        Box(
                            modifier = Modifier.size(44.dp).clip(CircleShape)
                                .background(MaterialTheme.colorScheme.primary),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("＋", color = MaterialTheme.colorScheme.onPrimary, fontSize = 23.sp)
                        }
                    },
                    label = { Text("Добавить") },
                )
                NavigationBarItem(
                    selected = section == HomeSection.OVERVIEW,
                    onClick = { section = HomeSection.OVERVIEW },
                    icon = { Text("◇") },
                    label = { Text("Обзор") },
                )
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        when (section) {
            HomeSection.ALBUM -> AlbumScreen(
                items = items,
                itemImageUrls = itemImageUrls,
                busy = busy || dataBusy,
                onEdit = onEdit,
                needsInitialSync = needsInitialSync,
                onSync = onRefresh,
                modifier = Modifier.padding(padding),
            )
            HomeSection.OVERVIEW -> OverviewScreen(
                items = items.filter { it.status == "active" },
                summary = summary,
                valueHistory = valueHistory,
                busy = busy || dataBusy,
                modifier = Modifier.padding(padding),
            )
        }
    }
}

@Composable
private fun BrandTitle() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier.size(30.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary),
            contentAlignment = Alignment.Center,
        ) {
            Text("N", color = MaterialTheme.colorScheme.onPrimary, fontFamily = FontFamily.Serif)
        }
        Spacer(Modifier.width(8.dp))
        Text("Numi", style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun AlbumScreen(
    items: List<CollectionItem>,
    itemImageUrls: Map<String, String>,
    busy: Boolean,
    onEdit: (CollectionItem) -> Unit,
    needsInitialSync: Boolean,
    onSync: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var searchVisible by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var selectedMetal by rememberSaveable { mutableStateOf<String?>(null) }
    var selectedCountry by rememberSaveable { mutableStateOf<String?>(null) }
    var sort by rememberSaveable { mutableStateOf(CollectionSort.ADDED) }
    var shelf by rememberSaveable { mutableStateOf(CollectionShelf.ACTIVE) }
    val locale = Locale("ru", "RU")
    val shelfItems = collectionShelfItems(items, shelf)
    val countries = shelfItems.mapNotNull { it.catalog?.country?.trim()?.takeIf(String::isNotEmpty) }.distinct()
    val metals = shelfItems.mapNotNull { it.catalog?.metal?.trim()?.takeIf(String::isNotEmpty) }.distinct().sorted()
    val filtered = sortedCollectionItems(shelfItems.filter { item ->
        val haystack = listOfNotNull(
            item.title,
            item.catalog?.country,
            item.catalog?.metal,
            item.identifiedYear?.toString(),
            item.catalog?.year?.toString(),
        ).joinToString(" ").lowercase(locale)
        val queryMatches = query.isBlank() || haystack.contains(query.trim().lowercase(locale))
        val metalMatches = selectedMetal == null || item.catalog?.metal == selectedMetal
        val countryMatches = selectedCountry == null || item.catalog?.country == selectedCountry
        queryMatches && metalMatches && countryMatches
    }, sort)

    Box(modifier.fillMaxSize()) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            contentPadding = PaddingValues(16.dp, 12.dp, 16.dp, 28.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.Top,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                when (shelf) {
                                    CollectionShelf.ACTIVE -> "Монеты в альбоме"
                                    CollectionShelf.SOLD -> "Проданные монеты"
                                    CollectionShelf.ARCHIVED -> "Архив"
                                },
                                style = MaterialTheme.typography.displaySmall,
                            )
                        }
                        TextButton(onClick = { searchVisible = !searchVisible }) {
                            Text(if (searchVisible) "Закрыть" else "Поиск")
                        }
                    }
                    Spacer(Modifier.height(7.dp))
                    Text(
                        "${shelfItems.size} ${coinWord(shelfItems.size)} · ${countries.size} ${countryWord(countries.size)} · ${metals.size} ${metalWord(metals.size)}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(12.dp))
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listItems(CollectionShelf.entries) { candidate ->
                            val count = collectionShelfItems(items, candidate).size
                            FilterChip(
                                selected = shelf == candidate,
                                onClick = {
                                    shelf = candidate
                                    selectedMetal = null
                                    selectedCountry = null
                                },
                                label = {
                                    Text(
                                        when (candidate) {
                                            CollectionShelf.ACTIVE -> "В коллекции $count"
                                            CollectionShelf.SOLD -> "Проданные $count"
                                            CollectionShelf.ARCHIVED -> "Архив $count"
                                        },
                                    )
                                },
                            )
                        }
                    }
                    if (searchVisible) {
                        Spacer(Modifier.height(14.dp))
                        OutlinedTextField(
                            value = query,
                            onValueChange = { query = it },
                            label = { Text("Название, страна, год") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        if (metals.size > 1) {
                            Spacer(Modifier.height(8.dp))
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                item {
                                    FilterChip(
                                        selected = selectedMetal == null,
                                        onClick = { selectedMetal = null },
                                        label = { Text("Все металлы") },
                                    )
                                }
                                listItems(metals) { metal ->
                                    FilterChip(
                                        selected = selectedMetal == metal,
                                        onClick = { selectedMetal = metal },
                                        label = { Text(pretty(metal)) },
                                    )
                                }
                            }
                        }
                        if (countries.size > 1) {
                            Spacer(Modifier.height(8.dp))
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                item {
                                    FilterChip(
                                        selected = selectedCountry == null,
                                        onClick = { selectedCountry = null },
                                        label = { Text("Все страны") },
                                    )
                                }
                                listItems(countries.sorted()) { country ->
                                    FilterChip(
                                        selected = selectedCountry == country,
                                        onClick = { selectedCountry = country },
                                        label = { Text(country) },
                                    )
                                }
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        Text("Сортировка", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(6.dp))
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listItems(CollectionSort.entries) { candidate ->
                                FilterChip(
                                    selected = sort == candidate,
                                    onClick = { sort = candidate },
                                    label = {
                                        Text(
                                            when (candidate) {
                                                CollectionSort.ADDED -> "Сначала новые"
                                                CollectionSort.YEAR -> "По году"
                                                CollectionSort.VALUE -> "По стоимости"
                                            },
                                        )
                                    },
                                )
                            }
                        }
                    }
                    Spacer(Modifier.height(18.dp))
                }
            }
            if (filtered.isEmpty() && !busy) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            when {
                                shelf == CollectionShelf.ACTIVE && needsInitialSync -> "Получите свою коллекцию"
                                shelfItems.isNotEmpty() -> "Монеты не найдены"
                                shelf == CollectionShelf.ACTIVE -> "Альбом пока пуст"
                                shelf == CollectionShelf.SOLD -> "Проданных монет пока нет"
                                shelf == CollectionShelf.ARCHIVED -> "Архив пока пуст"
                                else -> "Монеты не найдены"
                            },
                            style = MaterialTheme.typography.titleLarge,
                        )
                        if (shelf == CollectionShelf.ACTIVE && shelfItems.isEmpty()) {
                            Spacer(Modifier.height(8.dp))
                            if (needsInitialSync) {
                                Button(onClick = onSync) { Text("Синхронизировать") }
                            } else {
                                Text("Добавьте первую монету", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            } else {
                items(filtered, key = { it.id }) { item ->
                    AlbumCoin(
                        item = item,
                        imageUrl = itemImageUrls[item.id],
                        onClick = { onEdit(item) },
                    )
                }
            }
        }
        if (busy) CircularProgressIndicator(Modifier.align(Alignment.TopCenter).padding(top = 8.dp))
    }
}

@Composable
private fun AlbumCoin(item: CollectionItem, imageUrl: String?, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.8f)),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            Box(
                modifier = Modifier.fillMaxWidth().aspectRatio(1f)
                    .background(MaterialTheme.colorScheme.surface),
                contentAlignment = Alignment.Center,
            ) {
                if (imageUrl != null) {
                    AsyncImage(
                        model = File(imageUrl),
                        contentDescription = "${item.title}, изображение монеты",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                } else {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(
                            modifier = Modifier.size(78.dp).clip(CircleShape)
                                .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.35f)),
                        )
                        Spacer(Modifier.height(10.dp))
                            Text("Без фото", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            Column(Modifier.padding(12.dp)) {
                Text(
                    item.title,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                val details = listOfNotNull(
                    item.identifiedYear?.toString() ?: item.catalog?.year?.toString(),
                    item.catalog?.metal?.let(::pretty),
                ).joinToString(" · ")
                if (details.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        details,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                item.valuation?.takeIf {
                    (it.status == "ready" && it.medianMinor != null) ||
                        (it.status == "floor_only" && it.valueFloorMinor != null)
                }?.let { valuation ->
                    Spacer(Modifier.height(9.dp))
                    Text(
                        valuationAmount(valuation),
                        color = valuationColor(valuation),
                        fontWeight = FontWeight.Medium,
                    )
                }
                if (item.status == "sold") {
                    val sale = item.soldPriceMinor?.let { price ->
                        listOfNotNull("Продана за ${rubles(price)} ₽", item.soldAt).joinToString(" · ")
                    } ?: item.soldAt?.let { "Продана $it" }.orEmpty()
                    if (sale.isNotBlank()) {
                        Spacer(Modifier.height(9.dp))
                        Text(
                            sale,
                            color = MaterialTheme.colorScheme.secondary,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun OverviewScreen(
    items: List<CollectionItem>,
    summary: CollectionSummary?,
    valueHistory: List<CollectionValuePoint>,
    busy: Boolean,
    modifier: Modifier = Modifier,
) {
    val countries = items.mapNotNull { it.catalog?.country?.trim()?.takeIf(String::isNotEmpty) }
    val metals = items.mapNotNull { it.catalog?.metal?.trim()?.takeIf(String::isNotEmpty) }
    val years = items.mapNotNull { it.identifiedYear ?: it.catalog?.year }
    val countryCounts = countries.groupingBy { it }.eachCount().entries.sortedByDescending { it.value }
    val metalCounts = metals.groupingBy { pretty(it) }.eachCount().entries.sortedByDescending { it.value }
    val periodCounts = years.groupingBy(::collectionPeriod).eachCount()
    val orderedPeriods = listOf("До 1800 года", "XIX век", "1900–1945", "1946–1991", "С 1992 года")
        .mapNotNull { period -> periodCounts[period]?.let { count -> MapEntry(period, count) } }
    val typeCounts = items.mapNotNull { it.typeId }.groupingBy { it }.eachCount()
    val duplicateCount = typeCounts.values.sumOf { (it - 1).coerceAtLeast(0) }
    val unlinkedCount = items.count { it.identificationStatus != "linked" }
    val performance = summarizeCollectionPerformance(items)

    Box(modifier.fillMaxSize()) {
        LazyColumn(
            contentPadding = PaddingValues(20.dp, 12.dp, 20.dp, 32.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            item {
                    Text("Что уже собрано", style = MaterialTheme.typography.displaySmall)
            }
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OverviewMetric(items.size.toString(), "монет", Modifier.weight(1f))
                    OverviewMetric(countries.distinct().size.toString(), "стран", Modifier.weight(1f))
                    OverviewMetric(metals.distinct().size.toString(), "металлов", Modifier.weight(1f))
                }
            }
            if (metalCounts.isNotEmpty()) {
                item { DistributionSection("По металлам", metalCounts, items.size) }
            }
            if (countryCounts.isNotEmpty()) {
                item { DistributionSection("По странам", countryCounts.take(6), items.size) }
            }
            if (orderedPeriods.isNotEmpty()) {
                item { DistributionSection("По периодам", orderedPeriods, items.size) }
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Состав альбома", style = MaterialTheme.typography.titleLarge)
                    OverviewLine("Уникальных типов", typeCounts.size.toString())
                    OverviewLine("Дубликатов", duplicateCount.toString())
                    OverviewLine("Требуют определения", unlinkedCount.toString())
                    if (years.isNotEmpty()) {
                        OverviewLine("Диапазон годов", "${years.minOrNull()}–${years.maxOrNull()}")
                    }
                }
            }
            summary?.takeIf { it.active > 0 }?.valuation?.let { valuation ->
                val coveredCount = valuation.coveredCount.takeIf { it > 0 }
                    ?: (valuation.valuedCount + valuation.floorOnlyCount)
                val displayedTotal = valuation.conservativeTotalMinor ?: valuation.medianMinor
                val marketTotal = valuation.medianMinor
                val floorOnlyTotal = displayedTotal?.let { total ->
                    (total - (marketTotal ?: 0L)).coerceAtLeast(0L)
                }
                item {
                    val completeCoverage = coveredCount >= summary.active && valuation.unvaluedCount == 0
                    Card(
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                if (completeCoverage) "Консервативная стоимость коллекции"
                                else "Стоимость учтённых монет",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (displayedTotal != null) {
                                Text(
                                    "${rubles(displayedTotal)} ₽",
                                    style = MaterialTheme.typography.headlineSmall,
                                )
                            }
                            marketTotal?.let { amount ->
                                OverviewLine(
                                    "По рыночным проходам",
                                    "${valuation.valuedCount} · ${rubles(amount)} ₽",
                                )
                            } ?: OverviewLine("По рыночным проходам", valuation.valuedCount.toString())
                            if (valuation.floorOnlyCount > 0) {
                                OverviewLine(
                                    "Только по металлу",
                                    floorOnlyTotal?.let { "${valuation.floorOnlyCount} · ${rubles(it)} ₽" }
                                        ?: valuation.floorOnlyCount.toString(),
                                )
                            }
                            if (valuation.unvaluedCount > 0) {
                                OverviewLine("Без суммы", valuation.unvaluedCount.toString())
                            }
                        }
                    }
                }
            }
            if (valueHistory.isNotEmpty()) {
                item { CollectionValueHistorySection(valueHistory) }
            }
            performance.purchaseTotalMinor?.let { purchaseTotal ->
                item { CollectionPerformanceSection(performance, purchaseTotal) }
            }
        }
        if (busy) CircularProgressIndicator(Modifier.align(Alignment.TopCenter).padding(top = 8.dp))
    }
}

internal data class CollectionValueTrend(
    val currentMinor: Long,
    val differenceMinor: Long?,
    val differencePercent: Int?,
)

internal fun collectionValueTrend(points: List<CollectionValuePoint>): CollectionValueTrend? {
    val current = points.lastOrNull()?.conservativeTotalMinor ?: return null
    val first = points.firstOrNull()?.conservativeTotalMinor
    val difference = first?.let { current - it }.takeIf { points.size > 1 }
    val percent = if (difference != null && first != null && first != 0L) {
        (difference.toDouble() * 100.0 / first.toDouble()).roundToInt()
    } else {
        null
    }
    return CollectionValueTrend(current, difference, percent)
}

@Composable
private fun CollectionValueHistorySection(points: List<CollectionValuePoint>) {
    val trend = collectionValueTrend(points) ?: return
    val latest = points.last()
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Стоимость по дням", style = MaterialTheme.typography.titleLarge)
            Text("${rubles(trend.currentMinor)} ₽", style = MaterialTheme.typography.headlineSmall)
            trend.differenceMinor?.let { difference ->
                val sign = if (difference > 0) "+" else ""
                val percent = trend.differencePercent?.let { " · ${if (it > 0) "+" else ""}$it%" }.orEmpty()
                Text(
                    "$sign${rubles(difference)} ₽$percent",
                    color = when {
                        difference > 0 -> MaterialTheme.colorScheme.tertiary
                        difference < 0 -> MaterialTheme.colorScheme.error
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    fontWeight = FontWeight.SemiBold,
                )
            }
            CollectionValueChart(points)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(historyDate(points.first().date), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(historyDate(points.last().date), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            OverviewLine("По рыночным проходам", latest.valuedCount.toString())
            OverviewLine("По стоимости металла", latest.floorOnlyCount.toString())
            if (latest.unvaluedCount > 0) {
                OverviewLine("Без суммы", latest.unvaluedCount.toString())
            }
        }
    }
}

@Composable
private fun CollectionValueChart(points: List<CollectionValuePoint>) {
    val lineColor = MaterialTheme.colorScheme.primary
    val pointColor = MaterialTheme.colorScheme.secondary
    val values = points.map { it.conservativeTotalMinor }
    Canvas(Modifier.fillMaxWidth().height(112.dp)) {
        val inset = 7.dp.toPx()
        val chartWidth = (size.width - inset * 2).coerceAtLeast(1f)
        val chartHeight = (size.height - inset * 2).coerceAtLeast(1f)
        val minimum = values.minOrNull() ?: 0L
        val maximum = values.maxOrNull() ?: minimum
        fun offset(index: Int, value: Long): Offset {
            val x = if (points.size == 1) size.width / 2f
                else inset + chartWidth * index.toFloat() / (points.size - 1).toFloat()
            val ratio = if (maximum == minimum) 0.5f
                else (value - minimum).toFloat() / (maximum - minimum).toFloat()
            return Offset(x, inset + chartHeight * (1f - ratio))
        }
        val path = Path()
        values.forEachIndexed { index, value ->
            val point = offset(index, value)
            if (index == 0) path.moveTo(point.x, point.y) else path.lineTo(point.x, point.y)
        }
        if (values.size > 1) {
            drawPath(
                path,
                lineColor,
                style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
            )
        }
        values.forEachIndexed { index, value ->
            drawCircle(pointColor, radius = if (index == values.lastIndex) 5.dp.toPx() else 3.dp.toPx(), center = offset(index, value))
        }
    }
}

private fun historyDate(value: String): String = runCatching {
    LocalDate.parse(value).format(DateTimeFormatter.ofPattern("d MMM", Locale("ru", "RU")))
}.getOrDefault(value)

@Composable
private fun CollectionPerformanceSection(performance: CollectionPerformance, purchaseTotalMinor: Long) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Стоимость покупки", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("${rubles(purchaseTotalMinor)} ₽", style = MaterialTheme.typography.headlineSmall)
            OverviewLine(
                "Цена указана",
                "${performance.purchaseKnownCount} из ${performance.activeCount}",
            )
            if (performance.comparableCount > 0) {
                Spacer(Modifier.height(4.dp))
                Text("Сравнение с рынком", style = MaterialTheme.typography.titleMedium)
                OverviewLine("Монет в сравнении", performance.comparableCount.toString())
                performance.comparablePurchaseMinor?.let { OverviewLine("Куплены за", "${rubles(it)} ₽") }
                performance.comparableMarketMinor?.let { OverviewLine("Текущая оценка", "${rubles(it)} ₽") }
                performance.differenceMinor?.let { difference ->
                    val percent = performance.differencePercent?.let { " · ${if (it > 0) "+" else ""}$it%" }.orEmpty()
                    PerformanceDifferenceLine("Разница", difference, percent)
                }
            }
        }
    }
}

@Composable
private fun PerformanceDifferenceLine(label: String, differenceMinor: Long, percent: String) {
    val sign = if (differenceMinor > 0) "+" else ""
    val color = when {
        differenceMinor > 0 -> MaterialTheme.colorScheme.tertiary
        differenceMinor < 0 -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.onSurface
    }
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("$sign${rubles(differenceMinor)} ₽$percent", color = color, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun OverviewMetric(value: String, label: String, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(value, style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.secondary)
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun DistributionSection(title: String, values: List<Map.Entry<String, Int>>, total: Int) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        values.forEach { entry ->
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(pretty(entry.key), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(12.dp))
                    Text(entry.value.toString(), color = MaterialTheme.colorScheme.secondary)
                }
                Box(
                    Modifier.fillMaxWidth().height(3.dp).background(MaterialTheme.colorScheme.outline.copy(alpha = 0.55f)),
                ) {
                    Box(
                        Modifier.fillMaxWidth((entry.value.toFloat() / total.coerceAtLeast(1)).coerceIn(0f, 1f))
                            .height(3.dp).background(MaterialTheme.colorScheme.primary),
                    )
                }
            }
        }
    }
}

@Composable
private fun OverviewLine(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(12.dp))
        Text(value, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}

private data class MapEntry<K, V>(override val key: K, override val value: V) : Map.Entry<K, V>

@Composable
private fun valuationColor(valuation: CollectionValuation): Color = when {
    valuation.status == "floor_only" -> MaterialTheme.colorScheme.secondary
    (valuation.confidence ?: 0.0) >= 0.7 -> MaterialTheme.colorScheme.tertiary
    (valuation.confidence ?: 0.0) >= 0.4 -> MaterialTheme.colorScheme.primary
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

private fun valuationAmount(valuation: CollectionValuation): String {
    val floorOnly = valuation.status == "floor_only"
    val amount = if (floorOnly) valuation.valueFloorMinor else valuation.medianMinor
    amount ?: return ""
    val sign = if (floorOnly) "≥ " else "≈ "
    return "$sign${rubles(amount)} ₽"
}

private fun rubles(minor: Long): String = NumberFormat.getNumberInstance(Locale("ru", "RU")).apply {
    minimumFractionDigits = 0
    maximumFractionDigits = 2
}.format(BigDecimal(minor).movePointLeft(2))

private fun pretty(value: String): String = value.trim().replaceFirstChar {
    if (it.isLowerCase()) it.titlecase(Locale("ru", "RU")) else it.toString()
}

private fun coinWord(count: Int): String = when {
    count % 100 in 11..14 -> "монет"
    count % 10 == 1 -> "монета"
    count % 10 in 2..4 -> "монеты"
    else -> "монет"
}

private fun countryWord(count: Int): String = when {
    count % 100 in 11..14 -> "стран"
    count % 10 == 1 -> "страна"
    count % 10 in 2..4 -> "страны"
    else -> "стран"
}

private fun metalWord(count: Int): String = when {
    count % 100 in 11..14 -> "металлов"
    count % 10 == 1 -> "металл"
    count % 10 in 2..4 -> "металла"
    else -> "металлов"
}
