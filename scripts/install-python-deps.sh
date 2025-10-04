#!/bin/bash

echo "🐍 Installing Python dependencies for web scraping..."

# Update package list
apt-get update

# Install Python and pip
apt-get install -y python3 python3-pip

# Install Python web scraping libraries
echo "📦 Installing Python web scraping libraries..."
pip3 install --upgrade pip
pip3 install \
    selenium \
    undetected-chromedriver \
    requests \
    beautifulsoup4 \
    lxml \
    fake-useragent \
    cloudscraper \
    httpx \
    aiohttp \
    playwright

# Install Playwright browsers
echo "📦 Installing Playwright browsers..."
python3 -m playwright install chromium
python3 -m playwright install-deps

echo "✅ Python dependencies installed successfully!"
echo "📋 Available Python tools:"
echo "   - selenium (web automation)"
echo "   - undetected-chromedriver (Cloudflare bypass)"
echo "   - requests (HTTP client)"
echo "   - beautifulsoup4 (HTML parsing)"
echo "   - playwright (modern browser automation)"
echo "   - cloudscraper (Cloudflare bypass)"
