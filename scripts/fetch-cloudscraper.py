#!/usr/bin/env python3

import sys
import os
import time
import json
from datetime import datetime
import cloudscraper
import requests
from bs4 import BeautifulSoup

def fetch_with_cloudscraper(category_id='252', finished=True):
    print('☁️  Using cloudscraper for Cloudflare bypass...')
    
    url = f"https://meshok.net/good/{category_id}{'?opt=2' if finished else ''}"
    print(f"📄 Fetching: {url}")
    
    try:
        # Создаем cloudscraper сессию
        scraper = cloudscraper.create_scraper(
            browser={
                'browser': 'chrome',
                'platform': 'windows',
                'mobile': False
            }
        )
        
        # Устанавливаем заголовки
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'DNT': '1'
        }
        
        print('⏳ Making request with cloudscraper...')
        response = scraper.get(url, headers=headers, timeout=30)
        
        print(f'📊 Status code: {response.status_code}')
        print(f'📊 Response size: {len(response.text) / 1024:.2f} KB')
        
        # Проверяем на Cloudflare
        if 'Just a moment' in response.text or 'Один момент' in response.text:
            print('⚠️  Cloudflare challenge detected')
        else:
            print('✅ No Cloudflare challenge detected')
        
        # Сохраняем результат
        timestamp = datetime.now().strftime('%Y-%m-%dT%H-%M-%S-%fZ')
        filename = f"cloudscraper_good{category_id}_opt{'2' if finished else '1'}_{timestamp}.html"
        filepath = os.path.join('data', filename)
        
        os.makedirs('data', exist_ok=True)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(response.text)
        
        print(f'✅ Saved to: {filename}')
        
        # Анализируем содержимое
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Поиск заголовка
        title = soup.find('title')
        if title:
            print(f'📋 Page title: {title.text}')
        
        # Поиск ссылок на лоты
        item_links = soup.find_all('a', href=lambda x: x and '/item/' in x)
        print(f'🔗 Item links found: {len(item_links)}')
        
        if len(item_links) > 0:
            print('🎉 Successfully obtained auction data with cloudscraper!')
            
            # Показываем первые несколько ссылок
            print('📋 First 5 item links:')
            for i, link in enumerate(item_links[:5]):
                href = link.get('href')
                text = link.get_text().strip()[:50]
                print(f'   {i + 1}. {text}... -> {href}')
        else:
            print('⚠️  No auction links found')
        
        # Поиск цен
        price_matches = []
        for text in soup.stripped_strings:
            if '₽' in text or 'руб' in text:
                price_matches.append(text)
        
        if price_matches:
            print(f'💰 Prices found: {len(price_matches)}')
            print('📋 Sample prices:')
            for i, price in enumerate(price_matches[:3]):
                print(f'   {i + 1}. {price}')
        
        # Поиск таблиц
        tables = soup.find_all('table')
        print(f'📊 Tables found: {len(tables)}')
        
        # Поиск форм
        forms = soup.find_all('form')
        print(f'📝 Forms found: {len(forms)}')
        
        # Поиск JSON данных в script тегах
        scripts = soup.find_all('script')
        json_found = False
        for script in scripts:
            if script.string and ('{' in script.string and '}' in script.string):
                json_found = True
                break
        
        if json_found:
            print('📜 JSON data found in scripts')
        else:
            print('📜 No JSON data found in scripts')
        
    except Exception as e:
        print(f'❌ Error: {e}')

if __name__ == '__main__':
    category_id = sys.argv[1] if len(sys.argv) > 1 else '252'
    finished = sys.argv[2] != 'false' if len(sys.argv) > 2 else True
    fetch_with_cloudscraper(category_id, finished)
