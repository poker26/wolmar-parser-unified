#!/bin/bash

echo "🚀 Starting Browser Proxy Server based on Habr article..."

# Переход в директорию сервера
cd server

# Проверка наличия .NET
if ! command -v dotnet &> /dev/null; then
    echo "📦 Installing .NET 6..."
    wget https://packages.microsoft.com/config/ubuntu/20.04/packages-microsoft-prod.deb -O packages-microsoft-prod.deb
    dpkg -i packages-microsoft-prod.deb
    apt update
    apt install -y dotnet-sdk-6.0
fi

# Восстановление зависимостей
echo "📦 Restoring NuGet packages..."
dotnet restore

# Сборка проекта
echo "🔨 Building project..."
dotnet build

# Создание systemd сервиса для BrowserProxy
echo "📝 Creating BrowserProxy systemd service..."
cat > /etc/systemd/system/browser-proxy.service << 'EOF'
[Unit]
Description=Browser Proxy Web Service
After=network.target chrome-parser.service
Requires=chrome-parser.service

[Service]
ExecStart=/usr/bin/dotnet /usr/local/browser-proxy/BrowserProxy.dll --urls "http://0.0.0.0:80"
WorkingDirectory=/usr/local/browser-proxy/
User=root
Restart=on-failure
SyslogIdentifier=browser-proxy
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# Создание директории для сервера
mkdir -p /usr/local/browser-proxy

# Копирование файлов сервера
cp -r * /usr/local/browser-proxy/

# Включение и запуск сервиса
systemctl daemon-reload
systemctl enable browser-proxy
systemctl start browser-proxy

echo "✅ Browser Proxy Server started!"
echo "💡 Server available at: http://localhost:80"
echo "💡 Health check: http://localhost:80/health"
echo "💡 Parse endpoint: http://localhost:80/parse?category=252&finished=true"
