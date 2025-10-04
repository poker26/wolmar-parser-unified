const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

async function fetchWithChrome(categoryId = '252', finished = true) {
  console.log('🌐 Using server Chrome to bypass Cloudflare...');
  
  const browser = await puppeteer.launch({
    headless: false, // Открываем Chrome с GUI
    executablePath: '/usr/bin/google-chrome', // Путь к серверному Chrome
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--window-size=1920,1080',
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
  });
  
  const page = await browser.newPage();
  
  // Настройка viewport
  await page.setViewport({ width: 1920, height: 1080 });
  
  // Дополнительные заголовки для имитации реального браузера
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1'
  });
  
  const url = `https://meshok.net/good/${categoryId}${finished ? '?opt=2' : ''}`;
  
  console.log(`📄 Opening: ${url}`);
  console.log('⏳ Chrome will open - wait for page to load completely...');
  
  try {
    // Переходим на страницу
    await page.goto(url, {
      waitUntil: 'networkidle0', // Ждем полной загрузки
      timeout: 120000
    });
    
    console.log('⏳ Waiting for Cloudflare challenge to complete...');
    
    // Ждем до 60 секунд для прохождения Cloudflare
    let attempts = 0;
    let content = '';
    let title = '';
    
    while (attempts < 60) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      try {
        content = await page.content();
        title = await page.title();
        
        // Проверяем, прошли ли мы Cloudflare
        if (!content.includes('Just a moment') && 
            !content.includes('Checking your browser') &&
            !content.includes('Один момент') &&
            title !== 'Just a moment...') {
          console.log('✅ Cloudflare challenge passed!');
          break;
        }
        
        attempts++;
        if (attempts % 10 === 0) {
          console.log(`⏳ Attempt ${attempts}/60 - Still waiting for Cloudflare...`);
        }
      } catch (e) {
        // Игнорируем ошибки во время ожидания
      }
    }
    
    if (content.includes('Just a moment') || content.includes('Один момент')) {
      console.log('⚠️  Cloudflare challenge still active after 60 seconds');
      console.log('💡 You may need to manually interact with the browser');
    }
    
    // Получаем финальное содержимое
    content = await page.content();
    title = await page.title();
    
    // Сохраняем результат
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `chrome_good${categoryId}_opt${finished ? '2' : '1'}_${timestamp}.html`;
    const filepath = path.join(__dirname, '../data', filename);
    
    await fs.ensureDir(path.join(__dirname, '../data'));
    await fs.writeFile(filepath, content, 'utf-8');
    
    console.log(`✅ Saved to: ${filename}`);
    console.log(`📊 Size: ${(content.length / 1024).toFixed(2)} KB`);
    console.log(`📋 Page title: ${title}`);
    
    // Поиск ссылок на лоты
    const lotLinks = await page.$$eval('a[href*="/item/"]', links => links.length);
    console.log(`🔗 Found ${lotLinks} item links`);
    
    if (lotLinks > 0) {
      console.log('🎉 Successfully obtained auction data!');
      
      // Показываем первые несколько ссылок
      const firstLinks = await page.$$eval('a[href*="/item/"]', links => 
        links.slice(0, 5).map(link => ({
          href: link.href,
          text: link.textContent.trim().substring(0, 50)
        }))
      );
      console.log('📋 First 5 item links:');
      firstLinks.forEach((link, index) => {
        console.log(`   ${index + 1}. ${link.text}... -> ${link.href}`);
      });
      
      // Поиск информации о ценах
      const priceElements = await page.$$eval('[class*="price"], [class*="cost"], .price, .cost', elements => 
        elements.slice(0, 3).map(el => el.textContent.trim())
      );
      if (priceElements.length > 0) {
        console.log('💰 Sample prices found:');
        priceElements.forEach((price, index) => {
          console.log(`   ${index + 1}. ${price}`);
        });
      }
      
    } else {
      console.log('⚠️  No auction links found');
      console.log('💡 Check if the page loaded correctly or if Cloudflare is still blocking');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    console.log('⏳ Browser will stay open for 5 more seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    await browser.close();
    console.log('🏁 Browser closed');
  }
}

// Запуск
const categoryId = process.argv[2] || '252';
const finished = process.argv[3] !== 'false';
fetchWithChrome(categoryId, finished);
