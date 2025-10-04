const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const { promisify } = require('util');

const execAsync = promisify(exec);

async function fetchWithSystemChrome(categoryId = '252', finished = true) {
  console.log('🌐 Using system Chrome to fetch data...');
  
  const url = `https://meshok.net/good/${categoryId}${finished ? '?opt=2' : ''}`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `system_chrome_good${categoryId}_opt${finished ? '2' : '1'}_${timestamp}.html`;
  const filepath = path.join(__dirname, '../data', filename);
  
  console.log(`📄 Fetching: ${url}`);
  
  try {
    // Создаем папку для данных
    await fs.ensureDir(path.join(__dirname, '../data'));
    
    // Команда для запуска Chrome с сохранением HTML
    const chromeCommand = `chromium-browser --headless --no-sandbox --disable-gpu --disable-dev-shm-usage \
      --user-agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
      --dump-dom "${url}" > "${filepath}"`;
    
    console.log('⏳ Executing Chrome command...');
    const { stdout, stderr } = await execAsync(chromeCommand);
    
    if (stderr) {
      console.log('⚠️  Chrome warnings:', stderr);
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
      console.log('🎉 Successfully obtained auction data via system Chrome!');
      
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
      console.log('💡 Check if the page loaded correctly');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    // Если Chromium не найден, попробуем другие варианты
    if (error.message.includes('chromium-browser')) {
      console.log('💡 Trying with chromium instead...');
      try {
        const chromiumCommand = `chromium --headless --no-sandbox --disable-gpu --disable-dev-shm-usage \
          --user-agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
          --dump-dom "${url}" > "${filepath}"`;
        
        await execAsync(chromiumCommand);
        console.log('✅ Successfully used chromium instead');
      } catch (chromiumError) {
        console.error('❌ Chromium also failed:', chromiumError.message);
      }
    }
  }
}

// Запуск
const categoryId = process.argv[2] || '252';
const finished = process.argv[3] !== 'false';
fetchWithSystemChrome(categoryId, finished);
