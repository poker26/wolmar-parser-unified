const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const { promisify } = require('util');

const execAsync = promisify(exec);

async function fetchWithCurl(categoryId = '252', finished = true) {
  console.log('🌐 Trying curl approach...');
  
  const opt = finished ? '2' : '1';
  const url = `https://meshok.net/good/${categoryId}${finished ? '?opt=2' : ''}`;
  
  console.log(`📄 Fetching: ${url}`);
  
  try {
    // Команда curl с обходом Cloudflare
    const curlCommand = `curl -L -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
      -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
      -H "Accept-Language: ru-RU,ru;q=0.9,en;q=0.8" \
      -H "Cache-Control: no-cache" \
      -H "Pragma: no-cache" \
      --connect-timeout 30 \
      --max-time 60 \
      "${url}"`;
    
    console.log('⏳ Executing curl command...');
    const { stdout, stderr } = await execAsync(curlCommand);
    
    if (stderr) {
      console.log('⚠️  Curl warnings:', stderr);
    }
    
    const content = stdout;
    console.log(`📊 Received ${(content.length / 1024).toFixed(2)} KB of data`);
    
    // Проверяем на Cloudflare
    if (content.includes('Just a moment') || content.includes('Checking your browser')) {
      console.log('⚠️  Cloudflare protection detected in curl response');
      console.log('💡 Curl approach also blocked by Cloudflare');
    } else {
      console.log('✅ No Cloudflare challenge detected in curl response');
    }
    
    // Сохраняем результат
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `curl_listing_good${categoryId}_opt${opt}_${timestamp}.html`;
    const filepath = path.join(__dirname, '../data', filename);
    
    await fs.ensureDir(path.join(__dirname, '../data'));
    await fs.writeFile(filepath, content, 'utf-8');
    
    console.log(`✅ Saved to: ${filename}`);
    
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
      console.log('🎉 Successfully obtained auction data via curl!');
    } else {
      console.log('⚠️  No auction links found');
    }
    
  } catch (error) {
    console.error('❌ Curl error:', error.message);
  }
}

// Запуск
const categoryId = process.argv[2] || '252';
fetchWithCurl(categoryId);
