const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const { promisify } = require('util');

const execAsync = promisify(exec);

async function fetchCurlAdvanced(categoryId = '252', finished = true) {
  console.log('🌐 Using advanced curl with realistic headers...');
  
  const url = `https://meshok.net/good/${categoryId}${finished ? '?opt=2' : ''}`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `curl_advanced_good${categoryId}_opt${finished ? '2' : '1'}_${timestamp}.html`;
  const filepath = path.join(__dirname, '../data', filename);
  
  console.log(`📄 Fetching: ${url}`);
  
  try {
    await fs.ensureDir(path.join(__dirname, '../data'));
    
    // Продвинутая команда curl с реалистичными заголовками
    const curlCommand = `curl -L -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
      -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7" \
      -H "Accept-Language: en-US,en;q=0.9" \
      -H "Accept-Encoding: gzip, deflate, br" \
      -H "Cache-Control: no-cache" \
      -H "Pragma: no-cache" \
      -H "Sec-Fetch-Dest: document" \
      -H "Sec-Fetch-Mode: navigate" \
      -H "Sec-Fetch-Site: none" \
      -H "Sec-Fetch-User: ?1" \
      -H "Upgrade-Insecure-Requests: 1" \
      -H "DNT: 1" \
      -H "Connection: keep-alive" \
      --connect-timeout 30 \
      --max-time 60 \
      --retry 3 \
      --retry-delay 5 \
      --compressed \
      "${url}" > "${filepath}"`;
    
    console.log('⏳ Executing advanced curl command...');
    const { stdout, stderr } = await execAsync(curlCommand);
    
    if (stderr) {
      console.log('⚠️  Curl warnings:', stderr);
    }
    
    // Проверяем, что файл создался
    const stats = await fs.stat(filepath);
    console.log(`✅ Saved to: ${filename}`);
    console.log(`📊 Size: ${(stats.size / 1024).toFixed(2)} KB`);
    
    // Читаем содержимое для анализа
    const content = await fs.readFile(filepath, 'utf-8');
    
    // Проверяем на Cloudflare
    if (content.includes('Just a moment') || content.includes('Один момент')) {
      console.log('⚠️  Cloudflare protection detected');
    } else {
      console.log('✅ No Cloudflare challenge detected');
    }
    
    // Анализ содержимого
    if (content.includes('<title>')) {
      const titleMatch = content.match(/<title>(.*?)<\/title>/);
      if (titleMatch) {
        console.log(`📋 Page title: ${titleMatch[1]}`);
      }
    }
    
    // Поиск ссылок на лоты
    const lotLinks = (content.match(/href="\/item\/[^"]*"/g) || []).length;
    console.log(`🔗 Found ${lotLinks} item links`);
    
    if (lotLinks > 0) {
      console.log('🎉 Successfully obtained auction data via advanced curl!');
      
      // Извлекаем первые несколько ссылок
      const linkMatches = content.match(/href="(\/item\/[^"]*)"/g) || [];
      console.log('📋 First 5 item links:');
      linkMatches.slice(0, 5).forEach((link, index) => {
        const cleanLink = link.replace('href="', '').replace('"', '');
        console.log(`   ${index + 1}. https://meshok.net${cleanLink}`);
      });
      
      // Поиск цен
      const priceMatches = content.match(/[0-9,]+[ ]*₽|[0-9,]+[ ]*руб/g) || [];
      if (priceMatches.length > 0) {
        console.log('💰 Sample prices found:');
        priceMatches.slice(0, 3).forEach((price, index) => {
          console.log(`   ${index + 1}. ${price}`);
        });
      }
      
    } else {
      console.log('⚠️  No auction links found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Запуск
const categoryId = process.argv[2] || '252';
const finished = process.argv[3] !== 'false';
fetchCurlAdvanced(categoryId, finished);
