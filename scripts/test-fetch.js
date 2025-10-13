const puppeteer = require('puppeteer');

async function testFetch() {
  console.log('🧪 Testing Meshok.net access...');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
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
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  
  try {
    console.log('📄 Testing main page...');
    await page.goto('https://meshok.net', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    // Дополнительное ожидание для Cloudflare
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    const title = await page.title();
    console.log(`✅ Main page loaded: ${title}`);
    
    // Проверяем Cloudflare
    const content = await page.content();
    if (content.includes('Just a moment')) {
      console.log('⚠️  Cloudflare challenge detected on main page');
    } else {
      console.log('✅ No Cloudflare challenge on main page');
    }
    
    console.log('\n📄 Testing listing page...');
    await page.goto('https://meshok.net/good/252?opt=2', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    // Дополнительное ожидание для Cloudflare
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    const listingTitle = await page.title();
    console.log(`✅ Listing page loaded: ${listingTitle}`);
    
    const listingContent = await page.content();
    if (listingContent.includes('Just a moment')) {
      console.log('⚠️  Cloudflare challenge detected on listing page');
    } else {
      console.log('✅ No Cloudflare challenge on listing page');
    }
    
    // Проверяем наличие лотов
    const lotLinks = await page.$$eval('a[href*="/item/"]', links => links.length);
    console.log(`🔗 Found ${lotLinks} item links on listing page`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
    console.log('🏁 Test completed');
  }
}

testFetch();
