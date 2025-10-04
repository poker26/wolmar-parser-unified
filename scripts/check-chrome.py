#!/usr/bin/env python3

import sys
import os
import subprocess
import shutil

def check_chrome():
    print('🔍 Checking Chrome installation...')
    
    # Проверяем, где находится Chrome
    chrome_paths = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
        '/usr/bin/chrome',
        '/opt/google/chrome/chrome'
    ]
    
    chrome_found = False
    chrome_path = None
    
    for path in chrome_paths:
        if os.path.exists(path):
            print(f'✅ Found Chrome at: {path}')
            chrome_found = True
            chrome_path = path
            break
    
    if not chrome_found:
        print('❌ Chrome not found in standard locations')
        
        # Пробуем найти через which
        try:
            result = subprocess.run(['which', 'google-chrome'], capture_output=True, text=True)
            if result.returncode == 0:
                chrome_path = result.stdout.strip()
                print(f'✅ Found Chrome via which: {chrome_path}')
                chrome_found = True
        except:
            pass
        
        try:
            result = subprocess.run(['which', 'chromium-browser'], capture_output=True, text=True)
            if result.returncode == 0:
                chrome_path = result.stdout.strip()
                print(f'✅ Found Chromium via which: {chrome_path}')
                chrome_found = True
        except:
            pass
    
    if not chrome_found:
        print('❌ Chrome not found anywhere')
        return False
    
    # Проверяем версию Chrome
    try:
        result = subprocess.run([chrome_path, '--version'], capture_output=True, text=True)
        if result.returncode == 0:
            print(f'📊 Chrome version: {result.stdout.strip()}')
        else:
            print(f'⚠️  Could not get Chrome version: {result.stderr}')
    except Exception as e:
        print(f'⚠️  Error getting Chrome version: {e}')
    
    # Проверяем, можем ли запустить Chrome в headless режиме
    try:
        print('🧪 Testing Chrome headless mode...')
        result = subprocess.run([
            chrome_path,
            '--headless',
            '--no-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--dump-dom',
            'https://example.com'
        ], capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0:
            print('✅ Chrome headless mode works')
            print(f'📊 Output size: {len(result.stdout)} characters')
        else:
            print(f'❌ Chrome headless mode failed: {result.stderr}')
    except subprocess.TimeoutExpired:
        print('⚠️  Chrome headless test timed out')
    except Exception as e:
        print(f'❌ Error testing Chrome: {e}')
    
    # Проверяем ChromeDriver
    print('\n🔍 Checking ChromeDriver...')
    try:
        result = subprocess.run(['chromedriver', '--version'], capture_output=True, text=True)
        if result.returncode == 0:
            print(f'✅ ChromeDriver found: {result.stdout.strip()}')
        else:
            print('❌ ChromeDriver not found')
    except:
        print('❌ ChromeDriver not found')
    
    # Проверяем, какие браузеры доступны
    print('\n🔍 Available browsers:')
    browsers = ['google-chrome', 'chromium-browser', 'chromium', 'firefox', 'safari']
    for browser in browsers:
        if shutil.which(browser):
            print(f'✅ {browser}: {shutil.which(browser)}')
        else:
            print(f'❌ {browser}: not found')
    
    return chrome_found

if __name__ == '__main__':
    check_chrome()
