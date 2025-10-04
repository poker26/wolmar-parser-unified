#!/usr/bin/env python3

import sys
import os
import time
import json
import random
from datetime import datetime
import urllib.request
import urllib.parse
from urllib.error import URLError, HTTPError
import http.cookiejar

def get_random_user_agent():
    """Получение случайного User-Agent"""
    user_agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
    ]
    return random.choice(user_agents)

def get_random_ip():
    """Получение случайного IP"""
    ips = [
        '192.168.1.100',
        '192.168.1.101', 
        '192.168.1.102',
        '10.0.0.100',
        '10.0.0.101',
        '172.16.0.100',
        '172.16.0.101'
    ]
    return random.choice(ips)

def fetch_with_simple_python(category_id='252', finished=True):
    print('🐍 Using simple Python approach (no external dependencies)...')
    
    url = f"https://meshok.net/good/{category_id}{'?opt=2' if finished else ''}"
    print(f"📄 Fetching: {url}")
    
    try:
        # Создаем cookie jar для сессии
        cookie_jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))
        
        # Получаем случайные значения
        user_agent = get_random_user_agent()
        client_ip = get_random_ip()
        
        print(f"🔍 Using User-Agent: {user_agent[:50]}...")
        print(f"🔍 Using Client-IP: {client_ip}")
        
        # Сначала получаем главную страницу для cookies
        print('⏳ Getting main page for session...')
        
        main_req = urllib.request.Request(
            'https://meshok.net/',
            headers={
                'User-Agent': user_agent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1',
                'DNT': '1',
                'Client-IP': client_ip,
                'X-Forwarded-For': client_ip,
                'X-Real-IP': client_ip
            }
        )
        
        try:
            with opener.open(main_req, timeout=30) as response:
                main_content = response.read().decode('utf-8')
                print(f'✅ Main page loaded: {len(main_content) / 1024:.2f} KB')
                
                # Ждем случайное время (имитация человеческого поведения)
                wait_time = random.randint(1, 3)
                print(f'⏳ Waiting {wait_time} seconds (human behavior simulation)...')
                time.sleep(wait_time)
                
                # Теперь делаем запрос к целевой странице с cookies
                print('⏳ Making request to target page with session...')
                
                target_req = urllib.request.Request(
                    url,
                    headers={
                        'User-Agent': user_agent,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'same-origin',
                        'Sec-Fetch-User': '?1',
                        'Upgrade-Insecure-Requests': '1',
                        'DNT': '1',
                        'Referer': 'https://meshok.net/',
                        'Client-IP': client_ip,
                        'X-Forwarded-For': client_ip,
                        'X-Real-IP': client_ip,
                        'X-Forwarded-Proto': 'https',
                        'X-Forwarded-Host': 'meshok.net',
                        'X-Forwarded-Port': '443',
                        'X-Forwarded-Ssl': 'on'
                    }
                )
                
                with opener.open(target_req, timeout=30) as response:
                    content = response.read().decode('utf-8')
                    
                    print(f'📊 Status code: {response.status}')
                    print(f'📊 Response size: {len(content) / 1024:.2f} KB')
                    
                    # Проверяем на Cloudflare
                    if 'Just a moment' in content or 'Один момент' in content or 'Cloudflare' in content:
                        print('⚠️  Cloudflare challenge detected')
                        
                        # Пытаемся обойти с помощью дополнительных заголовков
                        print('🔄 Attempting to bypass Cloudflare...')
                        time.sleep(5)
                        
                        # Повторный запрос с другими заголовками
                        bypass_req = urllib.request.Request(
                            url,
                            headers={
                                'User-Agent': user_agent,
                                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                                'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
                                'Accept-Encoding': 'gzip, deflate, br',
                                'Cache-Control': 'no-cache',
                                'Pragma': 'no-cache',
                                'Sec-Fetch-Dest': 'document',
                                'Sec-Fetch-Mode': 'navigate',
                                'Sec-Fetch-Site': 'same-origin',
                                'Sec-Fetch-User': '?1',
                                'Upgrade-Insecure-Requests': '1',
                                'DNT': '1',
                                'Referer': 'https://meshok.net/',
                                'Client-IP': client_ip,
                                'X-Forwarded-For': client_ip,
                                'X-Real-IP': client_ip,
                                'X-Forwarded-Proto': 'https',
                                'X-Forwarded-Host': 'meshok.net',
                                'X-Forwarded-Port': '443',
                                'X-Forwarded-Ssl': 'on',
                                'CF-Connecting-IP': client_ip,
                                'CF-Ray': f'{random.randint(100000, 999999)}-AMS',
                                'CF-Visitor': '{"scheme":"https"}'
                            }
                        )
                        
                        try:
                            with opener.open(bypass_req, timeout=30) as bypass_response:
                                content = bypass_response.read().decode('utf-8')
                                
                                if 'Just a moment' in content or 'Один момент' in content:
                                    print('❌ Cloudflare challenge still present')
                                else:
                                    print('✅ Cloudflare challenge bypassed!')
                        except Exception as e:
                            print(f'❌ Bypass attempt failed: {e}')
                    else:
                        print('✅ No Cloudflare challenge detected')
                    
                    # Сохраняем результат
                    timestamp = datetime.now().strftime('%Y-%m-%dT%H-%M-%S-%fZ')
                    filename = f"simple_python_good{category_id}_opt{'2' if finished else '1'}_{timestamp}.html"
                    filepath = os.path.join('data', filename)
                    
                    os.makedirs('data', exist_ok=True)
                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.write(content)
                    
                    print(f'✅ Saved to: {filename}')
                    
                    # Простой анализ содержимого
                    if '<title>' in content:
                        title_start = content.find('<title>') + 7
                        title_end = content.find('</title>')
                        if title_end > title_start:
                            title = content[title_start:title_end]
                            print(f'📋 Page title: {title}')
                    
                    # Поиск ссылок на лоты
                    item_links = content.count('href="/item/')
                    print(f'🔗 Item links found: {item_links}')
                    
                    if item_links > 0:
                        print('🎉 Successfully obtained auction data with simple Python!')
                        
                        # Извлекаем первые несколько ссылок
                        import re
                        link_matches = re.findall(r'href="(/item/[^"]*)"', content)
                        print('📋 First 5 item links:')
                        for i, link in enumerate(link_matches[:5]):
                            print(f'   {i + 1}. https://meshok.net{link}')
                    else:
                        print('⚠️  No auction links found')
                    
                    # Поиск цен
                    price_matches = re.findall(r'[0-9,]+[ ]*₽|[0-9,]+[ ]*руб', content)
                    if price_matches:
                        print(f'💰 Prices found: {len(price_matches)}')
                        print('📋 Sample prices:')
                        for i, price in enumerate(price_matches[:3]):
                            print(f'   {i + 1}. {price}')
                    
                    # Поиск таблиц
                    table_count = content.count('<table')
                    print(f'📊 Tables found: {table_count}')
                    
                    # Поиск форм
                    form_count = content.count('<form')
                    print(f'📝 Forms found: {form_count}')
                    
                    # Поиск JSON данных
                    json_matches = re.findall(r'\{[^{}]*"[^"]*"[^{}]*\}', content)
                    if json_matches:
                        print(f'📜 JSON data found: {len(json_matches)} matches')
                        print('📋 Sample JSON:')
                        for i, json_data in enumerate(json_matches[:2]):
                            print(f'   {i + 1}. {json_data[:100]}...')
                    else:
                        print('📜 No JSON data found')
                        
        except HTTPError as e:
            print(f'❌ HTTP Error: {e.code} - {e.reason}')
            if e.code == 403:
                print('💡 403 Forbidden - Cloudflare is blocking requests')
                print('💡 Try using a different approach or proxy')
        except URLError as e:
            print(f'❌ URL Error: {e.reason}')
        except Exception as e:
            print(f'❌ Error: {e}')
            
    except Exception as e:
        print(f'❌ Error: {e}')

if __name__ == '__main__':
    category_id = sys.argv[1] if len(sys.argv) > 1 else '252'
    finished = sys.argv[2] != 'false' if len(sys.argv) > 2 else True
    fetch_with_simple_python(category_id, finished)
