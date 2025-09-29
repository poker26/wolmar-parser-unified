#!/bin/bash

echo "🔧 Полное разделение проектов..."

# Создаем отдельную ветку для каталога
echo "📁 Создание отдельной ветки для каталога..."
git checkout -b catalog-monet
git push origin catalog-monet

# Переключаемся обратно на main
echo "🔄 Переключение на основную ветку..."
git checkout main

# Удаляем файлы каталога из основной ветки
echo "🗑️ Удаление файлов каталога из основной ветки..."
git rm catalog-parser.js catalog-server.js catalog-monitor.js catalog-public/ -r
git rm setup-catalog-server.sh server-commands.md
git rm fix-server-git-conflict.sh force-update-catalog.sh
git rm deploy-catalog-to-server.sh deploy-catalog-to-server.ps1
git rm package-catalog-for-server.sh package-catalog-for-server.ps1
git rm create-manual-deployment.sh create-manual-deployment.ps1
git rm CATALOG-DEPLOYMENT-GUIDE.md

# Коммитим изменения
echo "📝 Коммит очистки основной ветки..."
git commit -m "Удалены файлы каталога из основной ветки - каталог перенесен в отдельную ветку catalog-monet"

# Пушим изменения
echo "📤 Отправка изменений..."
git push origin main

echo "✅ Проекты разделены!"
echo ""
echo "📋 Структура проектов:"
echo "   main - основной сайт аукционов (порт 3001)"
echo "   catalog-monet - каталог монет (порт 3000)"
echo ""
echo "🚀 Для восстановления основного сайта на сервере:"
echo "   git checkout main"
echo "   git pull origin main"
echo "   pm2 start server.js --name wolmar-parser"
echo "   pm2 start admin-server.js --name admin-server"
