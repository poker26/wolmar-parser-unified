package ru.begemot26.numismat.data

import android.content.ContentResolver
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.provider.OpenableColumns
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.Serializable
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Semaphore
import kotlin.math.roundToInt

/**
 * Persistent, app-private photo files. All methods do disk/bitmap work and must be called from a
 * background thread.
 */
class LocalPhotoStore(context: Context) {
    private val appContext = context.applicationContext
    private val mediaRoot = File(appContext.filesDir, MEDIA_DIRECTORY)

    fun importPhoto(
        accountId: String,
        photoId: String,
        source: Uri,
        mimeTypeHint: String? = null,
    ): LocalPhotoMetadata {
        val resolver = appContext.contentResolver
        val sourceName = resolver.displayName(source) ?: source.lastPathSegment
        val mimeType = mimeTypeHint ?: resolver.getType(source)
        return importPhoto(accountId, photoId, sourceName, mimeType) {
            openUri(resolver, source)
        }
    }

    fun importPhoto(
        accountId: String,
        photoId: String,
        source: File,
        mimeTypeHint: String? = null,
    ): LocalPhotoMetadata {
        require(source.isFile) { "Photo source does not exist: $source" }
        return importPhoto(accountId, photoId, source.name, mimeTypeHint) {
            FileInputStream(source)
        }
    }

    fun open(metadata: LocalPhotoMetadata, variant: LocalPhotoVariant): File = when (variant) {
        LocalPhotoVariant.ORIGINAL -> openRelative(metadata.originalPath)
        LocalPhotoVariant.DISPLAY -> openRelative(metadata.displayPath)
        LocalPhotoVariant.THUMBNAIL -> openRelative(metadata.thumbnailPath)
    }

    fun openRelative(relativePath: String): File {
        val candidate = File(appContext.filesDir, relativePath)
        val rootPath = mediaRoot.canonicalFile.toPath()
        val candidatePath = candidate.canonicalFile.toPath()
        require(candidatePath.startsWith(rootPath)) { "Photo path escapes private media storage" }
        return candidatePath.toFile()
    }

    /** Deletes the directory for one saved or still-draft photo. */
    fun deletePhoto(accountId: String, photoId: String): Boolean {
        val directory = photoDirectory(accountId, photoId)
        if (!directory.exists()) return true
        return directory.deleteRecursively()
    }

    /** Explicit draft alias so callers do not need to know the on-disk layout. */
    fun deleteDraftPhoto(accountId: String, draftPhotoId: String): Boolean =
        deletePhoto(accountId, draftPhotoId)

    private fun importPhoto(
        accountId: String,
        photoId: String,
        sourceName: String?,
        mimeTypeHint: String?,
        openSource: () -> InputStream,
    ): LocalPhotoMetadata {
        val directory = photoDirectory(accountId, photoId)
        require(!directory.exists()) { "Photo already exists: $photoId" }
        check(directory.mkdirs()) { "Could not create photo directory" }

        try {
            val hintedExtension = sourceName?.substringAfterLast('.', "")
            val extension = extensionFor(mimeTypeHint, hintedExtension)
            val original = File(directory, "original.$extension")
            val copied = copyOriginalAtomically(original, openSource)
            val image = readImageInfo(original)
            val effectiveMimeType = image.mimeType ?: mimeTypeHint ?: "image/$extension"
            require(effectiveMimeType.lowercase(Locale.ROOT).startsWith("image/")) {
                "Selected file is not an image"
            }

            val orientation = readExifOrientation(original)
            val rendered = renderDerivatives(
                original = original,
                directory = directory,
                sourceWidth = image.width,
                sourceHeight = image.height,
                orientation = orientation,
            )
            val now = System.currentTimeMillis()
            return LocalPhotoMetadata(
                accountId = safeSegment(accountId, "accountId"),
                photoId = safeSegment(photoId, "photoId"),
                originalPath = relativePath(original),
                displayPath = relativePath(rendered.displayFile),
                thumbnailPath = relativePath(rendered.thumbnailFile),
                mimeType = effectiveMimeType,
                byteSize = copied.byteSize,
                sha256 = copied.sha256,
                sourceWidth = image.width,
                sourceHeight = image.height,
                orientation = orientation,
                displayWidth = rendered.displayWidth,
                displayHeight = rendered.displayHeight,
                thumbnailWidth = rendered.thumbnailWidth,
                thumbnailHeight = rendered.thumbnailHeight,
                createdAtEpochMillis = now,
            )
        } catch (error: Throwable) {
            directory.deleteRecursively()
            throw error
        }
    }

    private fun copyOriginalAtomically(target: File, openSource: () -> InputStream): CopiedFile {
        val temporary = File(target.parentFile, ".${target.name}.${UUID.randomUUID()}.tmp")
        val digest = MessageDigest.getInstance("SHA-256")
        var total = 0L
        try {
            openSource().use { source ->
                BufferedInputStream(source).use { input ->
                    FileOutputStream(temporary).use { output ->
                        val buffer = ByteArray(COPY_BUFFER_BYTES)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            total += read
                            require(total <= MAX_ORIGINAL_BYTES) {
                                "Photo is larger than 12 MB"
                            }
                            digest.update(buffer, 0, read)
                            output.write(buffer, 0, read)
                        }
                        output.fd.sync()
                    }
                }
            }
            require(total > 0) { "Photo is empty" }
            moveAtomically(temporary, target)
            return CopiedFile(total, digest.digest().toHex())
        } finally {
            temporary.delete()
        }
    }

    private fun readImageInfo(original: File): ImageInfo {
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(original.absolutePath, options)
        require(options.outWidth > 0 && options.outHeight > 0) {
            "Photo format is unsupported or the image is damaged"
        }
        return ImageInfo(options.outWidth, options.outHeight, options.outMimeType)
    }

    private fun renderDerivatives(
        original: File,
        directory: File,
        sourceWidth: Int,
        sourceHeight: Int,
        orientation: Int,
    ): RenderedFiles {
        FULL_DECODE_PERMITS.acquire()
        try {
            val sampleSize = decodeSampleSize(sourceWidth, sourceHeight, DISPLAY_MAX_SIDE)
            val decoded = BitmapFactory.decodeFile(
                original.absolutePath,
                BitmapFactory.Options().apply {
                    inSampleSize = sampleSize
                    inPreferredConfig = Bitmap.Config.ARGB_8888
                },
            ) ?: error("Photo format is unsupported or the image is damaged")

            val oriented = applyOrientation(decoded, orientation)
            if (oriented !== decoded) decoded.recycle()
            try {
                val display = scaleDown(oriented, DISPLAY_MAX_SIDE)
                try {
                    val displayFile = File(directory, DISPLAY_FILE)
                    writeJpegAtomically(display, displayFile, DISPLAY_JPEG_QUALITY)

                    val thumbnail = scaleDown(display, THUMBNAIL_MAX_SIDE)
                    try {
                        val thumbnailFile = File(directory, THUMBNAIL_FILE)
                        writeJpegAtomically(thumbnail, thumbnailFile, THUMBNAIL_JPEG_QUALITY)
                        return RenderedFiles(
                            displayFile = displayFile,
                            thumbnailFile = thumbnailFile,
                            displayWidth = display.width,
                            displayHeight = display.height,
                            thumbnailWidth = thumbnail.width,
                            thumbnailHeight = thumbnail.height,
                        )
                    } finally {
                        if (thumbnail !== display) thumbnail.recycle()
                    }
                } finally {
                    if (display !== oriented) display.recycle()
                }
            } finally {
                oriented.recycle()
            }
        } finally {
            FULL_DECODE_PERMITS.release()
        }
    }

    private fun writeJpegAtomically(bitmap: Bitmap, target: File, quality: Int) {
        val temporary = File(target.parentFile, ".${target.name}.${UUID.randomUUID()}.tmp")
        try {
            FileOutputStream(temporary).use { output ->
                check(bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)) {
                    "Could not encode ${target.name}"
                }
                output.fd.sync()
            }
            moveAtomically(temporary, target)
        } finally {
            temporary.delete()
        }
    }

    private fun moveAtomically(source: File, target: File) {
        try {
            Files.move(
                source.toPath(),
                target.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
        } catch (_: AtomicMoveNotSupportedException) {
            Files.move(source.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }
    }

    private fun applyOrientation(source: Bitmap, orientation: Int): Bitmap {
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.postRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.postRotate(-90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(-90f)
        }
        if (matrix.isIdentity) return source
        return Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
    }

    private fun scaleDown(source: Bitmap, maxSide: Int): Bitmap {
        val currentMax = maxOf(source.width, source.height)
        if (currentMax <= maxSide) return source
        val scale = maxSide.toDouble() / currentMax.toDouble()
        val width = (source.width * scale).roundToInt().coerceAtLeast(1)
        val height = (source.height * scale).roundToInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(source, width, height, true)
    }

    private fun readExifOrientation(file: File): Int = runCatching {
        ExifInterface(file.absolutePath).getAttributeInt(
            ExifInterface.TAG_ORIENTATION,
            ExifInterface.ORIENTATION_NORMAL,
        )
    }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)

    private fun photoDirectory(accountId: String, photoId: String): File {
        val account = safeSegment(accountId, "accountId")
        val photo = safeSegment(photoId, "photoId")
        return File(File(mediaRoot, account), photo)
    }

    private fun safeSegment(value: String, field: String): String {
        require(value.isNotBlank() && SAFE_SEGMENT.matches(value)) { "Invalid $field" }
        require(value != "." && value != "..") { "Invalid $field" }
        return value
    }

    private fun relativePath(file: File): String =
        file.relativeTo(appContext.filesDir).invariantSeparatorsPath

    private fun extensionFor(mimeType: String?, hintedExtension: String?): String {
        val byMime = when (mimeType?.lowercase(Locale.ROOT)?.substringBefore(';')?.trim()) {
            "image/jpeg", "image/jpg" -> "jpg"
            "image/png" -> "png"
            "image/webp" -> "webp"
            "image/heic" -> "heic"
            "image/heif" -> "heif"
            "image/avif" -> "avif"
            else -> null
        }
        val cleanHint = hintedExtension
            ?.lowercase(Locale.ROOT)
            ?.takeIf { it in ALLOWED_ORIGINAL_EXTENSIONS }
        return byMime ?: cleanHint ?: "img"
    }

    private fun openUri(resolver: ContentResolver, uri: Uri): InputStream {
        if (uri.scheme == ContentResolver.SCHEME_FILE) {
            return FileInputStream(requireNotNull(uri.path) { "File URI has no path" })
        }
        return requireNotNull(resolver.openInputStream(uri)) { "Could not open selected photo" }
    }

    private fun ContentResolver.displayName(uri: Uri): String? = runCatching {
        query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (!cursor.moveToFirst()) return@use null
            cursor.getString(cursor.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME))
        }
    }.getOrNull()

    private fun decodeSampleSize(width: Int, height: Int, requestedMaxSide: Int): Int {
        var sample = 1
        val maxSide = maxOf(width, height)
        while (maxSide / (sample * 2) >= requestedMaxSide) sample *= 2
        return sample
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    private data class CopiedFile(val byteSize: Long, val sha256: String)
    private data class ImageInfo(val width: Int, val height: Int, val mimeType: String?)
    private data class RenderedFiles(
        val displayFile: File,
        val thumbnailFile: File,
        val displayWidth: Int,
        val displayHeight: Int,
        val thumbnailWidth: Int,
        val thumbnailHeight: Int,
    )

    companion object {
        const val MAX_ORIGINAL_BYTES = 12L * 1024L * 1024L
        const val DISPLAY_MAX_SIDE = 1_600
        const val THUMBNAIL_MAX_SIDE = 480

        private const val MEDIA_DIRECTORY = "media"
        private const val DISPLAY_FILE = "display.jpg"
        private const val THUMBNAIL_FILE = "thumb.jpg"
        private const val DISPLAY_JPEG_QUALITY = 92
        private const val THUMBNAIL_JPEG_QUALITY = 85
        private const val COPY_BUFFER_BYTES = 64 * 1024
        private val SAFE_SEGMENT = Regex("[A-Za-z0-9._-]{1,160}")
        private val ALLOWED_ORIGINAL_EXTENSIONS = setOf(
            "jpg", "jpeg", "png", "webp", "heic", "heif", "avif",
        )

        // One large decoded bitmap at a time keeps two simultaneous camera imports from exhausting
        // the app heap. Qwen/network work remains independent and can run concurrently.
        private val FULL_DECODE_PERMITS = Semaphore(1, true)
    }
}

enum class LocalPhotoVariant { ORIGINAL, DISPLAY, THUMBNAIL }

/** Plain Java-serializable metadata; paths are relative to Context.filesDir. */
data class LocalPhotoMetadata(
    val accountId: String,
    val photoId: String,
    val originalPath: String,
    val displayPath: String,
    val thumbnailPath: String,
    val mimeType: String,
    val byteSize: Long,
    val sha256: String,
    val sourceWidth: Int,
    val sourceHeight: Int,
    val orientation: Int,
    val displayWidth: Int,
    val displayHeight: Int,
    val thumbnailWidth: Int,
    val thumbnailHeight: Int,
    val createdAtEpochMillis: Long,
) : Serializable
