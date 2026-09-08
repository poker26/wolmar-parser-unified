package ru.begemot26.numismat.data

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Keeps the locally known users separately from the account currently shown in the app.
 * Logging out clears only the current-account pointer, so that account's local collection
 * remains available when the same user signs in again.
 */
class LocalSessionStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )
    private val json = Json { ignoreUnknownKeys = true }

    @Synchronized
    fun load(): User? {
        val sessions = read() ?: return null
        val accountId = sessions.currentAccountId ?: return null
        return sessions.users[accountId]
    }

    @Synchronized
    fun save(user: User) {
        require(user.id.isNotBlank()) { "User id must not be blank" }

        val sessions = read() ?: StoredSessions()
        write(
            sessions.copy(
                currentAccountId = user.id,
                users = sessions.users + (user.id to user),
            ),
        )
    }

    @Synchronized
    fun clearCurrent() {
        val sessions = read() ?: return
        if (sessions.currentAccountId == null) return
        write(sessions.copy(currentAccountId = null))
    }

    private fun read(): StoredSessions? {
        val payload = prefs.getString(STORAGE_KEY, null) ?: return null
        return runCatching { json.decodeFromString<StoredSessions>(payload) }
            .onFailure { prefs.edit().remove(STORAGE_KEY).commit() }
            .getOrNull()
    }

    private fun write(sessions: StoredSessions) {
        check(
            prefs.edit()
                .putString(STORAGE_KEY, json.encodeToString(sessions))
                .commit(),
        ) { "Unable to persist local session" }
    }

    @Serializable
    private data class StoredSessions(
        val currentAccountId: String? = null,
        val users: Map<String, User> = emptyMap(),
    )

    private companion object {
        const val PREFERENCES_NAME = "local_sessions"
        const val STORAGE_KEY = "sessions_v1"
    }
}
