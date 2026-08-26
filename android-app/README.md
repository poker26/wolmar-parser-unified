# Нумизмат Android MVP

Sideload-клиент коллекции: вход, каталог, экземпляры, приватные фотографии и
объяснимая оценка по точным завершённым проходам. Версия `0.6.0` реализует путь
камера → распознавание → выбор совпадения в каталоге → добавление экземпляра с
приватной фотографией в коллекцию.

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

По умолчанию используется production API `https://coins.begemot26.ru/`. Другой
адрес принимается только как HTTPS origin без логина, query-параметров и fragment.

## Release APK

Один раз создайте локальную signing identity (существующая не перезаписывается):

```powershell
.\scripts\create-release-keystore.ps1
```

Затем соберите подписанный APK:

```powershell
.\gradlew.bat :app:assembleRelease
```

Приватные файлы находятся в `signing/`, исключены из Git и должны храниться в
защищённой резервной копии. Потеря ключа исключает обновление уже установленного
приложения поверх существующей версии.

Сессионные cookie сохраняются в `SharedPreferences` только в зашифрованном виде; ключ AES хранится в Android Keystore. Незашифрованный HTTP запрещён.
Private collection export is saved to Android Downloads. Account deletion is
password-confirmed and delayed.
