package ru.begemot26.numismat

import android.os.Bundle
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.core.content.FileProvider
import coil.compose.AsyncImage
import ru.begemot26.numismat.data.CatalogType
import ru.begemot26.numismat.data.CollectionItem
import ru.begemot26.numismat.data.CollectionValuation
import ru.begemot26.numismat.data.CollectionSummary
import ru.begemot26.numismat.ui.EditorState
import ru.begemot26.numismat.ui.MainViewModel
import ru.begemot26.numismat.ui.Screen
import java.math.BigDecimal
import java.text.NumberFormat
import java.time.LocalDate
import java.io.File
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { NumismatTheme { NumismatApp() } }
    }
}

@Composable
private fun NumismatTheme(content: @Composable () -> Unit) {
    val colors = androidx.compose.material3.lightColorScheme(
        primary = Color(0xFF775A21),
        onPrimary = Color.White,
        primaryContainer = Color(0xFFF4DFA5),
        onPrimaryContainer = Color(0xFF291A00),
        secondary = Color(0xFF695E40),
        background = Color(0xFFFFF8F0),
        surface = Color(0xFFFFF8F0),
        surfaceVariant = Color(0xFFEDE2CF),
    )
    MaterialTheme(colorScheme = colors, content = content)
}

@Composable
private fun NumismatApp(vm: MainViewModel = viewModel()) {
    val ui by vm.state
    val editor = ui.editor
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(ui.error) {
        ui.error?.let {
            snackbar.showSnackbar(it)
            vm.clearError()
        }
    }
    LaunchedEffect(ui.notice) {
        ui.notice?.let {
            snackbar.showSnackbar(it)
            vm.clearNotice()
        }
    }

    Box(Modifier.fillMaxSize()) {
        when {
            ui.booting -> CircularProgressIndicator(Modifier.align(Alignment.Center))
            ui.user == null -> LoginScreen(ui.busy, vm::login, snackbar)
            ui.screen == Screen.EDITOR && editor != null -> EditorScreen(
                editor = editor,
                busy = ui.busy,
                onBack = vm::closeEditor,
                onChange = vm::updateEditor,
                onSearch = vm::searchCatalog,
                onSelect = vm::selectCatalog,
                onOwnLabel = vm::useOwnLabel,
                onSave = vm::saveEditor,
                onMarkSold = vm::markSold,
                onActivate = vm::activateItem,
                onDelete = vm::deleteItem,
                photoBusy = ui.photoBusy,
                onUploadPhoto = vm::uploadPhoto,
                onDeletePhoto = vm::deletePhoto,
                valuationBusy = ui.valuationBusy,
                onRecalculateValuation = vm::recalculateValuation,
                snackbar = snackbar,
            )
            else -> CollectionScreen(
                items = ui.items,
                summary = ui.summary,
                busy = ui.busy,
                onAdd = vm::newItem,
                onEdit = vm::editItem,
                onRefresh = vm::reloadCollection,
                onLogout = vm::logout,
                dataBusy = ui.dataBusy,
                onExport = vm::requestExport,
                onDeleteAccount = vm::deleteAccount,
                snackbar = snackbar,
            )
        }
    }
}

@Composable
private fun LoginScreen(
    busy: Boolean,
    onLogin: (String, String) -> Unit,
    snackbar: SnackbarHostState,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Нумизмат", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(28.dp))
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Почта") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Пароль") },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = { onLogin(email, password) },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text(if (busy) "Вход…" else "Войти") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CollectionScreen(
    items: List<CollectionItem>,
    summary: CollectionSummary?,
    busy: Boolean,
    onAdd: () -> Unit,
    onEdit: (CollectionItem) -> Unit,
    onRefresh: () -> Unit,
    onLogout: () -> Unit,
    dataBusy: Boolean,
    onExport: (String) -> Unit,
    onDeleteAccount: (String) -> Unit,
    snackbar: SnackbarHostState,
) {
    var showDataDialog by remember { mutableStateOf(false) }
    var showDeleteAccountDialog by remember { mutableStateOf(false) }
    var accountPassword by remember { mutableStateOf("") }

    if (showDataDialog) {
        AlertDialog(
            onDismissRequest = { if (!dataBusy) showDataDialog = false },
            title = { Text("Мои данные") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = accountPassword,
                        onValueChange = { accountPassword = it },
                        label = { Text("Пароль") },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedButton(
                        onClick = {
                            showDataDialog = false
                            onExport(accountPassword)
                            accountPassword = ""
                        },
                        enabled = !dataBusy && accountPassword.isNotBlank(),
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Скачать архив") }
                    TextButton(
                        onClick = {
                            showDataDialog = false
                            showDeleteAccountDialog = true
                        },
                        enabled = !dataBusy && accountPassword.isNotBlank(),
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Удалить аккаунт", color = MaterialTheme.colorScheme.error) }
                }
            },
            confirmButton = {
                TextButton(onClick = { showDataDialog = false }, enabled = !dataBusy) { Text("Закрыть") }
            },
        )
    }

    if (showDeleteAccountDialog) {
        AlertDialog(
            onDismissRequest = { if (!dataBusy) showDeleteAccountDialog = false },
            title = { Text("Удалить аккаунт?") },
            text = {
                Text("Вход будет отключён сразу. Через 7 дней коллекция и фотографии будут удалены без восстановления. Сначала скачайте архив, если он нужен.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteAccountDialog = false
                        onDeleteAccount(accountPassword)
                        accountPassword = ""
                    },
                    enabled = !dataBusy,
                ) { Text("Удалить", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showDeleteAccountDialog = false
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
                title = { Text("Моя коллекция") },
                navigationIcon = { TextButton(onClick = onRefresh, enabled = !busy) { Text("Обновить") } },
                actions = {
                    TextButton(onClick = { showDataDialog = true }, enabled = !busy && !dataBusy) { Text("Данные") }
                    TextButton(onClick = onLogout, enabled = !busy && !dataBusy) { Text("Выйти") }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onAdd) { Text("+", style = MaterialTheme.typography.headlineMedium) }
        },
    ) { padding ->
        if (items.isEmpty() && !busy) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("В коллекции пока нет монет", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp, 8.dp, 16.dp, 96.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                summary?.valuation?.takeIf { it.valuedCount > 0 }?.let { valuation ->
                    item {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text("Оценка коллекции", fontWeight = FontWeight.Medium)
                                Text(
                                    "${formatMoney(valuation.medianMinor!!)} ₽",
                                    style = MaterialTheme.typography.headlineSmall,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(
                                    "${formatMoney(valuation.lowMinor!!)}–${formatMoney(valuation.highMinor!!)} ₽ · ${valuation.valuedCount} из ${summary.active}",
                                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                                )
                            }
                        }
                    }
                }
                items(items, key = { it.id }) { item -> CollectionCard(item, onEdit) }
            }
        }
        if (busy || dataBusy) CircularProgressIndicator(Modifier.padding(padding).padding(16.dp))
    }
}

@Composable
private fun CollectionCard(item: CollectionItem, onEdit: (CollectionItem) -> Unit) {
    Card(
        onClick = { onEdit(item) },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(item.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium)
            val details = listOfNotNull(
                item.catalog?.year?.toString(),
                item.catalog?.metal,
                item.gradeCode,
            ).joinToString(" · ")
            if (details.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(details, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            item.purchasePriceMinor?.let {
                Spacer(Modifier.height(8.dp))
                Text("Покупка: ${formatMoney(it)} ₽", fontWeight = FontWeight.SemiBold)
            }
            item.valuation?.let { valuation ->
                Spacer(Modifier.height(8.dp))
                when (valuation.status) {
                    "ready" -> Text(
                        "Оценка: ${formatMoney(valuation.medianMinor!!)} ₽ · ${valuation.comparableCount} проходов",
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.SemiBold,
                    )
                    "insufficient_data" -> Text(
                        valuationReason(valuation),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (item.status == "sold") {
                Spacer(Modifier.height(8.dp))
                Text(
                    item.soldPriceMinor?.let { "Продана за ${formatMoney(it)} ₽" } ?: "Продана",
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                )
            } else if (item.status == "archived") {
                Spacer(Modifier.height(8.dp))
                Text("В архиве", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditorScreen(
    editor: EditorState,
    busy: Boolean,
    onBack: () -> Unit,
    onChange: ((EditorState) -> EditorState) -> Unit,
    onSearch: (String) -> Unit,
    onSelect: (CatalogType) -> Unit,
    onOwnLabel: () -> Unit,
    onSave: () -> Unit,
    onMarkSold: (String, String) -> Unit,
    onActivate: () -> Unit,
    onDelete: () -> Unit,
    photoBusy: Boolean,
    onUploadPhoto: (Uri, String, () -> Unit) -> Unit,
    onDeletePhoto: (String) -> Unit,
    valuationBusy: Boolean,
    onRecalculateValuation: () -> Unit,
    snackbar: SnackbarHostState,
) {
    var showSaleDialog by remember(editor.itemId, editor.itemStatus) { mutableStateOf(false) }
    var showDeleteDialog by remember(editor.itemId) { mutableStateOf(false) }
    var salePrice by remember(editor.itemId) { mutableStateOf(editor.soldPriceRub) }
    var saleDate by remember(editor.itemId) {
        mutableStateOf(editor.soldDate.ifBlank { LocalDate.now().toString() })
    }
    val context = LocalContext.current
    var pendingSide by remember(editor.itemId) { mutableStateOf("other") }
    var pendingCameraUri by remember(editor.itemId) { mutableStateOf<Uri?>(null) }
    var pendingCameraFile by remember(editor.itemId) { mutableStateOf<File?>(null) }
    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val uri = pendingCameraUri
        val file = pendingCameraFile
        pendingCameraUri = null
        pendingCameraFile = null
        if (success && uri != null) {
            onUploadPhoto(uri, pendingSide) { file?.delete() }
        } else {
            file?.delete()
        }
    }
    val pickerLauncher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let { onUploadPhoto(it, pendingSide) {} }
    }

    fun takePhoto(side: String) {
        val directory = File(context.cacheDir, "camera").apply { mkdirs() }
        val file = File.createTempFile("coin-", ".jpg", directory)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        pendingSide = side
        pendingCameraFile = file
        pendingCameraUri = uri
        cameraLauncher.launch(uri)
    }

    fun pickPhoto(side: String) {
        pendingSide = side
        pickerLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
    }

    if (showSaleDialog) {
        AlertDialog(
            onDismissRequest = { showSaleDialog = false },
            title = { Text("Продажа") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = salePrice,
                        onValueChange = { salePrice = it },
                        label = { Text("Цена продажи, ₽") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                    )
                    OutlinedTextField(
                        value = saleDate,
                        onValueChange = { saleDate = it },
                        label = { Text("Дата, ГГГГ-ММ-ДД") },
                        singleLine = true,
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    showSaleDialog = false
                    onMarkSold(salePrice, saleDate)
                }) { Text("Отметить проданной") }
            },
            dismissButton = { TextButton(onClick = { showSaleDialog = false }) { Text("Отмена") } },
        )
    }

    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            title = { Text("Удалить монету?") },
            text = { Text("Монета исчезнет из приложения. Для восстановления в течение 30 дней потребуется администратор.") },
            confirmButton = {
                TextButton(onClick = {
                    showDeleteDialog = false
                    onDelete()
                }) { Text("Удалить") }
            },
            dismissButton = { TextButton(onClick = { showDeleteDialog = false }) { Text("Отмена") } },
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(if (editor.itemId == null) "Новая монета" else "Монета") },
                navigationIcon = { TextButton(onClick = onBack) { Text("Назад") } },
                actions = { TextButton(onClick = onSave, enabled = !busy) { Text("Сохранить") } },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp, 8.dp, 16.dp, 40.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                editor.catalogTitle?.let { title ->
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(title, modifier = Modifier.weight(1f), fontWeight = FontWeight.Medium)
                            Spacer(Modifier.width(8.dp))
                            TextButton(onClick = onOwnLabel) { Text("Сменить") }
                        }
                    }
                }
            }
            if (editor.typeId == null) {
                item {
                    OutlinedTextField(
                        value = editor.catalogQuery,
                        onValueChange = onSearch,
                        label = { Text("Поиск в каталоге") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (editor.searching) item { CircularProgressIndicator() }
                items(editor.catalogResults, key = { it.id }) { type -> CatalogResult(type, onSelect) }
                item {
                    OutlinedTextField(
                        value = editor.label,
                        onValueChange = { value -> onChange { it.copy(label = value) } },
                        label = { Text("Название без привязки к каталогу") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            item {
                OutlinedTextField(
                    value = editor.grade,
                    onValueChange = { value -> onChange { it.copy(grade = value) } },
                    label = { Text("Состояние или грейд") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (editor.itemId != null) {
                item {
                    ValuationSection(
                        status = editor.valuationStatus,
                        valuation = editor.valuation,
                        history = editor.valuationHistory,
                        busy = valuationBusy,
                        onRecalculate = onRecalculateValuation,
                    )
                }
            }
            item {
                OutlinedTextField(
                    value = editor.priceRub,
                    onValueChange = { value -> onChange { it.copy(priceRub = value) } },
                    label = { Text("Цена покупки, ₽") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                OutlinedTextField(
                    value = editor.purchaseDate,
                    onValueChange = { value -> onChange { it.copy(purchaseDate = value) } },
                    label = { Text("Дата покупки, ГГГГ-ММ-ДД") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                OutlinedTextField(
                    value = editor.purchaseSource,
                    onValueChange = { value -> onChange { it.copy(purchaseSource = value) } },
                    label = { Text("Где куплена") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                OutlinedTextField(
                    value = editor.notes,
                    onValueChange = { value -> onChange { it.copy(notes = value) } },
                    label = { Text("Заметки") },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Button(onClick = onSave, enabled = !busy, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                    Text(if (busy) "Сохранение…" else "Сохранить")
                }
            }
            if (editor.itemId != null) {
                item {
                    PhotoSection(
                        photos = editor.photos,
                        busy = photoBusy,
                        onTake = ::takePhoto,
                        onPick = ::pickPhoto,
                        onDelete = onDeletePhoto,
                    )
                }
                item {
                    when (editor.itemStatus) {
                        "active" -> OutlinedButton(
                            onClick = { showSaleDialog = true },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth().height(52.dp),
                        ) { Text("Отметить проданной") }
                        "sold", "archived" -> OutlinedButton(
                            onClick = onActivate,
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth().height(52.dp),
                        ) { Text("Вернуть в коллекцию") }
                    }
                }
                item {
                    TextButton(
                        onClick = { showDeleteDialog = true },
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Удалить монету", color = MaterialTheme.colorScheme.error) }
                }
            }
        }
    }
}

@Composable
private fun ValuationSection(
    status: String,
    valuation: CollectionValuation?,
    history: List<CollectionValuation>,
    busy: Boolean,
    onRecalculate: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Рыночная оценка", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                if (busy || status == "pending") {
                    CircularProgressIndicator(Modifier.width(24.dp).height(24.dp))
                } else {
                    TextButton(onClick = onRecalculate) { Text("Обновить") }
                }
            }
            when {
                busy || status == "pending" -> Text("Расчёт по завершённым продажам")
                valuation?.status == "ready" -> {
                    Text(
                        "${formatMoney(valuation.medianMinor!!)} ₽",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        "${formatMoney(valuation.lowMinor!!)}–${formatMoney(valuation.highMinor!!)} ₽",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "Грейд ${valuation.gradeCode} · ${valuation.comparableCount} проходов · ${valuation.calculatedAt.take(10)}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                valuation != null -> Text(valuationReason(valuation))
                else -> Text("Оценка ещё не рассчитана")
            }
            val previous = history.filter { it.id != valuation?.id }.take(3)
            if (previous.isNotEmpty()) {
                Spacer(Modifier.height(4.dp))
                Text("История", fontWeight = FontWeight.Medium)
                previous.forEach { old ->
                    Text(
                        if (old.status == "ready") {
                            "${old.calculatedAt.take(10)} · ${old.gradeCode} · ${formatMoney(old.medianMinor!!)} ₽"
                        } else {
                            "${old.calculatedAt.take(10)} · ${old.gradeCode ?: "без грейда"} · без оценки"
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

private fun valuationReason(valuation: CollectionValuation): String = when (valuation.abstainReason) {
    "type_required" -> "Выберите тип монеты в каталоге"
    "grade_required" -> "Укажите грейд монеты"
    "not_enough_exact_grade_sales" -> "Недостаточно проходов грейда ${valuation.gradeCode}: ${valuation.comparableCount} из 3"
    else -> "Недостаточно данных для оценки"
}

@Composable
private fun PhotoSection(
    photos: List<ru.begemot26.numismat.ui.PhotoState>,
    busy: Boolean,
    onTake: (String) -> Unit,
    onPick: (String) -> Unit,
    onDelete: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Фотографии", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            if (busy) CircularProgressIndicator(modifier = Modifier.width(28.dp).height(28.dp))
        }
        if (photos.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                items(photos, key = { it.photo.id }) { state ->
                    Card(modifier = Modifier.width(190.dp)) {
                        Column(modifier = Modifier.padding(10.dp)) {
                            if (state.url != null) {
                                AsyncImage(
                                    model = state.url,
                                    contentDescription = sideLabel(state.photo.side),
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxWidth().height(150.dp),
                                )
                            } else {
                                Box(
                                    modifier = Modifier.fillMaxWidth().height(150.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(photoStatus(state.photo.status))
                                }
                            }
                            Text(sideLabel(state.photo.side), fontWeight = FontWeight.SemiBold)
                            TextButton(onClick = { onDelete(state.photo.id) }, enabled = !busy) {
                                Text("Удалить", color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
            }
        }
        if (photos.none { it.photo.side == "obverse" }) {
            PhotoActions("аверс", "obverse", busy, onTake, onPick)
        }
        if (photos.none { it.photo.side == "reverse" }) {
            PhotoActions("реверс", "reverse", busy, onTake, onPick)
        }
        if (photos.size < 4) {
            PhotoActions("ещё", "other", busy, onTake, onPick)
        }
    }
}

@Composable
private fun PhotoActions(
    label: String,
    side: String,
    busy: Boolean,
    onTake: (String) -> Unit,
    onPick: (String) -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedButton(
            onClick = { onTake(side) },
            enabled = !busy,
            modifier = Modifier.weight(1f),
        ) { Text("Снять $label") }
        TextButton(
            onClick = { onPick(side) },
            enabled = !busy,
            modifier = Modifier.weight(1f),
        ) { Text("Выбрать $label") }
    }
}

private fun sideLabel(side: String) = when (side) {
    "obverse" -> "Аверс"
    "reverse" -> "Реверс"
    else -> "Дополнительное фото"
}

private fun photoStatus(status: String) = when (status) {
    "pending", "processing" -> "Обработка…"
    "rejected" -> "Не удалось обработать"
    else -> "Фото готово"
}

@Composable
private fun CatalogResult(type: CatalogType, onSelect: (CatalogType) -> Unit) {
    Card(onClick = { onSelect(type) }, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Text(type.name, fontWeight = FontWeight.Medium)
            val details = listOfNotNull(
                type.year?.toString() ?: type.yearStart?.let { start -> type.yearEnd?.let { "$start–$it" } ?: start.toString() },
                type.metal,
                type.bitkinNumber?.let { "Биткин $it" },
            ).joinToString(" · ")
            if (details.isNotBlank()) Text(details, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val price = type.auctionMedian ?: type.marketMedian
            if (price != null) Text("Медиана проходов: ${formatWholeRubles(price)} ₽")
        }
    }
}

private fun formatMoney(minor: Long): String = BigDecimal(minor)
    .movePointLeft(2)
    .stripTrailingZeros()
    .toPlainString()

private fun formatWholeRubles(value: Long): String = NumberFormat
    .getIntegerInstance(Locale("ru", "RU"))
    .format(value)
