package ru.begemot26.numismat.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class PersistentCookieJar(context: Context) : CookieJar {
    private val prefs = context.getSharedPreferences("encrypted_session", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    private val cookies = mutableListOf<Cookie>()

    init {
        restore()
    }

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, incoming: List<Cookie>) {
        val now = System.currentTimeMillis()
        incoming.forEach { next ->
            cookies.removeAll { it.name == next.name && it.domain == next.domain && it.path == next.path }
            if (next.expiresAt > now) cookies += next
        }
        cookies.removeAll { it.expiresAt <= now }
        persist()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        val changed = cookies.removeAll { it.expiresAt <= now }
        if (changed) persist()
        return cookies.filter { it.matches(url) }
    }

    @Synchronized
    fun value(name: String): String? = cookies.firstOrNull { it.name == name }?.value

    @Synchronized
    fun clear() {
        cookies.clear()
        prefs.edit().remove(STORAGE_KEY).apply()
    }

    private fun restore() {
        val encrypted = prefs.getString(STORAGE_KEY, null) ?: return
        runCatching {
            val payload = decrypt(encrypted)
            json.decodeFromString<List<StoredCookie>>(payload).mapNotNull { it.toCookie() }
        }.onSuccess { restored ->
            cookies += restored.filter { it.expiresAt > System.currentTimeMillis() }
        }.onFailure {
            prefs.edit().remove(STORAGE_KEY).apply()
        }
    }

    private fun persist() {
        runCatching {
            val payload = json.encodeToString(cookies.map(StoredCookie::fromCookie))
            prefs.edit().putString(STORAGE_KEY, encrypt(payload)).apply()
        }
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
        val combined = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, IV_SIZE)))
        return cipher.doFinal(bytes.copyOfRange(IV_SIZE, bytes.size)).toString(Charsets.UTF_8)
    }

    @Serializable
    private data class StoredCookie(
        val name: String,
        val value: String,
        val domain: String,
        val path: String,
        val expiresAt: Long,
        val secure: Boolean,
        val httpOnly: Boolean,
        val hostOnly: Boolean,
    ) {
        fun toCookie(): Cookie? = runCatching {
            Cookie.Builder()
                .name(name)
                .value(value)
                .apply { if (hostOnly) hostOnlyDomain(domain) else domain(domain) }
                .path(path)
                .expiresAt(expiresAt)
                .apply { if (secure) secure() }
                .apply { if (httpOnly) httpOnly() }
                .build()
        }.getOrNull()

        companion object {
            fun fromCookie(cookie: Cookie) = StoredCookie(
                cookie.name, cookie.value, cookie.domain, cookie.path, cookie.expiresAt,
                cookie.secure, cookie.httpOnly, cookie.hostOnly,
            )
        }
    }

    private companion object {
        const val STORAGE_KEY = "cookies"
        const val KEY_ALIAS = "numismat_session_key_v1"
        const val IV_SIZE = 12
    }
}
