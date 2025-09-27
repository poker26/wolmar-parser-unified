#!/bin/bash

# Server setup script for Wolmar Parser
# Run this script on your hosting server to prepare the environment

echo "🔧 Setting up server for Wolmar Parser..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}[SETUP]${NC} $1"
}

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    print_warning "Running as root. This is not recommended for production."
fi

# Update system packages
print_header "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js (if not installed)
if ! command -v node &> /dev/null; then
    print_header "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    print_status "Node.js is already installed: $(node --version)"
fi

# Install npm (if not installed)
if ! command -v npm &> /dev/null; then
    print_header "Installing npm..."
    sudo apt-get install -y npm
else
    print_status "npm is already installed: $(npm --version)"
fi

# Install PM2 globally
print_header "Installing PM2..."
sudo npm install -g pm2

# Install additional useful packages
print_header "Installing additional packages..."
sudo apt-get install -y curl wget git htop unzip

# Create application directory
print_header "Creating application directory..."
sudo mkdir -p /var/www/wolmar-parser
sudo chown -R $USER:$USER /var/www/wolmar-parser

# Create logs directory
print_header "Creating logs directory..."
mkdir -p /var/www/wolmar-parser/logs

# Install Nginx (optional)
read -p "Do you want to install Nginx for reverse proxy? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_header "Installing Nginx..."
    sudo apt-get install -y nginx
    
    # Create Nginx configuration
    print_header "Creating Nginx configuration..."
    sudo tee /etc/nginx/sites-available/wolmar-parser > /dev/null <<EOF
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

    # Enable the site
    sudo ln -sf /etc/nginx/sites-available/wolmar-parser /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default
    
    # Test and restart Nginx
    sudo nginx -t
    if [ $? -eq 0 ]; then
        sudo systemctl restart nginx
        sudo systemctl enable nginx
        print_status "Nginx installed and configured successfully!"
    else
        print_error "Nginx configuration test failed!"
    fi
fi

# Install Certbot for SSL (optional)
read -p "Do you want to install Certbot for SSL certificates? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_header "Installing Certbot..."
    sudo apt-get install -y certbot python3-certbot-nginx
    print_status "Certbot installed! Run 'sudo certbot --nginx -d your-domain.com' to get SSL certificate."
fi

# Setup firewall (optional)
read -p "Do you want to configure UFW firewall? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_header "Configuring UFW firewall..."
    sudo ufw allow ssh
    sudo ufw allow 80
    sudo ufw allow 443
    sudo ufw --force enable
    print_status "UFW firewall configured!"
fi

# Create systemd service for PM2 (optional)
read -p "Do you want to create systemd service for PM2? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_header "Creating systemd service for PM2..."
    sudo pm2 startup systemd -u $USER --hp /home/$USER
    print_status "PM2 systemd service created!"
fi

# Setup log rotation
print_header "Setting up log rotation..."
sudo tee /etc/logrotate.d/wolmar-parser > /dev/null <<EOF
/var/www/wolmar-parser/logs/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 $USER $USER
    postrotate
        pm2 reloadLogs
    endscript
}
EOF

print_status "Log rotation configured!"

# Final instructions
print_header "Setup completed! 🎉"
echo
print_status "Next steps:"
echo "1. Upload your application files to /var/www/wolmar-parser/"
echo "2. Create .env file with your configuration"
echo "3. Run: cd /var/www/wolmar-parser && npm install --production"
echo "4. Run: ./deploy.sh"
echo
print_status "Useful commands:"
echo "- Check PM2 status: pm2 status"
echo "- View logs: pm2 logs wolmar-parser"
echo "- Restart app: pm2 restart wolmar-parser"
echo "- Monitor: pm2 monit"
echo
print_warning "Don't forget to:"
echo "- Configure your domain in Nginx"
echo "- Get SSL certificate with Certbot"
echo "- Set up regular backups"
echo "- Monitor your application"



