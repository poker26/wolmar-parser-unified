package ru.begemot26.numismat

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
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
import java.math.BigDecimal
import java.io.File
import java.text.NumberFormat
import java.util.Locale

private enum class HomeSection { ALBUM, OVERVIEW }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CollectionScreen(
    items: List<CollectionItem>,
    itemImageUrls: Map<String, String>,
    summary: CollectionSummary?,
    busy: Boolean,
    pendingSyncCount: Int,
    syncConflictCount: Int,
    needsInitialSync: Boolean,
    onAdd: () -> Unit,
    onEdit: (CollectionItem) -> Unit,
    onRefresh: () -> Unit,
    onLogout: () -> Unit,
    dataBusy: Boolean,
    onExport: (String) -> Unit,
    onDeleteAccount: (String) -> Unit,
    snackbar: SnackbarHostState,
) {
    var section by rememberSaveable { mutableStateOf(HomeSection.ALBUM) }
    var showProfile by remember { mutableStateOf(false) }
    var showDeleteAccount by remember { mutableStateOf(false) }
    var accountPassword by remember { mutableStateOf("") }

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
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                "Синхр.",
                                color = if (pendingSyncCount > 0) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                },
                            )
                            if (syncConflictCount > 0) {
                                Text(
                                    "Конфликтов $syncConflictCount",
                                    color = MaterialTheme.colorScheme.error,
                                    fontSize = 10.sp,
                                )
                            }
                        }
                    }
                },
                actions = {
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
                items = items.filter { it.status == "active" },
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
    val locale = Locale("ru", "RU")
    val countries = items.mapNotNull { it.catalog?.country?.trim()?.takeIf(String::isNotEmpty) }.distinct()
    val metals = items.mapNotNull { it.catalog?.metal?.trim()?.takeIf(String::isNotEmpty) }.distinct().sorted()
    val filtered = items.filter { item ->
        val haystack = listOfNotNull(
            item.title,
            item.catalog?.country,
            item.catalog?.metal,
            item.identifiedYear?.toString(),
            item.catalog?.year?.toString(),
        ).joinToString(" ").lowercase(locale)
        val queryMatches = query.isBlank() || haystack.contains(query.trim().lowercase(locale))
        val metalMatches = selectedMetal == null || item.catalog?.metal == selectedMetal
        queryMatches && metalMatches
    }

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
                            Text("Монеты в альбоме", style = MaterialTheme.typography.displaySmall)
                        }
                        TextButton(onClick = { searchVisible = !searchVisible }) {
                            Text(if (searchVisible) "Закрыть" else "Поиск")
                        }
                    }
                    Spacer(Modifier.height(7.dp))
                    Text(
                        "${items.size} ${coinWord(items.size)} · ${countries.size} ${countryWord(countries.size)} · ${metals.size} ${metalWord(metals.size)}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
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
                                needsInitialSync -> "Получите свою коллекцию"
                                items.isEmpty() -> "Альбом пока пуст"
                                else -> "Монеты не найдены"
                            },
                            style = MaterialTheme.typography.titleLarge,
                        )
                        if (items.isEmpty()) {
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
            }
        }
    }
}

@Composable
private fun OverviewScreen(
    items: List<CollectionItem>,
    summary: CollectionSummary?,
    busy: Boolean,
    modifier: Modifier = Modifier,
) {
    val countries = items.mapNotNull { it.catalog?.country?.trim()?.takeIf(String::isNotEmpty) }
    val metals = items.mapNotNull { it.catalog?.metal?.trim()?.takeIf(String::isNotEmpty) }
    val years = items.mapNotNull { it.identifiedYear ?: it.catalog?.year }
    val countryCounts = countries.groupingBy { it }.eachCount().entries.sortedByDescending { it.value }
    val metalCounts = metals.groupingBy { pretty(it) }.eachCount().entries.sortedByDescending { it.value }

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
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Состав альбома", style = MaterialTheme.typography.titleLarge)
                    OverviewLine("Уникальных типов", summary?.distinctTypes?.toString() ?: "—")
                    OverviewLine("Дубликатов", summary?.duplicates?.toString() ?: "—")
                    OverviewLine("Требуют определения", summary?.unlinked?.toString() ?: "—")
                    if (years.isNotEmpty()) {
                        OverviewLine("Диапазон годов", "${years.minOrNull()}–${years.maxOrNull()}")
                    }
                }
            }
            summary?.valuation?.let { valuation ->
                val coveredCount = valuation.coveredCount.takeIf { it > 0 }
                    ?: (valuation.valuedCount + valuation.floorOnlyCount)
                val displayedTotal = valuation.conservativeTotalMinor ?: valuation.medianMinor
                if (coveredCount > 0 && displayedTotal != null) {
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
                                Text(
                                    "${rubles(displayedTotal)} ₽",
                                    style = MaterialTheme.typography.headlineSmall,
                                )
                                Text(
                                    "Учтено $coveredCount из ${summary.active}",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                if (valuation.floorOnlyCount > 0) {
                                    OverviewLine("Только по металлу", valuation.floorOnlyCount.toString())
                                }
                                if (valuation.unvaluedCount > 0) {
                                    OverviewLine("Без оценки", valuation.unvaluedCount.toString())
                                }
                            }
                        }
                    }
                }
            }
        }
        if (busy) CircularProgressIndicator(Modifier.align(Alignment.TopCenter).padding(top = 8.dp))
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
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontWeight = FontWeight.Medium)
    }
}

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
