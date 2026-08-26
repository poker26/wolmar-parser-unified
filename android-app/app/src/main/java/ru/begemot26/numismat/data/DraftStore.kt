package ru.begemot26.numismat.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@Serializable
data class CollectionDraft(
    val typeId: Long? = null,
    val catalogTitle: String? = null,
    val label: String = "",
    val grade: String = "",
    val priceRub: String = "",
    val purchaseDate: String = "",
    val purchaseSource: String = "",
    val notes: String = "",
    val catalogQuery: String = "",
)

class DraftStore(context: Context) {
    private val prefs = context.getSharedPreferences("encrypted_collection_draft", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    fun load(): CollectionDraft? {
        val payload = prefs.getString(STORAGE_KEY, null) ?: return null
        return runCatching { json.decodeFromString<CollectionDraft>(decrypt(payload)) }
            .onFailure { clear() }
            .getOrNull()
    }

    fun save(draft: CollectionDraft) {
        runCatching {
            prefs.edit().putString(STORAGE_KEY, encrypt(json.encodeToString(draft))).apply()
        }
    }

    fun clear() {
        prefs.edit().remove(STORAGE_KEY).apply()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        return Base64.encodeToString(
            cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)),
            Base64.NO_WRAP,
        )
    }

    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        require(bytes.size > IV_SIZE)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, IV_SIZE)))
        return cipher.doFinal(bytes.copyOfRange(IV_SIZE, bytes.size)).toString(Charsets.UTF_8)
    }

    private companion object {
        const val STORAGE_KEY = "draft"
        const val KEY_ALIAS = "numismat_collection_draft_key_v1"
        const val IV_SIZE = 12
    }
}
