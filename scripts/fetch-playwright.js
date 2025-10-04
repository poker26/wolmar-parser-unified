const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');

async function fetchPlaywright(categoryId = '252', finished = true) {
  console.log('🎭 Using Playwright for advanced browser automation...');
  
  const browser = await chromium.launch({
    headless: true, // Headless режим для сервера
    args: [
      '--no-sandbox',
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
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
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
    }
  });
  
  const page = await context.newPage();
  
  // Скрытие автоматизации
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    // Удаление automation флагов
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
    
    // Имитация реальных свойств
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
    
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
  });
  
  const url = `https://meshok.net/good/${categoryId}${finished ? '?opt=2' : ''}`;
  
  console.log(`📄 Opening: ${url}`);
  console.log('⏳ Playwright will open browser - you may need to manually pass Cloudflare');
  console.log('⏳ Waiting 60 seconds for manual intervention...');
  
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });
    
    // Ждем 60 секунд для ручного прохождения Cloudflare
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    const content = await page.content();
    const title = await page.title();
    
    // Сохраняем результат
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `playwright_good${categoryId}_opt${finished ? '2' : '1'}_${timestamp}.html`;
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
      console.log('🎉 Successfully obtained auction data with Playwright!');
      
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
    console.log('⏳ Browser will stay open for 10 more seconds...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    await browser.close();
    console.log('🏁 Browser closed');
  }
}

// Запуск
const categoryId = process.argv[2] || '252';
const finished = process.argv[3] !== 'false';
fetchPlaywright(categoryId, finished);
