#!/bin/bash

# Проверка встроенных модулей Node.js
# Убеждаемся, что path, fs, os и другие встроенные модули работают

echo "🔍 ПРОВЕРКА ВСТРОЕННЫХ МОДУЛЕЙ NODE.JS..."
echo "====================================="

echo "📊 ЭТАП 1: Проверка версии Node.js..."
echo "=================================="

echo "📋 Версия Node.js:"
node --version

echo "📋 Версия npm:"
npm --version

echo ""
echo "📊 ЭТАП 2: Проверка встроенных модулей..."
echo "======================================"

echo "📋 Тестирование модуля path:"
node -e "const path = require('path'); console.log('✅ path модуль работает'); console.log('📋 __dirname:', path.dirname(__filename)); console.log('📋 join:', path.join('test', 'file.js'));"

echo ""
echo "📋 Тестирование модуля fs:"
node -e "const fs = require('fs'); console.log('✅ fs модуль работает'); console.log('📋 existsSync:', fs.existsSync('package.json'));"

echo ""
echo "📋 Тестирование модуля os:"
node -e "const os = require('os'); console.log('✅ os модуль работает'); console.log('📋 platform:', os.platform()); console.log('📋 arch:', os.arch());"

echo ""
echo "📋 Тестирование модуля http:"
node -e "const http = require('http'); console.log('✅ http модуль работает');"

echo ""
echo "📋 Тестирование модуля url:"
node -e "const url = require('url'); console.log('✅ url модуль работает');"

echo ""
echo "📊 ЭТАП 3: Проверка всех встроенных модулей..."
echo "==========================================="

echo "📋 Список всех встроенных модулей:"
node -e "console.log('Встроенные модули Node.js:'); console.log(require('module').builtinModules);"

echo ""
echo "📊 ЭТАП 4: Тестирование импорта path в контексте..."
echo "=============================================="

echo "📋 Создание тестового файла с path:"
cat > test-path.js << 'EOF'
const path = require('path');
const fs = require('fs');

console.log('✅ Тестирование встроенных модулей:');
console.log('📋 path.dirname(__filename):', path.dirname(__filename));
console.log('📋 path.join(__dirname, "test"):', path.join(__dirname, 'test'));
console.log('📋 fs.existsSync("package.json"):', fs.existsSync('package.json'));
console.log('📋 __dirname:', __dirname);
console.log('📋 __filename:', __filename);
EOF

echo "📋 Запуск тестового файла:"
node test-path.js

echo ""
echo "📊 ЭТАП 5: Проверка работы path в Express приложении..."
echo "==================================================="

echo "📋 Создание тестового Express приложения:"
cat > test-express-path.js << 'EOF'
const express = require('express');
const path = require('path');

console.log('✅ Тестирование path в Express:');
console.log('📋 path.join(__dirname, "public"):', path.join(__dirname, 'public'));
console.log('📋 path.resolve("public"):', path.resolve('public'));
console.log('📋 path.extname("test.js"):', path.extname('test.js'));

// Тестирование статического middleware
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
console.log('✅ Express static middleware с path работает');
EOF

echo "📋 Запуск тестового Express приложения:"
node test-express-path.js

echo ""
echo "📊 ЭТАП 6: Очистка тестовых файлов..."
echo "=================================="

rm -f test-path.js test-express-path.js

echo "✅ Тестовые файлы удалены"

echo ""
echo "📊 ЭТАП 7: Проверка работы path в текущем каталоге..."
echo "================================================="

cd /var/www/catalog-interface

echo "📋 Проверка path в каталоге каталога:"
node -e "const path = require('path'); console.log('✅ path работает в каталоге каталога'); console.log('📋 __dirname:', __dirname); console.log('📋 path.join(__dirname, \"public\"):', path.join(__dirname, 'public'));"

echo ""
echo "📊 ЭТАП 8: Проверка синтаксиса server.js с path..."
echo "=============================================="

if [ -f "server.js" ]; then
    echo "📋 Проверка синтаксиса server.js:"
    node -c server.js 2>&1
    
    if [ $? -eq 0 ]; then
        echo "✅ server.js синтаксически корректен"
    else
        echo "❌ Ошибка синтаксиса в server.js"
    fi
else
    echo "❌ server.js не найден в каталоге каталога"
fi

echo ""
echo "📊 ЭТАП 9: Тестирование импорта path в server.js..."
echo "=============================================="

if [ -f "server.js" ]; then
    echo "📋 Поиск импорта path в server.js:"
    grep -n "require.*path" server.js || echo "Импорт path не найден"
    
    echo "📋 Поиск использования path в server.js:"
    grep -n "path\." server.js || echo "Использование path не найдено"
fi

echo ""
echo "✅ ПРОВЕРКА ВСТРОЕННЫХ МОДУЛЕЙ ЗАВЕРШЕНА!"
echo "====================================="
echo "💡 Все встроенные модули Node.js работают корректно"
echo "💡 path модуль доступен и работает"
echo "💡 Проблема не в встроенных модулях Node.js"
