const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

async function fetchStealth(categoryId = '252', finished = true) {
  console.log('🥷 Using stealth mode to bypass Cloudflare...');
  
  // Автоматическое определение пути к браузеру
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  let executablePath = '/usr/bin/chromium-browser';
  
  try {
    await execAsync('which chromium-browser');
    console.log('✅ Found chromium-browser');
  } catch (error) {
    try {
      await execAsync('which chromium');
      executablePath = '/usr/bin/chromium';
      console.log('✅ Found chromium');
    } catch (error2) {
      console.log('⚠️  No browser found, using default chromium-browser');
    }
  }
  
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: executablePath,
    args: ['--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-blink-features=AutomationControlled',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-images',
      '--disable-javascript',
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
      '--disable-features=WebRtcUseMinMaxVEADimensions',
      '--disable-features=WebRtcUseMinMaxVEADimensions',
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
  
  // Скрытие webdriver свойств
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    // Удаление automation флагов
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
  });
  
  // Настройка viewport
  await page.setViewport({ width: 1920, height: 1080 });
  
  // Дополнительные заголовки
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  });
  
  const url = `https://meshok.net/good/${categoryId}${finished ? '?opt=2' : ''}`;
  
  console.log(`📄 Opening: ${url}`);
  console.log('⏳ Using stealth mode - waiting for page to load...');
  
  try {
    // Переходим на страницу
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });
    
    console.log('⏳ Waiting for Cloudflare challenge...');
    
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
      console.log('💡 Stealth mode may not be sufficient for this site');
    }
    
    // Получаем финальное содержимое
    content = await page.content();
    title = await page.title();
    
    // Сохраняем результат
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `stealth_good${categoryId}_opt${finished ? '2' : '1'}_${timestamp}.html`;
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
      console.log('🎉 Successfully obtained auction data with stealth mode!');
      
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
      console.log('💡 Stealth mode may not be sufficient for this site');
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
fetchStealth(categoryId, finished);
