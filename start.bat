@echo off
echo ========================================
echo   Wolmar Auction Parser - Web Interface
echo ========================================
echo.

echo Проверка зависимостей...
if not exist "node_modules" (
    echo Установка зависимостей...
    npm install
    if errorlevel 1 (
        echo Ошибка установки зависимостей!
        pause
        exit /b 1
    )
)

echo.
echo Проверка конфигурации...
if not exist "config.js" (
    echo Файл config.js не найден!
    echo Скопируйте config.example.js в config.js и настройте подключение к БД
    pause
    exit /b 1
)

echo.
echo Запуск веб-сервера...
echo Веб-интерфейс будет доступен по адресу: http://localhost:3000
echo.
echo Для остановки нажмите Ctrl+C
echo.

npm start

pause
