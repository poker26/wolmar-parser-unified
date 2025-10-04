#!/usr/bin/env python3

import sys
import os
import time
import requests
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException
import json
from datetime import datetime

def fetch_with_selenium(category_id='252', finished=True):
    print('🐍 Using Python Selenium for Cloudflare bypass...')
    
    url = f"https://meshok.net/good/{category_id}{'?opt=2' if finished else ''}"
    print(f"📄 Fetching: {url}")
    
    # Настройка Chrome options
    chrome_options = Options()
    chrome_options.add_argument('--headless')
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    chrome_options.add_argument('--disable-gpu')
    chrome_options.add_argument('--disable-web-security')
    chrome_options.add_argument('--disable-features=VizDisplayCompositor')
    chrome_options.add_argument('--disable-blink-features=AutomationControlled')
    chrome_options.add_argument('--disable-extensions')
    chrome_options.add_argument('--disable-plugins')
    chrome_options.add_argument('--disable-background-timer-throttling')
    chrome_options.add_argument('--disable-backgrounding-occluded-windows')
    chrome_options.add_argument('--disable-renderer-backgrounding')
    chrome_options.add_argument('--disable-ipc-flooding-protection')
    chrome_options.add_argument('--disable-hang-monitor')
    chrome_options.add_argument('--disable-prompt-on-repost')
    chrome_options.add_argument('--disable-sync')
    chrome_options.add_argument('--disable-translate')
    chrome_options.add_argument('--disable-logging')
    chrome_options.add_argument('--disable-permissions-api')
    chrome_options.add_argument('--disable-presentation-api')
    chrome_options.add_argument('--disable-print-preview')
    chrome_options.add_argument('--disable-speech-api')
    chrome_options.add_argument('--disable-file-system')
    chrome_options.add_argument('--disable-notifications')
    chrome_options.add_argument('--disable-geolocation')
    chrome_options.add_argument('--disable-media-session-api')
    chrome_options.add_argument('--disable-background-networking')
    chrome_options.add_argument('--disable-default-apps')
    chrome_options.add_argument('--disable-sync-preferences')
    chrome_options.add_argument('--disable-component-extensions-with-background-pages')
    chrome_options.add_argument('--disable-client-side-phishing-detection')
    chrome_options.add_argument('--disable-component-update')
    chrome_options.add_argument('--disable-domain-reliability')
    chrome_options.add_argument('--disable-features=TranslateUI')
    chrome_options.add_argument('--disable-features=BlinkGenPropertyTrees')
    chrome_options.add_argument('--disable-features=VizDisplayCompositor')
    chrome_options.add_argument('--disable-features=WebRtcHideLocalIpsWithMdns')
    chrome_options.add_argument('--disable-features=WebRtcUseMinMaxVEADimensions')
    chrome_options.add_argument('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    
    # Скрытие автоматизации
    chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
    chrome_options.add_experimental_option('useAutomationExtension', False)
    
    driver = None
    try:
        print('🚀 Starting Chrome driver...')
        driver = webdriver.Chrome(options=chrome_options)
        
        # Скрытие webdriver свойств
        driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
        
        print('📄 Opening page...')
        driver.get(url)
        
        print('⏳ Waiting for Cloudflare challenge...')
        
        # Ждем до 2 минут для прохождения Cloudflare
        attempts = 0
        while attempts < 120:  # 2 минуты
            time.sleep(1)
            attempts += 1
            
            try:
                # Проверяем, прошли ли мы Cloudflare
                if 'Just a moment' not in driver.page_source and 'Один момент' not in driver.page_source:
                    print('✅ Cloudflare challenge passed!')
                    break
                
                if attempts % 20 == 0:
                    print(f'⏳ Attempt {attempts}/120 - Still waiting for Cloudflare...')
                    
            except Exception as e:
                # Игнорируем ошибки во время ожидания
                pass
        
        # Получаем содержимое страницы
        content = driver.page_source
        title = driver.title
        
        # Сохраняем результат
        timestamp = datetime.now().strftime('%Y-%m-%dT%H-%M-%S-%fZ')
        filename = f"python_selenium_good{category_id}_opt{'2' if finished else '1'}_{timestamp}.html"
        filepath = os.path.join('data', filename)
        
        os.makedirs('data', exist_ok=True)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        
        print(f'✅ Saved to: {filename}')
        print(f'📊 Size: {len(content) / 1024:.2f} KB')
        print(f'📋 Page title: {title}')
        
        # Поиск ссылок на лоты
        lot_links = driver.find_elements(By.CSS_SELECTOR, 'a[href*="/item/"]')
        print(f'🔗 Found {len(lot_links)} item links')
        
        if len(lot_links) > 0:
            print('🎉 Successfully obtained auction data with Python Selenium!')
            
            # Показываем первые несколько ссылок
            print('📋 First 5 item links:')
            for i, link in enumerate(lot_links[:5]):
                href = link.get_attribute('href')
                text = link.text.strip()[:50]
                print(f'   {i + 1}. {text}... -> {href}')
        else:
            print('⚠️  No auction links found')
        
        if 'Just a moment' in content or 'Один момент' in content:
            print('⚠️  Cloudflare challenge still active')
            print('💡 This site may have very strong protection')
        
    except WebDriverException as e:
        print(f'❌ WebDriver error: {e}')
    except Exception as e:
        print(f'❌ Error: {e}')
    finally:
        if driver:
            driver.quit()
            print('🏁 Browser closed')

if __name__ == '__main__':
    category_id = sys.argv[1] if len(sys.argv) > 1 else '252'
    finished = sys.argv[2] != 'false' if len(sys.argv) > 2 else True
    fetch_with_selenium(category_id, finished)
