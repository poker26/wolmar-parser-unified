const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

async function fetchWithSession(categoryId = '252', finished = true) {
  console.log('🚀 Launching browser with session persistence...');
  
  const browser = await puppeteer.launch({
    headless: false, // НЕ headless для обхода Cloudflare
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--disable-gpu',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
  });
  
  const page = await browser.newPage();
  
  // Настройка viewport
  await page.setViewport({ width: 1920, height: 1080 });
  
  // Дополнительные заголовки
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  });
  
  const url = `https://meshok.net/good/${categoryId}${finished ? '?opt=2' : ''}`;
  
  console.log(`📄 Fetching: ${url}`);
  console.log('⚠️  Browser will open in GUI mode - you may need to manually pass Cloudflare challenge');
  console.log('⏳ Waiting 30 seconds for manual intervention...');
  
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    
    // Ждем 30 секунд для ручного прохождения Cloudflare
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    const content = await page.content();
    
    // Сохраняем результат
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `session_good${categoryId}_opt${finished ? '2' : '1'}_${timestamp}.html`;
    const filepath = path.join(__dirname, '../data', filename);
    
    await fs.ensureDir(path.join(__dirname, '../data'));
    await fs.writeFile(filepath, content, 'utf-8');
    
    console.log(`✅ Saved to: ${filename}`);
    console.log(`📊 Size: ${(content.length / 1024).toFixed(2)} KB`);
    
    // Анализ содержимого
    const title = await page.title();
    console.log(`📋 Page title: ${title}`);
    
    // Поиск ссылок на лоты
    const lotLinks = await page.$$eval('a[href*="/item/"]', links => links.length);
    console.log(`🔗 Found ${lotLinks} item links`);
    
    if (lotLinks > 0) {
      console.log('🎉 Successfully obtained auction data!');
      
      // Показываем первые несколько ссылок
      const firstLinks = await page.$$eval('a[href*="/item/"]', links => 
        links.slice(0, 5).map(link => link.href)
      );
      console.log('📋 First 5 item links:');
      firstLinks.forEach((link, index) => {
        console.log(`   ${index + 1}. ${link}`);
      });
    } else {
      console.log('⚠️  No auction links found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    console.log('⏳ Browser will stay open for 10 more seconds...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    await browser.close();
    console.log('🏁 Browser closed');
  }
}

// Запуск
const categoryId = process.argv[2] || '252';
const finished = process.argv[3] !== 'false';
fetchWithSession(categoryId, finished);
