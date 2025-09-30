#!/bin/bash

# Update script for Wolmar Parser
# Usage: ./update.sh

echo "🔄 Starting update of Wolmar Parser..."

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
    echo -e "${BLUE}[UPDATE]${NC} $1"
}

# Check if PM2 is running
if ! command -v pm2 &> /dev/null; then
    print_error "PM2 is not installed. Please install PM2 first."
    exit 1
fi

# Check if application is running
if ! pm2 list | grep -q "wolmar-parser"; then
    print_warning "Application is not running in PM2. Starting fresh deployment..."
    ./deploy.sh
    exit 0
fi

# Create backup before update
print_header "Creating backup before update..."
./backup.sh

if [ $? -ne 0 ]; then
    print_error "Backup failed. Aborting update."
    exit 1
fi

# Stop the application
print_header "Stopping application..."
pm2 stop wolmar-parser

if [ $? -ne 0 ]; then
    print_error "Failed to stop application"
    exit 1
fi

# Update dependencies
print_header "Updating dependencies..."
npm install --production

if [ $? -ne 0 ]; then
    print_error "Failed to update dependencies"
    print_warning "Restarting application with old dependencies..."
    pm2 start wolmar-parser
    exit 1
fi

# Start the application
print_header "Starting application..."
pm2 start wolmar-parser

if [ $? -eq 0 ]; then
    print_status "Application started successfully!"
    
    # Wait a moment for the application to start
    sleep 5
    
    # Check if application is running
    if pm2 list | grep -q "wolmar-parser.*online"; then
        print_status "Update completed successfully! 🎉"
        print_status "Application is running and healthy"
        
        # Show status
        pm2 status wolmar-parser
        
        # Show recent logs
        print_status "Recent logs:"
        pm2 logs wolmar-parser --lines 10
        
    else
        print_error "Application failed to start properly"
        print_warning "Check logs: pm2 logs wolmar-parser"
        exit 1
    fi
    
else
    print_error "Failed to start application"
    print_warning "Check logs: pm2 logs wolmar-parser"
    exit 1
fi

print_status "Update completed successfully! 🎉"



