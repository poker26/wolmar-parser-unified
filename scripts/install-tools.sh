#!/bin/bash

echo "🔧 Installing additional tools for web scraping..."

# Update package list
apt-get update

# Install lynx (text browser)
echo "📦 Installing lynx..."
apt-get install -y lynx

# Install wget (if not already installed)
echo "📦 Installing wget..."
apt-get install -y wget

# Install curl (if not already installed)
echo "📦 Installing curl..."
apt-get install -y curl

# Install additional tools
echo "📦 Installing additional tools..."
apt-get install -y \
    xvfb \
    chromium-browser \
    chromium \
    google-chrome-stable \
    firefox \
    phantomjs \
    casperjs \
    selenium-standalone

# Install Python tools for web scraping
echo "📦 Installing Python scraping tools..."
apt-get install -y \
    python3 \
    python3-pip \
    python3-requests \
    python3-bs4 \
    python3-selenium \
    python3-lxml

# Install Node.js tools
echo "📦 Installing Node.js scraping tools..."
npm install -g \
    puppeteer-extra \
    puppeteer-extra-plugin-stealth \
    puppeteer-extra-plugin-anonymize-ua \
    puppeteer-extra-plugin-block-resources \
    undetected-chromedriver

echo "✅ All tools installed successfully!"
echo "📋 Available tools:"
echo "   - lynx (text browser)"
echo "   - wget (web downloader)"
echo "   - curl (web client)"
echo "   - xvfb (virtual display)"
echo "   - chromium-browser"
echo "   - Python scraping tools"
echo "   - Node.js scraping tools"
