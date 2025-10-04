const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

async function fetchMultipleAttempts(categoryId = '252', finished = true) {
  console.log('🔄 Trying multiple approaches to bypass Cloudflare...');
  
  const approaches = [
    {
      name: 'Mobile Chrome',
      userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      viewport: { width: 375, height: 812 }
    },
    {
      name: 'Windows Chrome',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    },
    {
      name: 'Mac Chrome',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 }
    },
    {
      name: 'Firefox',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0',
      viewport: { width: 1920, height: 1080 }
    }
  ];
  
  const url = `https://meshok.net/good/${categoryId}${finished ? '?opt=2' : ''}`;
  
  for (let i = 0; i < approaches.length; i++) {
    const approach = approaches[i];
    console.log(`\n🧪 Attempt ${i + 1}/${approaches.length}: ${approach.name}`);
    
    try {
      const browser = await puppeteer.launch({
        headless: true,
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
          `--user-agent=${approach.userAgent}`
        ]
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
      await page.setViewport(approach.viewport);
      
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
      
      console.log(`📄 Opening: ${url}`);
      console.log(`🔧 Using: ${approach.userAgent}`);
      
      // Переходим на страницу
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      
      console.log('⏳ Waiting for Cloudflare challenge...');
      
      // Ждем до 30 секунд для прохождения Cloudflare
      let attempts = 0;
      let content = '';
      let title = '';
      
      while (attempts < 30) {
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
          if (attempts % 5 === 0) {
            console.log(`⏳ Attempt ${attempts}/30 - Still waiting for Cloudflare...`);
          }
        } catch (e) {
          // Игнорируем ошибки во время ожидания
        }
      }
      
      // Получаем финальное содержимое
      content = await page.content();
      title = await page.title();
      
      // Проверяем результат
      if (content.includes('Just a moment') || content.includes('Один момент')) {
        console.log('⚠️  Cloudflare challenge still active');
        await browser.close();
        continue; // Пробуем следующий подход
      }
      
      // Поиск ссылок на лоты
      const lotLinks = await page.$$eval('a[href*="/item/"]', links => links.length);
      
      if (lotLinks > 0) {
        console.log(`🎉 Success with ${approach.name}! Found ${lotLinks} item links`);
        
        // Сохраняем результат
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `multiple_${approach.name.toLowerCase().replace(' ', '_')}_good${categoryId}_opt${finished ? '2' : '1'}_${timestamp}.html`;
        const filepath = path.join(__dirname, '../data', filename);
        
        await fs.ensureDir(path.join(__dirname, '../data'));
        await fs.writeFile(filepath, content, 'utf-8');
        
        console.log(`✅ Saved to: ${filename}`);
        console.log(`📊 Size: ${(content.length / 1024).toFixed(2)} KB`);
        console.log(`📋 Page title: ${title}`);
        
        // Показываем первые несколько ссылок
        const firstLinks = await page.$$eval('a[href*="/item/"]', links => 
          links.slice(0, 3).map(link => ({
            href: link.href,
            text: link.textContent.trim().substring(0, 30)
          }))
        );
        console.log('📋 First 3 item links:');
        firstLinks.forEach((link, index) => {
          console.log(`   ${index + 1}. ${link.text}... -> ${link.href}`);
        });
        
        await browser.close();
        return; // Успешно завершили
      } else {
        console.log('⚠️  No auction links found with this approach');
        await browser.close();
      }
      
    } catch (error) {
      console.error(`❌ Error with ${approach.name}:`, error.message);
    }
  }
  
  console.log('\n❌ All approaches failed to bypass Cloudflare');
  console.log('💡 This site may have very strong protection');
}

// Запуск
const categoryId = process.argv[2] || '252';
const finished = process.argv[3] !== 'false';
fetchMultipleAttempts(categoryId, finished);
