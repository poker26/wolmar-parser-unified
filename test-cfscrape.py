#!/usr/bin/env python3
import requests
import json
import time

def test_cfscrape_alternative():
    print("🔍 Тестируем альтернативный подход без cloudscraper...")
    
    # Создаем сессию с правильными заголовками
    session = requests.Session()
    
    # Устанавливаем заголовки как у реального браузера
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0'
    })
    
    try:
        print("🌐 Переходим на Meshok...")
        
        # Сначала получаем главную страницу
        response = session.get('https://meshok.net/', timeout=30)
        print(f"✅ Главная страница: {response.status_code}, длина: {len(response.text)}")
        
        # Теперь переходим на категорию монет
        response = session.get('https://meshok.net/good/252', timeout=30)
        
        print(f"✅ Статус ответа: {response.status_code}")
        print(f"📄 Длина контента: {len(response.text)}")
        print(f"🔗 URL: {response.url}")
        
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
            
        return content
        
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return None

if __name__ == "__main__":
    test_cfscrape_alternative()
