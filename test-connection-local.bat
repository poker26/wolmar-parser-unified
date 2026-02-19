@echo off
chcp 65001 >nul
echo Проверка подключения к Supabase (sup.begemot26.ru)...
echo Требуется .env с DB_HOST, DB_USER, DB_PASSWORD, DB_PORT
echo.
node test-db-connection.js
echo.
pause
