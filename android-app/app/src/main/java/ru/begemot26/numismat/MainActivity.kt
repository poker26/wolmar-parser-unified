package ru.begemot26.numismat

import android.os.Bundle
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.Typography
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.core.content.FileProvider
import coil.compose.AsyncImage
import ru.begemot26.numismat.data.CatalogType
import ru.begemot26.numismat.data.CollectionItem
import ru.begemot26.numismat.data.KrauseReference
import ru.begemot26.numismat.data.KrauseRange
import ru.begemot26.numismat.data.CollectionValuation
import ru.begemot26.numismat.data.CollectionSummary
import ru.begemot26.numismat.data.MarketEvidence
import ru.begemot26.numismat.data.MarketEvent
import ru.begemot26.numismat.ui.EditorState
import ru.begemot26.numismat.ui.IdentificationState
import ru.begemot26.numismat.ui.MainViewModel
import ru.begemot26.numismat.ui.SaleReferenceKind
import ru.begemot26.numismat.ui.Screen
import ru.begemot26.numismat.ui.soldCoinComparison
import java.math.BigDecimal
import java.math.RoundingMode
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
    val colors = darkColorScheme(
        primary = Color(0xFFD9894B),
        onPrimary = Color(0xFF1B1109),
        primaryContainer = Color(0xFF3B2A20),
        onPrimaryContainer = Color(0xFFFFD8B8),
        secondary = Color(0xFFE3B66C),
        onSecondary = Color(0xFF211607),
        tertiary = Color(0xFF86C7A0),
        onTertiary = Color(0xFF082115),
        background = Color(0xFF101114),
        onBackground = Color(0xFFF5F1E8),
        surface = Color(0xFF15161A),
        onSurface = Color(0xFFF5F1E8),
        surfaceVariant = Color(0xFF1A1B20),
        onSurfaceVariant = Color(0xFFB9B2A7),
        outline = Color(0xFF3B3C42),
        error = Color(0xFFFFB4AB),
    )
    val typography = Typography(
        displaySmall = TextStyle(
            fontFamily = FontFamily.Serif,
            fontWeight = FontWeight.Medium,
            fontSize = 32.sp,
            lineHeight = 34.sp,
        ),
        headlineLarge = TextStyle(
            fontFamily = FontFamily.Serif,
            fontWeight = FontWeight.Medium,
            fontSize = 30.sp,
            lineHeight = 32.sp,
        ),
        headlineSmall = TextStyle(
            fontFamily = FontFamily.Serif,
            fontWeight = FontWeight.Medium,
            fontSize = 30.sp,
            lineHeight = 32.sp,
        ),
        titleLarge = TextStyle(
            fontFamily = FontFamily.Serif,
            fontWeight = FontWeight.Medium,
            fontSize = 26.sp,
            lineHeight = 28.sp,
        ),
    )
    val shapes = Shapes(
        extraSmall = RoundedCornerShape(4.dp),
        small = RoundedCornerShape(5.dp),
        medium = RoundedCornerShape(7.dp),
        large = RoundedCornerShape(9.dp),
        extraLarge = RoundedCornerShape(12.dp),
    )
    MaterialTheme(colorScheme = colors, typography = typography, shapes = shapes, content = content)
}

@Composable
private fun NumismatApp(vm: MainViewModel = viewModel()) {
    val ui by vm.state
    val editor = ui.editor
    val identification = ui.identification
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current
    var pendingAddPath by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingOtherSide by rememberSaveable { mutableStateOf(false) }
    val addCameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val file = pendingAddPath?.let(::File)
        pendingAddPath = null
        if (success && file != null) {
            val uri = Uri.fromFile(file)
            if (pendingOtherSide) {
                vm.identifyOtherSide(uri) { file?.delete() }
            } else {
                vm.identifyCoin(uri) { file?.delete() }
            }
        } else {
            file?.delete()
        }
        pendingOtherSide = false
    }

    fun addCoin() {
        runCatching {
            val directory = File(context.filesDir, "captures").apply { mkdirs() }
            val file = File.createTempFile("coin-obverse-", ".jpg", directory)
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
            pendingAddPath = file.absolutePath
            pendingOtherSide = false
            addCameraLauncher.launch(uri)
        }.onFailure {
            pendingAddPath?.let(::File)?.delete()
            pendingAddPath = null
            vm.cameraUnavailable()
        }
    }

    fun photographOtherSide() {
        runCatching {
            val directory = File(context.filesDir, "captures").apply { mkdirs() }
            val file = File.createTempFile("coin-reverse-", ".jpg", directory)
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
            pendingAddPath = file.absolutePath
            pendingOtherSide = true
            addCameraLauncher.launch(uri)
        }.onFailure {
            pendingAddPath?.let(::File)?.delete()
            pendingAddPath = null
            pendingOtherSide = false
            vm.cameraUnavailable()
        }
    }

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
            ui.screen == Screen.IDENTIFICATION && identification != null -> IdentificationScreen(
                identification = identification,
                busy = ui.busy,
                onBack = vm::cancelIdentification,
                onRetake = {
                    vm.cancelIdentification()
                    addCoin()
                },
                onOtherSide = ::photographOtherSide,
                onSelect = vm::selectIdentificationCandidate,
                onConfirm = vm::confirmIdentification,
                snackbar = snackbar,
            )
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
                onArchive = vm::archiveItem,
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
                itemImageUrls = ui.itemImageUrls,
                summary = ui.summary,
                busy = ui.busy,
                pendingSyncCount = ui.pendingSyncCount,
                syncConflictCount = ui.syncConflictCount,
                syncConflictReview = ui.syncConflictReview,
                needsInitialSync = ui.needsInitialSync,
                onAdd = ::addCoin,
                onEdit = vm::editItem,
                onRefresh = vm::reloadCollection,
                onReviewConflicts = vm::reviewSyncConflicts,
                onKeepLocalConflict = vm::keepLocalConflict,
                onUseServerConflict = vm::useServerConflict,
                onCloseConflictReview = vm::closeConflictReview,
                onLogout = vm::logout,
                dataBusy = ui.dataBusy,
                onExport = vm::requestExport,
                onDeleteAccount = vm::deleteAccount,
                snackbar = snackbar,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun IdentificationScreen(
    identification: IdentificationState,
    busy: Boolean,
    onBack: () -> Unit,
    onRetake: () -> Unit,
    onOtherSide: () -> Unit,
    onSelect: (Long) -> Unit,
    onConfirm: () -> Unit,
    snackbar: SnackbarHostState,
) {
    val awaitingSecondSide = identification.photos.size < 2
    val extracted = identification.extracted
    val details = listOfNotNull(
        listOfNotNull(extracted.denominationValue, extracted.denominationUnit).takeIf { it.isNotEmpty() }?.joinToString(" "),
        extracted.year?.toString(),
        extracted.metal,
        extracted.mint,
        extracted.gradingCompanyCode,
        extracted.gradeCode,
        extracted.slabCertificateNumber,
    ).joinToString(" · ")

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    Text(if (awaitingSecondSide) "Добавить монету" else "Проверка")
                },
                navigationIcon = { TextButton(onClick = onBack, enabled = !busy) { Text("Назад") } },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    titleContentColor = MaterialTheme.colorScheme.onBackground,
                ),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp, 8.dp, 20.dp, 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { StepProgress(if (awaitingSecondSide) 1 else 2) }
            item {
                Text(
                    if (awaitingSecondSide) "Аверс готов" else "Определение монеты",
                    color = MaterialTheme.colorScheme.secondary,
                    style = MaterialTheme.typography.labelMedium,
                    letterSpacing = 1.1.sp,
                )
                Spacer(Modifier.height(5.dp))
                Text(
                    if (awaitingSecondSide) "Теперь снимите реверс" else "Проверьте результат",
                    style = MaterialTheme.typography.headlineLarge,
                )
            }
            item { IdentificationPhotos(identification) }
            if (details.isNotBlank()) {
                item {
                    Text(details, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            identification.recognizedName?.let { recognizedName ->
                item {
                    Text(recognizedName, style = MaterialTheme.typography.titleLarge)
                }
            }
            if (!awaitingSecondSide && identification.candidates.isEmpty()) {
                item {
                    Text("В каталоге пока нет точного совпадения", style = MaterialTheme.typography.titleMedium)
                }
            } else {
                items(identification.candidates, key = { it.id }) { candidate ->
                    val selected = candidate.id == identification.selectedTypeId
                    Card(
                        onClick = { onSelect(candidate.id) },
                        colors = CardDefaults.cardColors(
                            containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                        ),
                        border = BorderStroke(
                            1.dp,
                            if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = selected, onClick = { onSelect(candidate.id) })
                            Column(modifier = Modifier.weight(1f)) {
                                Text(candidate.name, fontWeight = FontWeight.Medium)
                                val meta = listOfNotNull(
                                    candidate.year?.toString(),
                                    candidate.denomination,
                                    candidate.bitkinNumber?.let { "Биткин $it" },
                                ).joinToString(" · ")
                                if (meta.isNotBlank()) {
                                    Text(meta, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                candidate.krauseReference?.let { reference ->
                                    krauseReferenceLine(reference)?.let { line ->
                                        Text(line, color = MaterialTheme.colorScheme.primary)
                                    }
                                }
                                candidate.krauseRange?.let { range ->
                                    Text(krauseRangeLine(range), color = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }
                    }
                }
            }
            if (!awaitingSecondSide && identification.candidates.isNotEmpty()) {
                item {
                    Text(
                        "Проверьте год, номинал и металл — от них зависит оценка.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            item {
                if (awaitingSecondSide) {
                    Button(
                        onClick = onOtherSide,
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                    ) { Text("Снять реверс") }
                } else {
                    Button(
                        onClick = onConfirm,
                        enabled = !busy &&
                            (identification.selectedTypeId != null ||
                                (identification.candidates.isEmpty() && !identification.recognizedName.isNullOrBlank())),
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                    ) { Text("Это моя монета") }
                    Spacer(Modifier.height(2.dp))
                    OutlinedButton(
                        onClick = onRetake,
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                    ) { Text("Переснять") }
                }
            }
            if (busy) {
                item { CircularProgressIndicator() }
            }
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
    var passwordVisible by remember { mutableStateOf(false) }
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Box(
                modifier = Modifier.size(48.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary),
                contentAlignment = Alignment.Center,
            ) {
                Text("N", color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.titleLarge)
            }
            Spacer(Modifier.height(18.dp))
            Text("Numi", style = MaterialTheme.typography.displaySmall)
            Spacer(Modifier.height(6.dp))
            Text("Личный кабинет коллекционера", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(32.dp))
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
                visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    TextButton(onClick = { passwordVisible = !passwordVisible }) {
                        Text(if (passwordVisible) "Скрыть" else "Показать")
                    }
                },
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
private fun LegacyCollectionScreen(
    items: List<CollectionItem>,
    itemImageUrls: Map<String, String>,
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
            title = { Text("Профиль и данные") },
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
                    OutlinedButton(
                        onClick = {
                            showDataDialog = false
                            accountPassword = ""
                            onLogout()
                        },
                        enabled = !dataBusy,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Выйти") }
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
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(30.dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.primary),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("N", color = MaterialTheme.colorScheme.onPrimary, fontFamily = FontFamily.Serif)
                        }
                        Spacer(Modifier.width(8.dp))
                        Text("Numi", style = MaterialTheme.typography.titleMedium)
                    }
                },
                navigationIcon = {
                    TextButton(onClick = onRefresh, enabled = !busy) {
                        Text("↻", fontSize = 24.sp)
                    }
                },
                actions = {
                    TextButton(onClick = { showDataDialog = true }, enabled = !busy && !dataBusy) {
                        Text("•••", fontSize = 20.sp)
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    titleContentColor = MaterialTheme.colorScheme.onBackground,
                ),
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onAdd,
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                shape = CircleShape,
            ) { Text("＋  Добавить монету") }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp, 12.dp, 20.dp, 108.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            item {
                Text(
                    "МОЯ КОЛЛЕКЦИЯ · ${summary?.active ?: items.count { it.status == "active" }} МОНЕТ",
                    color = MaterialTheme.colorScheme.secondary,
                    style = MaterialTheme.typography.labelMedium,
                    letterSpacing = 1.2.sp,
                )
                Spacer(Modifier.height(6.dp))
                Text("Собрано со смыслом", style = MaterialTheme.typography.displaySmall)
                Spacer(Modifier.height(22.dp))
            }
            summary?.valuation?.takeIf { it.valuedCount > 0 && it.medianMinor != null }?.let { valuation ->
                val median = valuation.medianMinor ?: return@let
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Оценка коллекции", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(
                                "${formatMoney(median)} ₽",
                                style = MaterialTheme.typography.headlineSmall,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            if (valuation.rangeAvailable && valuation.lowMinor != null && valuation.highMinor != null) {
                                Text(
                                    "Рыночный диапазон: ${formatMoney(valuation.lowMinor)}–${formatMoney(valuation.highMinor)} ₽",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Spacer(Modifier.height(6.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text("Оценено ${valuation.valuedCount} из ${summary.active}")
                                Text(
                                    "${(valuation.valuedCount * 100 / summary.active.coerceAtLeast(1))}%",
                                    color = MaterialTheme.colorScheme.secondary,
                                )
                            }
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .height(4.dp)
                                    .clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.outline),
                            ) {
                                Box(
                                    Modifier
                                        .fillMaxWidth(
                                            (valuation.valuedCount.toFloat() / summary.active.coerceAtLeast(1))
                                                .coerceIn(0f, 1f),
                                        )
                                        .height(4.dp)
                                        .background(MaterialTheme.colorScheme.primary),
                                )
                            }
                        }
                    }
                    Spacer(Modifier.height(26.dp))
                }
            }
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Монеты", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium)
                    Text("По обновлению оценки", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (items.isEmpty() && !busy) {
                item {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 52.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text("Коллекция пуста", style = MaterialTheme.typography.titleLarge)
                        Spacer(Modifier.height(8.dp))
                        Text("Добавьте первую монету", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            } else {
                items(items, key = { it.id }) { item -> CollectionCard(item, onEdit) }
            }
        }
        if (busy || dataBusy) CircularProgressIndicator(Modifier.padding(padding).padding(16.dp))
    }
}

@Composable
private fun IdentificationPhotos(identification: IdentificationState) {
    val context = LocalContext.current
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        identification.photos.take(2).forEachIndexed { index, photo ->
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                modifier = Modifier.weight(1f).aspectRatio(1f),
            ) {
                AsyncImage(
                        model = File(context.filesDir, photo.metadata.displayPath),
                        contentDescription = if (index == 0) "Аверс" else "Реверс",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
            }
        }
        if (identification.photos.size == 1) {
            Box(
                modifier = Modifier.weight(1f).aspectRatio(1f)
                    .background(MaterialTheme.colorScheme.surfaceVariant),
                contentAlignment = Alignment.Center,
            ) {
                Text("Реверс", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun StepProgress(step: Int) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        repeat(3) { index ->
            Box(
                Modifier
                    .weight(1f)
                    .height(3.dp)
                    .background(
                        if (index < step) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.outline,
                    ),
            )
        }
    }
}

@Composable
private fun CollectionCard(item: CollectionItem, onEdit: (CollectionItem) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onEdit(item) }
            .padding(vertical = 12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            CoinThumbnail(item)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
            Text(
                item.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Medium,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
            val details = listOfNotNull(
                item.identifiedYear?.toString() ?: item.catalog?.year?.toString(),
                item.catalog?.metal,
                item.gradingCompanyCode,
                item.gradeCode,
            ).joinToString(" · ")
            if (details.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(details, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            }
            Spacer(Modifier.width(12.dp))
            Column(horizontalAlignment = Alignment.End) {
            item.valuation?.let { valuation ->
                when (valuation.status) {
                    "ready" -> valuation.medianMinor?.let { value ->
                        Text(
                            "${if (valuation.estimateKind == "metal_floor") "≥ " else ""}${formatMoney(value)} ₽",
                            color = MaterialTheme.colorScheme.onSurface,
                            fontWeight = FontWeight.Medium,
                        )
                        Spacer(Modifier.height(3.dp))
                        Text(
                            if (valuation.estimateKind == "metal_floor") "по металлу"
                            else "${valuation.comparableCount} продаж",
                            color = MaterialTheme.colorScheme.secondary,
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                    "insufficient_data" -> Text("Нет оценки", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (item.status == "sold") {
                Text(
                    item.soldPriceMinor?.let { "Продана за ${formatMoney(it)} ₽" } ?: "Продана",
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Medium,
                )
            } else if (item.status == "archived") {
                Text("В архиве", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            }
        }
        Spacer(Modifier.height(12.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(MaterialTheme.colorScheme.outline.copy(alpha = 0.65f)))
    }
}

@Composable
private fun CoinThumbnail(item: CollectionItem) {
    val image = item.catalog?.imageUrl
    if (image != null) {
        AsyncImage(
            model = image,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(52.dp).clip(CircleShape),
        )
    } else {
        Box(
            modifier = Modifier
                .size(52.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.secondary),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                item.title.take(1).uppercase(Locale("ru")),
                color = MaterialTheme.colorScheme.onSecondary,
                style = MaterialTheme.typography.titleLarge,
            )
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
    onArchive: () -> Unit,
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
            }
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
                    onValueChange = { value ->
                        onChange {
                            if (value == it.grade) {
                                it
                            } else {
                                it.copy(
                                    grade = value,
                                    gradeSource = "user",
                                    valuationStatus = "not_calculated",
                                    valuation = null,
                                    valuationHistory = emptyList(),
                                )
                            }
                        }
                    },
                    label = { Text("Состояние или грейд") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (editor.slabStatus == "slabbed") {
                item {
                    Text(
                        listOfNotNull(editor.gradingCompanyCode, editor.slabCertificateNumber)
                            .joinToString(" · "),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (editor.itemId != null) {
                editor.krauseReference?.let { reference ->
                    item { KrauseReferenceSection(reference) }
                }
                editor.krauseRange?.let { range ->
                    item { KrauseRangeSection(range) }
                }
                item {
                    ValuationSection(
                        status = editor.valuationStatus,
                        valuation = editor.valuation,
                        history = editor.valuationHistory,
                        market = editor.marketEvidence,
                        busy = valuationBusy,
                        onRecalculate = onRecalculateValuation,
                    )
                }
                editor.marketEvidence?.let { market ->
                    item {
                        MarketEvidenceSection(
                            market = market,
                            showMetalFloor = editor.valuation?.valueFloorMinor == null,
                        )
                    }
                }
                if (editor.itemStatus == "sold") {
                    item { SaleResultSection(editor) }
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
                    when (editor.itemStatus) {
                        "active" -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedButton(
                                onClick = { showSaleDialog = true },
                                enabled = !busy,
                                modifier = Modifier.fillMaxWidth().height(52.dp),
                            ) { Text("Отметить проданной") }
                            OutlinedButton(
                                onClick = onArchive,
                                enabled = !busy,
                                modifier = Modifier.fillMaxWidth().height(52.dp),
                            ) { Text("Перенести в архив") }
                        }
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
private fun SaleResultSection(editor: EditorState) {
    val comparison = soldCoinComparison(
        purchaseRubles = editor.priceRub,
        saleRubles = editor.soldPriceRub,
        soldDate = editor.soldDate,
        currentValuation = editor.valuation,
        valuationHistory = editor.valuationHistory,
    )
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text("Результат продажи", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            comparison.saleMinor?.let { SaleResultLine("Цена продажи", it) }
            comparison.purchaseMinor?.let { SaleResultLine("Цена покупки", it) }
            comparison.referenceMinor?.let { reference ->
                val label = when (comparison.referenceKind) {
                    SaleReferenceKind.MARKET -> "Оценка"
                    SaleReferenceKind.METAL_FLOOR -> "Нижний предел по металлу"
                    null -> "Ориентир"
                }
                SaleResultLine(
                    listOfNotNull(label, comparison.referenceDate).joinToString(" · "),
                    reference,
                )
            }
            comparison.differenceFromPurchaseMinor?.let { difference ->
                SaleDifferenceLine("К цене покупки", difference)
            }
            comparison.differenceFromReferenceMinor?.let { difference ->
                SaleDifferenceLine(
                    if (comparison.referenceKind == SaleReferenceKind.METAL_FLOOR) "Выше нижнего предела" else "К оценке",
                    difference,
                )
            }
        }
    }
}

@Composable
private fun SaleResultLine(label: String, amountMinor: Long) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onPrimaryContainer)
        Text("${formatMoney(amountMinor)} ₽", fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun SaleDifferenceLine(label: String, differenceMinor: Long) {
    val sign = if (differenceMinor > 0) "+" else ""
    val color = when {
        differenceMinor > 0 -> MaterialTheme.colorScheme.tertiary
        differenceMinor < 0 -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.onPrimaryContainer
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onPrimaryContainer)
        Text("$sign${formatMoney(differenceMinor)} ₽", color = color, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun KrauseReferenceSection(reference: KrauseReference) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(krauseTitle(reference.publicationYear), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            reference.basisAmountMinor?.let { amount ->
                Text(
                    formatUsd(amount),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                reference.basisGradeCode?.let { Text(it) }
            }
            if (reference.uncirculatedLowMinor != null && reference.uncirculatedHighMinor != null) {
                Text(
                    "Без следов обращения: ${formatUsd(reference.uncirculatedLowMinor)}–${formatUsd(reference.uncirculatedHighMinor)}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (reference.prices.isNotEmpty()) {
                Text(
                    reference.prices.entries
                        .sortedBy { krauseGradeRank(it.key) }
                        .joinToString(" · ") { (grade, amount) -> "$grade ${formatUsd(amount)}" },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            reference.mintage?.let { mintage ->
                Text("Тираж: ${String.format("%,d", mintage).replace(',', ' ')}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun KrauseRangeSection(range: KrauseRange) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(krauseTitle(range.publicationYear), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(
                formatUsdRange(range.lowMinor, range.highMinor),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text("${range.basisGradeCode} · ${range.variantCount} ${variantWord(range.variantCount)}")
        }
    }
}

@Composable
private fun ValuationSection(
    status: String,
    valuation: CollectionValuation?,
    history: List<CollectionValuation>,
    market: MarketEvidence?,
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
                valuation?.status == "floor_only" && valuation.valueFloorMinor != null -> {
                    Text("Нижний предел по металлу", fontWeight = FontWeight.Medium)
                    Text(
                        "≥ ${formatMoney(valuation.valueFloorMinor)} ₽",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                valuation?.status == "ready" -> {
                    if (valuation.estimateKind == "single_comparable") {
                        Text("Ориентир", fontWeight = FontWeight.Medium)
                    }
                    Text(
                        "${formatMoney(valuation.medianMinor!!)} ₽",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (valuation.rangeAvailable && valuation.lowMinor != null && valuation.highMinor != null) {
                        Text(
                            "${formatMoney(valuation.lowMinor)}–${formatMoney(valuation.highMinor)} ₽",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(
                        "Грейд ${valuation.gradeCode} · ${valuation.comparableCount} проходов · ${valuation.calculatedAt.take(10)}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                valuation != null -> Text(valuationReason(valuation, market?.activity?.confirmedSalesCount ?: 0))
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

@Composable
private fun MarketEvidenceSection(market: MarketEvidence, showMetalFloor: Boolean) {
    var showAllEvents by rememberSaveable(market.issue.typeId) { mutableStateOf(false) }
    val uriHandler = LocalUriHandler.current
    val activity = market.activity
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Рынок выпуска", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            val issueFacts = listOfNotNull(
                market.issue.denomination,
                market.issue.year?.toString(),
                market.issue.metal,
                market.issue.mint,
                market.issue.massGrams?.let { "${formatDecimal(it)} г" },
            ).distinct()
            if (issueFacts.isNotEmpty()) {
                Text(issueFacts.joinToString(" · "), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            if (activity.confirmedSalesCount > 0) {
                Text(
                    "${activity.confirmedSalesCount} ${salesWord(activity.confirmedSalesCount)} на ${activity.venuesCount} ${venueWord(activity.venuesCount)}",
                    style = MaterialTheme.typography.titleSmall,
                )
                activity.lastConfirmedSaleAt?.let { date ->
                    val price = activity.lastConfirmedSalePriceMinor
                    Text(
                        if (price != null) {
                            "Последняя продажа ${formatCurrencyAmount(price, activity.lastConfirmedSaleCurrency)} · $date"
                        } else {
                            "Последняя продажа $date"
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                Text("Подтверждённые продажи не найдены")
            }

            if (showMetalFloor) market.metalFloor?.let { floor ->
                Spacer(Modifier.height(2.dp))
                Text("Стоимость металла", style = MaterialTheme.typography.titleSmall)
                Text(
                    formatCurrencyAmount(floor.valueMinor, floor.currency),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    "${formatDecimal(floor.pureWeightGrams)} г ${floor.metal}" +
                        (floor.priceDate?.let { " · цена на $it" } ?: ""),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (market.gradeBuckets.isNotEmpty()) {
                Spacer(Modifier.height(2.dp))
                Text("Продажи по состоянию", style = MaterialTheme.typography.titleSmall)
                market.gradeBuckets.forEach { bucket ->
                    val grade = listOfNotNull(
                        bucket.gradeCode ?: "Состояние не указано",
                        when (bucket.slabStatus) {
                            "slabbed" -> "В слабе"
                            "raw" -> "Без слаба"
                            else -> "Слаб не указан"
                        },
                        bucket.gradingCompanyCode,
                    ).joinToString(" · ")
                    val low = bucket.minPriceMinor
                    val high = bucket.maxPriceMinor
                    val price = when {
                        low == null || high == null -> null
                        low == high -> formatCurrencyAmount(low, bucket.currency)
                        else -> "${formatMoney(low)}–${formatCurrencyAmount(high, bucket.currency)}"
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column(Modifier.weight(1f)) {
                            Text(grade, fontWeight = FontWeight.Medium)
                            Text(
                                "${bucket.salesCount} ${salesWord(bucket.salesCount)}",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        price?.let { Text(it, fontWeight = FontWeight.Medium) }
                    }
                }
            }

            buildList {
                if (activity.activeOffersCount > 0) add("Активные предложения ${activity.activeOffersCount}")
                if (activity.endedUnsoldCount > 0) add("Лоты без продажи ${activity.endedUnsoldCount}")
                if (activity.closedUnconfirmedCount > 0) {
                    add("Закрытые лоты без подтверждённой продажи ${activity.closedUnconfirmedCount}")
                }
            }.forEach { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }

            if (market.events.isNotEmpty()) {
                Spacer(Modifier.height(2.dp))
                Text("Последние события", style = MaterialTheme.typography.titleSmall)
                val visible = if (showAllEvents) market.events else market.events.take(6)
                visible.forEach { event ->
                    MarketEventRow(
                        event = event,
                        onOpen = event.sourceUrl?.let { url -> { uriHandler.openUri(url) } },
                    )
                }
                if (market.events.size > 6) {
                    TextButton(onClick = { showAllEvents = !showAllEvents }) {
                        Text(if (showAllEvents) "Свернуть" else "Показать ещё")
                    }
                }
            }
            if (activity.excludedEvidenceCount > 0) {
                Text(
                    "Не вошли в статистику ${activity.excludedEvidenceCount}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun MarketEventRow(event: MarketEvent, onOpen: (() -> Unit)?) {
    val label = when (event.kind) {
        "confirmed_sale" -> "Продано"
        "active_offer" -> "Предлагают"
        "ended_unsold" -> "Не продано"
        else -> "Продажа не подтверждена"
    }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, fontWeight = FontWeight.Medium)
            Text(
                listOfNotNull(event.eventDate, event.sourceName ?: event.source, event.gradeCode)
                    .joinToString(" · "),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            event.priceMinor?.let { price ->
                Text(
                    formatCurrencyAmount(price, event.currency),
                    fontWeight = FontWeight.Medium,
                )
            }
            if (onOpen != null) TextButton(onClick = onOpen) { Text("Открыть") }
        }
    }
}

private fun valuationReason(valuation: CollectionValuation, marketSales: Int): String = when {
    marketSales > 0 -> "Для этого состояния нет надёжного диапазона"
    valuation.abstainReason == "type_required" -> "Выберите тип монеты в каталоге"
    valuation.abstainReason == "grade_required" -> "Укажите грейд монеты"
    valuation.abstainReason == "not_enough_exact_grade_sales" -> "Для этого состояния нет надёжного диапазона"
    else -> "Недостаточно данных для оценки"
}

private fun formatDecimal(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString() else String.format(Locale("ru", "RU"), "%.2f", value)

private fun formatCurrencyAmount(minor: Long, currency: String?): String =
    "${formatMoney(minor)} ${if (currency.equals("RUB", ignoreCase = true)) "₽" else currency ?: ""}".trim()

private fun salesWord(count: Int): String = when {
    count % 10 == 1 && count % 100 != 11 -> "продажа"
    count % 10 in 2..4 && count % 100 !in 12..14 -> "продажи"
    else -> "продаж"
}

private fun venueWord(count: Int): String = if (count == 1) "площадке" else "площадках"

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
                                    model = java.io.File(state.url),
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

private fun formatMoney(minor: Long): String = NumberFormat
    .getNumberInstance(Locale("ru", "RU"))
    .apply {
        minimumFractionDigits = 0
        maximumFractionDigits = 2
    }
    .format(BigDecimal(minor).movePointLeft(2))

private fun formatUsd(minor: Long): String = "$" + BigDecimal(minor)
    .movePointLeft(2)
    .setScale(2, RoundingMode.HALF_UP)
    .toPlainString()

private fun krauseTitle(publicationYear: Int?): String =
    publicationYear?.let { "Краузе $it" } ?: "Краузе"

private fun krauseReferenceLine(reference: KrauseReference): String? {
    val amount = reference.basisAmountMinor ?: return null
    val details = listOfNotNull(formatUsd(amount), reference.basisGradeCode).joinToString(" · ")
    return "${krauseTitle(reference.publicationYear)}: $details"
}

private fun krauseRangeLine(range: KrauseRange): String =
    "${krauseTitle(range.publicationYear)}: ${formatUsdRange(range.lowMinor, range.highMinor)} · " +
        "${range.basisGradeCode} · ${range.variantCount} ${variantWord(range.variantCount)}"

private fun formatUsdRange(lowMinor: Long, highMinor: Long): String =
    if (lowMinor == highMinor) formatUsd(lowMinor) else "${formatUsd(lowMinor)}–${formatUsd(highMinor)}"

private fun variantWord(count: Int): String {
    val lastTwo = count % 100
    val last = count % 10
    return when {
        lastTwo in 11..14 -> "вариантов"
        last == 1 -> "вариант"
        last in 2..4 -> "варианта"
        else -> "вариантов"
    }
}

private fun krauseGradeRank(grade: String): Int = listOf(
    "G4", "VG8", "F12", "VF20", "XF40", "AU50", "MS60", "MS63", "MS65", "PF60", "PF63", "PF65",
).indexOf(grade.uppercase()).let { if (it < 0) Int.MAX_VALUE else it }

private fun formatWholeRubles(value: Long): String = NumberFormat
    .getIntegerInstance(Locale("ru", "RU"))
    .format(value)
