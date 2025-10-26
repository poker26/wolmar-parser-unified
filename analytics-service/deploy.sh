#!/bin/bash

# Wolmar Analytics Service Deployment Script

echo "🚀 Deploying Wolmar Analytics Service..."

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 is not installed. Please install PM2 first:"
    echo "npm install -g pm2"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create logs directory
mkdir -p logs

# Stop existing service if running
echo "🛑 Stopping existing service..."
pm2 stop analytics 2>/dev/null || true

# Start the service
echo "🚀 Starting analytics service..."
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

echo "✅ Analytics service deployed successfully!"
echo "📊 Service available at: http://localhost:3002/analytics"
echo "📋 PM2 status: pm2 status"
echo "📝 PM2 logs: pm2 logs analytics"
