const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

async function fetchListingAdvanced(categoryId = '252', finished = true) {
  console.log('🚀 Launching browser with advanced settings...');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-images',
      '--disable-javascript',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
  });
  
  const page = await browser.newPage();
  
  // Настройка viewport и user agent
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  // Дополнительные заголовки
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  });
  
  const opt = finished ? '2' : '1';
  const url = `https://meshok.net/good/${categoryId}${finished ? '?opt=2' : ''}`;
  
  console.log(`📄 Fetching: ${url}`);
  
  try {
    // Переходим на страницу с увеличенным таймаутом
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });
    
    console.log('⏳ Waiting for Cloudflare challenge...');
    
    // Ждем до 30 секунд для прохождения Cloudflare
    let attempts = 0;
    let content = '';
    
    while (attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      content = await page.content();
      
      // Проверяем, прошли ли мы Cloudflare
      if (!content.includes('Just a moment') && !content.includes('Checking your browser')) {
        console.log('✅ Cloudflare challenge passed!');
        break;
      }
      
      attempts++;
      console.log(`⏳ Attempt ${attempts}/30 - Still waiting for Cloudflare...`);
    }
    
    if (content.includes('Just a moment')) {
      console.log('⚠️  Cloudflare challenge still active after 30 seconds');
      console.log('💡 Try running the script again or use a different approach');
    }
    
    // Сохраняем результат
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `listing_good${categoryId}_opt${opt}_${timestamp}.html`;
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
      console.log('🎉 Successfully bypassed Cloudflare and found auction data!');
    } else {
      console.log('⚠️  No auction links found - may need different approach');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
    console.log('🏁 Browser closed');
  }
}

// Запуск
const categoryId = process.argv[2] || '252';
fetchListingAdvanced(categoryId);
