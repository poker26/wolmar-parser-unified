#!/usr/bin/env python3
import cloudscraper
import json
import time

def test_cloudscraper():
    print("🔍 Тестируем cloudscraper для обхода Cloudflare...")
    
    # Создаем сессию с cloudscraper
    scraper = cloudscraper.create_scraper(
        browser={
            'browser': 'chrome',
            'platform': 'windows',
            'mobile': False
        }
    )
    
    # Устанавливаем заголовки
    scraper.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    })
    
    try:
        print("🌐 Переходим на Meshok...")
        response = scraper.get('https://meshok.net/good/252', timeout=30)
        
        print(f"✅ Статус ответа: {response.status_code}")
        print(f"📄 Длина контента: {len(response.text)}")
        print(f"🔗 URL: {response.url}")
        
        # Проверяем заголовки
        print("\n📊 ЗАГОЛОВКИ ОТВЕТА:")
        for key, value in response.headers.items():
            print(f"{key}: {value}")
        
        # Анализируем контент
        content = response.text
        print(f"\n📊 АНАЛИЗ КОНТЕНТА:")
        print(f"Первые 200 символов: {content[:200]}")
        
        # Проверяем индикаторы
        indicators = {
            'Just a moment': 'Just a moment' in content,
            'Cloudflare': 'cloudflare' in content.lower(),
            'challenge': 'challenge' in content.lower(),
            'meshok': 'meshok' in content.lower(),
            'монеты': 'монеты' in content.lower(),
            'товар': 'товар' in content.lower(),
            'app': '<div id="app">' in content,
            'splashscreen': 'splashscreen' in content.lower()
        }
        
        print(f"\n🔍 ИНДИКАТОРЫ:")
        for key, value in indicators.items():
            print(f"{key}: {'✅' if value else '❌'}")
        
        # Проверяем, обошли ли Cloudflare
        if 'Just a moment' in content:
            print("\n❌ Cloudflare все еще блокирует")
        elif 'meshok' in content.lower() and len(content) > 10000:
            print("\n✅ Cloudflare обойден! Получен реальный контент")
        else:
            print("\n❓ Неопределенный результат")
            
        return response.text
        
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return None

if __name__ == "__main__":
    test_cloudscraper()
