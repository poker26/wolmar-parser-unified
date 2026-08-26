# Нумизмат Android MVP

Первый sideload-клиент коллекции: вход, список, поиск по каталогу, добавление и редактирование монеты.

## Сборка

```powershell
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat :app:assembleDebug
```

Адрес backend задаётся при сборке:

```powershell
.\gradlew.bat :app:assembleDebug -PNUMISMAT_API_BASE_URL=https://api.example.ru/
```

По умолчанию используется `https://coins.begemot26.ru/`. Сейчас этот домен закрыт mTLS, поэтому для мобильного клиента нужен отдельный HTTPS-контур без клиентского сертификата, но с обычной авторизацией приложения.

Сессионные cookie сохраняются в `SharedPreferences` только в зашифрованном виде; ключ AES хранится в Android Keystore. Незашифрованный HTTP запрещён.
