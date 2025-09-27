#!/bin/bash

# Deploy script for Wolmar Parser
# Usage: ./deploy.sh

echo "🚀 Starting deployment of Wolmar Parser..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm first."
    exit 1
fi

print_status "Node.js version: $(node --version)"
print_status "npm version: $(npm --version)"

# Create logs directory if it doesn't exist
if [ ! -d "logs" ]; then
    print_status "Creating logs directory..."
    mkdir -p logs
fi

# Install dependencies
print_status "Installing dependencies..."
npm install --production

if [ $? -ne 0 ]; then
    print_error "Failed to install dependencies"
    exit 1
fi

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    print_warning "PM2 is not installed. Installing PM2 globally..."
    npm install -g pm2
fi

# Stop existing PM2 process if running
print_status "Stopping existing PM2 processes..."
pm2 stop wolmar-parser 2>/dev/null || true
pm2 delete wolmar-parser 2>/dev/null || true

# Start the application with PM2
print_status "Starting application with PM2..."
pm2 start ecosystem.config.js --env production

if [ $? -eq 0 ]; then
    print_status "Application started successfully!"
    print_status "PM2 Status:"
    pm2 status
    print_status "Application logs:"
    pm2 logs wolmar-parser --lines 10
else
    print_error "Failed to start application"
    exit 1
fi

# Save PM2 configuration
print_status "Saving PM2 configuration..."
pm2 save

# Setup PM2 startup script (optional)
print_warning "To setup PM2 startup script, run: pm2 startup"
print_warning "Then run: pm2 save"

print_status "Deployment completed successfully! 🎉"
print_status "Your application should be running on port 3000"
print_status "Check logs with: pm2 logs wolmar-parser"
print_status "Check status with: pm2 status"



