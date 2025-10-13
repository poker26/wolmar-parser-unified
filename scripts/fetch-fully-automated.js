const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

async function fetchFullyAutomated(categoryId = '252', finished = true) {
  console.log('🤖 Using fully automated approach...');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-blink-features=AutomationControlled',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-ipc-flooding-protection',
      '--disable-hang-monitor',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--disable-translate',
      '--disable-logging',
      '--disable-permissions-api',
      '--disable-presentation-api',
      '--disable-print-preview',
      '--disable-speech-api',
      '--disable-file-system',
      '--disable-notifications',
      '--disable-geolocation',
      '--disable-media-session-api',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync-preferences',
      '--disable-component-extensions-with-background-pages',
      '--disable-client-side-phishing-detection',
      '--disable-component-update',
      '--disable-domain-reliability',
      '--disable-features=TranslateUI',
      '--disable-features=BlinkGenPropertyTrees',
      '--disable-features=VizDisplayCompositor',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--disable-features=WebRtcUseMinMaxVEADimensions',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--user-data-dir=/tmp/chrome-temp-womoa',
      '--disable-metrics',
      '--disable-metrics-reporting',
      '--disable-background-mode',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-logging',
      '--disable-gpu-logging',
      '--disable-features=TranslateUI,BlinkGenPropertyTrees,VizDisplayCompositor']
  });
  
  const page = await browser.newPage();
  
  // Максимальная скрытность
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    // Удаляем все automation флаги
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_JSON;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Object;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Proxy;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Reflect;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Error;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_parseInt;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_parseFloat;
    
    // Имитируем реальные свойства
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
    
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
  });
  
  // Настройка viewport
  await page.setViewport({ width: 1920, height: 1080 });
  
  // Реалистичные заголовки
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'DNT': '1'
  });
  
  const url = `https://meshok.net/good/${categoryId}${finished ? '?opt=2' : ''}`;
  
  console.log(`📄 Opening: ${url}`);
  console.log('⏳ Fully automated - no manual intervention needed...');
  
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });
    
    // Ждем автоматического прохождения Cloudflare
    console.log('⏳ Waiting for automatic Cloudflare bypass...');
    
    let attempts = 0;
    let content = '';
    let title = '';
    
    while (attempts < 120) { // 2 минуты максимум
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      try {
        content = await page.content();
        title = await page.title();
        
        // Проверяем, прошли ли мы Cloudflare
        if (!content.includes('Just a moment') && 
            !content.includes('Checking your browser') &&
            !content.includes('Один момент') &&
            title !== 'Just a moment...' &&
            !content.includes('Please wait')) {
          console.log('✅ Cloudflare challenge passed automatically!');
          break;
        }
        
        attempts++;
        if (attempts % 20 === 0) {
          console.log(`⏳ Attempt ${attempts}/120 - Still waiting for automatic bypass...`);
        }
      } catch (e) {
        // Игнорируем ошибки во время ожидания
      }
    }
    
    if (content.includes('Just a moment') || content.includes('Один момент')) {
      console.log('⚠️  Cloudflare challenge still active after 2 minutes');
      console.log('💡 This site may have very strong protection');
    }
    
    // Получаем финальное содержимое
    content = await page.content();
    title = await page.title();
    
    // Сохраняем результат
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `automated_good${categoryId}_opt${finished ? '2' : '1'}_${timestamp}.html`;
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
      console.log('🎉 Successfully obtained auction data automatically!');
      
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
      
    } else {
      console.log('⚠️  No auction links found');
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
const finished = process.argv[3] !== 'false';
fetchFullyAutomated(categoryId, finished);
