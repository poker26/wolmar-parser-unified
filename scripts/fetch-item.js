const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

async function fetchItem(itemId) {
  if (!itemId) {
    console.log('❌ Usage: node fetch-item.js <ITEM_ID>');
    console.log('   Example: node fetch-item.js 343735645');
    process.exit(1);
  }
  
  console.log('🚀 Launching browser...');
  
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
  
  const url = `https://meshok.net/item/${itemId}`;
  
  console.log(`📄 Fetching: ${url}`);
  
  try {
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    console.log('⏳ Waiting for content to load...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const content = await page.content();
    
    // Сохраняем
    const filename = `item_${itemId}.html`;
    const filepath = path.join(__dirname, '../data', filename);
    
    await fs.ensureDir(path.join(__dirname, '../data'));
    await fs.writeFile(filepath, content, 'utf-8');
    
    console.log(`✅ Saved to: ${filename}`);
    console.log(`📊 Size: ${(content.length / 1024).toFixed(2)} KB`);
    
    // Проверяем наличие Cloudflare challenge
    if (content.includes('Just a moment')) {
      console.log('⚠️  Cloudflare challenge detected!');
    } else {
      console.log('✅ Content loaded successfully');
    }
    
    // Дополнительная информация
    const title = await page.title();
    console.log(`📋 Page title: ${title}`);
    
    // Пытаемся извлечь основную информацию
    try {
      const price = await page.$eval('.price, .final-price, [class*="price"]', el => el.textContent.trim()).catch(() => 'Not found');
      console.log(`💰 Price: ${price}`);
    } catch (e) {
      console.log('💰 Price: Not found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
    console.log('🏁 Browser closed');
  }
}

const itemId = process.argv[2];
fetchItem(itemId);
