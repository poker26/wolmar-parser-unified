#!/bin/bash

echo "🔧 Installing Xvfb and setting up virtual display..."

# Обновление системы
echo "📦 Updating system packages..."
apt update

# Установка Xvfb и зависимостей
echo "📦 Installing Xvfb and dependencies..."
apt install -y xvfb x11-utils x11-xserver-utils

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

# Создание systemd сервиса для Xvfb
echo "📝 Creating Xvfb systemd service..."
cat > /etc/systemd/system/xvfb.service << 'EOF'
[Unit]
Description=X Virtual Frame Buffer Service
After=network.target

[Service]
ExecStart=/usr/bin/Xvfb :99 -ac -screen 0 1366x768x24
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
EOF

# Включение и запуск сервиса
systemctl daemon-reload
systemctl enable xvfb
systemctl start xvfb

echo "✅ Xvfb setup complete!"
echo "💡 You can now use: export DISPLAY=:99"
echo "💡 Or use: chrome-headless --version"
