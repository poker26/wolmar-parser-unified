#!/usr/bin/env python3
import cloudscraper
import json
import time
import random

def test_cloudscraper_advanced():
    print("🔍 Расширенный тест cloudscraper...")
    
    # Разные настройки браузера
    browser_configs = [
        {
            'browser': 'chrome',
            'platform': 'windows',
            'mobile': False
        },
        {
            'browser': 'firefox',
            'platform': 'windows',
            'mobile': False
        },
        {
            'browser': 'safari',
            'platform': 'macos',
            'mobile': False
        }
    ]
    
    for i, config in enumerate(browser_configs):
        print(f"\n🌐 Тест {i+1}/3: {config['browser']} на {config['platform']}")
        
        try:
            # Создаем сессию с разными настройками
            scraper = cloudscraper.create_scraper(browser=config)
            
            # Случайные заголовки
            user_agents = [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
            ]
            
            scraper.headers.update({
                'User-Agent': random.choice(user_agents),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Cache-Control': 'max-age=0'
            })
            
            # Добавляем задержку
            time.sleep(random.uniform(1, 3))
            
            print("🌐 Переходим на Meshok...")
            response = scraper.get('https://meshok.net/good/252', timeout=30)
            
            print(f"✅ Статус: {response.status_code}")
            print(f"📄 Длина: {len(response.text)}")
            
            content = response.text
            
            # Проверяем результат
            if 'Just a moment' in content:
                print("❌ Cloudflare блокирует")
            elif 'meshok' in content.lower() and len(content) > 10000:
                print("✅ Cloudflare обойден!")
                print(f"Первые 200 символов: {content[:200]}")
                return content
            else:
                print("❓ Неопределенный результат")
                
        except Exception as e:
            print(f"❌ Ошибка: {e}")
    
    return None

def test_different_urls():
    print("\n🔍 Тестируем разные URL...")
    
    urls = [
        'https://meshok.net/good/252',
        'https://meshok.net/',
        'https://meshok.net/listing?good=252&opt=2'
    ]
    
    scraper = cloudscraper.create_scraper()
    
    for url in urls:
        print(f"\n🌐 Тестируем: {url}")
        
        try:
            response = scraper.get(url, timeout=30)
            print(f"✅ Статус: {response.status_code}")
            print(f"📄 Длина: {len(response.text)}")
            
            content = response.text
            if 'Just a moment' in content:
                print("❌ Cloudflare блокирует")
            elif 'meshok' in content.lower():
                print("✅ Получен контент Meshok!")
                return content
                
        except Exception as e:
            print(f"❌ Ошибка: {e}")
    
    return None

if __name__ == "__main__":
    # Тест с разными настройками
    result1 = test_cloudscraper_advanced()
    
    if not result1:
        # Тест с разными URL
        result2 = test_different_urls()
        
        if result2:
            print("\n✅ Успех через разные URL!")
        else:
            print("\n❌ Все тесты не удались")
    else:
        print("\n✅ Успех через разные настройки!")
