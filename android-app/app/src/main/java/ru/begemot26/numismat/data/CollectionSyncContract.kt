package ru.begemot26.numismat.data

internal data class SyncPhotoDownload(
    val url: String,
    val expectedOriginalSize: Long? = null,
    val expectedOriginalSha256: String? = null,
) {
    val verifiesOriginal: Boolean
        get() = expectedOriginalSize != null && expectedOriginalSha256 != null
}

internal fun syncPhotoDownload(photo: CollectionPhoto): SyncPhotoDownload {
    photo.displayUrl?.takeIf { it.isNotBlank() }?.let { return SyncPhotoDownload(it) }
    return SyncPhotoDownload(
        url = requireNotNull(photo.originalUrl) { "Сервер не передал фотографию." },
        expectedOriginalSize = photo.byteSize,
        expectedOriginalSha256 = requireNotNull(photo.sha256) {
            "Сервер не передал контрольную сумму фотографии."
        },
    )
}

internal fun validateCollectionSyncPage(page: CollectionSyncResponse) {
    require(page.nextCursor.isNotBlank()) { "Сервер вернул пустую позицию синхронизации." }
    page.changes.forEach { change ->
        require(change.entityKind in setOf("item", "photo", "valuation")) {
            "Сервер вернул неизвестный тип изменения."
        }
        require(change.operation in setOf("upsert", "delete")) {
            "Сервер вернул неизвестную операцию синхронизации."
        }
        require(change.entityId.isNotBlank() && change.itemId.isNotBlank() && change.seq.isNotBlank()) {
            "Сервер вернул неполное изменение."
        }
        if (change.operation == "upsert") {
            val present = when (change.entityKind) {
                "item" -> change.item != null
                "photo" -> change.photo != null
                "valuation" -> change.valuation != null
                else -> false
            }
            require(present) { "Сервер не передал данные изменения." }
        }
    }
}
