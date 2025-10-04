const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');

async function analyzeSavedFiles() {
  console.log('🔍 Analyzing saved HTML files...');
  
  const dataDir = path.join(__dirname, '../data');
  
  try {
    // Получаем список всех HTML файлов
    const files = await fs.readdir(dataDir);
    const htmlFiles = files.filter(file => file.endsWith('.html'));
    
    if (htmlFiles.length === 0) {
      console.log('❌ No HTML files found in data directory');
      return;
    }
    
    console.log(`📁 Found ${htmlFiles.length} HTML files:`);
    htmlFiles.forEach((file, index) => {
      console.log(`   ${index + 1}. ${file}`);
    });
    
    // Анализируем каждый файл
    for (const file of htmlFiles) {
      console.log(`\n📄 Analyzing: ${file}`);
      
      const filePath = path.join(dataDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      console.log(`📊 Size: ${(content.length / 1024).toFixed(2)} KB`);
      
      // Анализ содержимого
      const $ = cheerio.load(content);
      
      // Проверяем заголовок
      const title = $('title').text();
      console.log(`📋 Title: ${title}`);
      
      // Проверяем на Cloudflare
      if (content.includes('Just a moment') || content.includes('Один момент')) {
        console.log('⚠️  Cloudflare challenge detected');
      } else {
        console.log('✅ No Cloudflare challenge detected');
      }
      
      // Поиск ссылок на лоты
      const itemLinks = $('a[href*="/item/"]');
      console.log(`🔗 Item links found: ${itemLinks.length}`);
      
      if (itemLinks.length > 0) {
        console.log('📋 First 5 item links:');
        itemLinks.slice(0, 5).each((index, element) => {
          const href = $(element).attr('href');
          const text = $(element).text().trim().substring(0, 50);
          console.log(`   ${index + 1}. ${text}... -> ${href}`);
        });
      }
      
      // Поиск цен
      const priceMatches = content.match(/[0-9,]+[ ]*₽|[0-9,]+[ ]*руб/g) || [];
      if (priceMatches.length > 0) {
        console.log(`💰 Prices found: ${priceMatches.length}`);
        console.log('📋 Sample prices:');
        priceMatches.slice(0, 3).forEach((price, index) => {
          console.log(`   ${index + 1}. ${price}`);
        });
      }
      
      // Поиск других полезных элементов
      const tables = $('table');
      console.log(`📊 Tables found: ${tables.length}`);
      
      const divs = $('div');
      console.log(`📦 Divs found: ${divs.length}`);
      
      const spans = $('span');
      console.log(`📝 Spans found: ${spans.length}`);
      
      // Поиск JSON данных в script тегах
      const scripts = $('script');
      console.log(`📜 Scripts found: ${scripts.length}`);
      
      let jsonDataFound = false;
      scripts.each((index, element) => {
        const scriptContent = $(element).html();
        if (scriptContent && (scriptContent.includes('{') && scriptContent.includes('}'))) {
          console.log(`📜 Script ${index + 1} contains JSON-like data`);
          jsonDataFound = true;
          
          // Пытаемся найти JSON
          try {
            const jsonMatch = scriptContent.match(/\{.*\}/s);
            if (jsonMatch) {
              console.log(`📜 Found JSON data in script ${index + 1}:`);
              console.log(`   ${jsonMatch[0].substring(0, 200)}...`);
            }
          } catch (e) {
            // Игнорируем ошибки парсинга JSON
          }
        }
      });
      
      if (!jsonDataFound) {
        console.log('📜 No JSON data found in scripts');
      }
      
      // Поиск форм
      const forms = $('form');
      console.log(`📝 Forms found: ${forms.length}`);
      
      // Поиск изображений
      const images = $('img');
      console.log(`🖼️  Images found: ${images.length}`);
      
      // Поиск мета-тегов
      const metaTags = $('meta');
      console.log(`🏷️  Meta tags found: ${metaTags.length}`);
      
      // Поиск ссылок на категории
      const categoryLinks = $('a[href*="/good/"]');
      console.log(`📂 Category links found: ${categoryLinks.length}`);
      
      if (categoryLinks.length > 0) {
        console.log('📋 First 3 category links:');
        categoryLinks.slice(0, 3).each((index, element) => {
          const href = $(element).attr('href');
          const text = $(element).text().trim().substring(0, 30);
          console.log(`   ${index + 1}. ${text}... -> ${href}`);
        });
      }
      
      // Поиск пагинации
      const pagination = $('a[href*="page"], .pagination, .pager');
      console.log(`📄 Pagination found: ${pagination.length}`);
      
      // Поиск таблиц с данными
      const dataTables = $('table tr');
      console.log(`📊 Table rows found: ${dataTables.length}`);
      
      if (dataTables.length > 0) {
        console.log('📋 First 3 table rows:');
        dataTables.slice(0, 3).each((index, element) => {
          const text = $(element).text().trim().substring(0, 100);
          console.log(`   ${index + 1}. ${text}...`);
        });
      }
      
      console.log('─'.repeat(80));
    }
    
  } catch (error) {
    console.error('❌ Error analyzing files:', error.message);
  }
}

// Запуск
analyzeSavedFiles();
