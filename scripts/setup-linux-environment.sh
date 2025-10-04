#!/bin/bash

echo "🔧 Setting up Linux environment based on Habr article..."

# Обновление системы
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# Установка XFCE (как в статье)
echo "📦 Installing XFCE desktop environment..."
apt install -y xfce4 xfce4-goodies

# Установка Chrome
echo "📦 Installing Google Chrome..."
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
apt update
apt install -y google-chrome-stable

# Установка Xvfb
echo "📦 Installing Xvfb..."
apt install -y xvfb x11-utils x11-xserver-utils

# Установка дополнительных пакетов для Chrome
echo "📦 Installing Chrome dependencies..."
apt install -y libnss3-dev libatk-bridge2.0-dev libdrm2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libxss1 libasound2

# Создание директории для расширения
echo "📁 Creating extension directory..."
mkdir -p /usr/local/browser-proxy-extension/chrome
cp -r chrome-extension/* /usr/local/browser-proxy-extension/chrome/

# Создание скрипта для запуска Chrome с расширением
echo "📝 Creating Chrome launcher script..."
cat > /usr/local/bin/chrome-with-extension << 'EOF'
#!/bin/bash
export DISPLAY=:10
Xvfb :10 -ac -screen 0 1366x768x24 &
sleep 2
google-chrome-stable --load-extension=/usr/local/browser-proxy-extension/chrome/ --remote-debugging-port=9222 "$@"
EOF

chmod +x /usr/local/bin/chrome-with-extension

# Создание systemd сервиса для Xvfb
echo "📝 Creating Xvfb systemd service..."
cat > /etc/systemd/system/xvfb.service << 'EOF'
[Unit]
Description=X Virtual Frame Buffer Service
After=network.target

[Service]
ExecStart=/usr/bin/Xvfb :10 -ac -screen 0 1366x768x24
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
EOF

# Создание systemd сервиса для Chrome
echo "📝 Creating Chrome systemd service..."
cat > /etc/systemd/system/chrome-parser.service << 'EOF'
[Unit]
Description=Chrome Parser Service
After=network.target xvfb.service
Requires=xvfb.service

[Service]
ExecStart=/usr/local/bin/chrome-with-extension
Restart=on-failure
User=root
Environment=DISPLAY=:10

[Install]
WantedBy=multi-user.target
EOF

# Включение и запуск сервисов
systemctl daemon-reload
systemctl enable xvfb
systemctl enable chrome-parser
systemctl start xvfb
systemctl start chrome-parser

echo "✅ Linux environment setup complete!"
echo "💡 Services started: xvfb, chrome-parser"
echo "💡 Chrome available at: http://localhost:9222"
echo "💡 Extension loaded automatically"
