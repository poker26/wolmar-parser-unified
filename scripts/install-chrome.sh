#!/bin/bash

echo "🔧 Installing Chrome and setting up environment..."

# Обновление системы
echo "📦 Updating system packages..."
apt update

# Установка необходимых пакетов
echo "📦 Installing required packages..."
apt install -y wget gnupg software-properties-common

# Добавление репозитория Google Chrome
echo "🔑 Adding Google Chrome repository..."
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list

# Обновление списка пакетов
apt update

# Установка Chrome
echo "📦 Installing Google Chrome..."
apt install -y google-chrome-stable

# Проверка установки
if command -v google-chrome-stable &> /dev/null; then
    echo "✅ Chrome installed successfully"
    google-chrome-stable --version
else
    echo "❌ Chrome installation failed"
    exit 1
fi

# Установка Xvfb для виртуального дисплея
echo "📦 Installing Xvfb..."
apt install -y xvfb

# Установка дополнительных пакетов для Chrome
echo "📦 Installing Chrome dependencies..."
apt install -y libnss3-dev libatk-bridge2.0-dev libdrm2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libxss1 libasound2

# Создание скрипта для запуска Chrome с виртуальным дисплеем
echo "📝 Creating Chrome launcher script..."
cat > /usr/local/bin/chrome-headless << 'EOF'
#!/bin/bash
export DISPLAY=:99
Xvfb :99 -ac -screen 0 1366x768x24 &
sleep 2
google-chrome-stable "$@"
EOF

chmod +x /usr/local/bin/chrome-headless

echo "✅ Chrome environment setup complete!"
echo "💡 You can now use: chrome-headless --version"
