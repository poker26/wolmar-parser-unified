#!/bin/bash

echo "========================================"
echo "  Wolmar Auction Parser - Web Interface"
echo "========================================"
echo

echo "Проверка зависимостей..."
if [ ! -d "node_modules" ]; then
    echo "Установка зависимостей..."
    npm install
    if [ $? -ne 0 ]; then
        echo "Ошибка установки зависимостей!"
        exit 1
    fi
fi

echo
echo "Проверка конфигурации..."
if [ ! -f "config.js" ]; then
    echo "Файл config.js не найден!"
    echo "Скопируйте config.example.js в config.js и настройте подключение к БД"
    exit 1
fi

echo
echo "Запуск веб-сервера..."
echo "Веб-интерфейс будет доступен по адресу: http://localhost:3000"
echo
echo "Для остановки нажмите Ctrl+C"
echo

npm start
