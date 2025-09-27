@echo off
echo ========================================
echo   Обновление текущих ставок аукциона
echo ========================================
echo.

if "%1"=="" (
    echo Использование: update-bids.bat [внутренний_номер]
    echo Пример: update-bids.bat 2133
    echo.
    echo Запуск с автоматическим определением аукциона...
    node update-current-auction.js
) else (
    echo Обновление ставок для внутреннего номера %1...
    node update-current-auction.js %1
)

echo.
echo Обновление завершено!
pause
