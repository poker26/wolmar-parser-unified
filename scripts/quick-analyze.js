const fs = require('fs-extra');
const path = require('path');

async function quickAnalyze() {
  console.log('🔍 Quick analysis of saved HTML files...');
  
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
      
      // Проверяем заголовок
      const titleMatch = content.match(/<title>(.*?)<\/title>/);
      const title = titleMatch ? titleMatch[1] : 'No title found';
      console.log(`📋 Title: ${title}`);
      
      // Проверяем на Cloudflare
      if (content.includes('Just a moment') || content.includes('Один момент')) {
        console.log('⚠️  Cloudflare challenge detected');
      } else {
        console.log('✅ No Cloudflare challenge detected');
      }
      
      // Поиск ссылок на лоты
      const itemLinks = (content.match(/href="\/item\/[^"]*"/g) || []).length;
      console.log(`🔗 Item links found: ${itemLinks}`);
      
      if (itemLinks > 0) {
        console.log('📋 First 5 item links:');
        const linkMatches = content.match(/href="(\/item\/[^"]*)"/g) || [];
        linkMatches.slice(0, 5).forEach((link, index) => {
          const cleanLink = link.replace('href="', '').replace('"', '');
          console.log(`   ${index + 1}. https://meshok.net${cleanLink}`);
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
      
      // Поиск таблиц
      const tableMatches = content.match(/<table/g) || [];
      console.log(`📊 Tables found: ${tableMatches.length}`);
      
      // Поиск div элементов
      const divMatches = content.match(/<div/g) || [];
      console.log(`📦 Divs found: ${divMatches.length}`);
      
      // Поиск script тегов
      const scriptMatches = content.match(/<script/g) || [];
      console.log(`📜 Scripts found: ${scriptMatches.length}`);
      
      // Поиск JSON данных в script тегах
      const jsonMatches = content.match(/\{[^{}]*"[^"]*"[^{}]*\}/g) || [];
      if (jsonMatches.length > 0) {
        console.log(`📜 JSON data found: ${jsonMatches.length} matches`);
        console.log('📋 Sample JSON:');
        jsonMatches.slice(0, 2).forEach((json, index) => {
          console.log(`   ${index + 1}. ${json.substring(0, 100)}...`);
        });
      }
      
      // Поиск форм
      const formMatches = content.match(/<form/g) || [];
      console.log(`📝 Forms found: ${formMatches.length}`);
      
      // Поиск изображений
      const imgMatches = content.match(/<img/g) || [];
      console.log(`🖼️  Images found: ${imgMatches.length}`);
      
      // Поиск ссылок на категории
      const categoryLinks = (content.match(/href="\/good\/[^"]*"/g) || []).length;
      console.log(`📂 Category links found: ${categoryLinks}`);
      
      if (categoryLinks > 0) {
        console.log('📋 Category link patterns:');
        const categoryMatches = content.match(/href="(\/good\/[^"]*)"/g) || [];
        const patterns = new Set();
        categoryMatches.forEach(match => {
          const pattern = match.replace(/\d+/g, '{id}');
          patterns.add(pattern);
        });
        Array.from(patterns).slice(0, 3).forEach((pattern, index) => {
          console.log(`   ${index + 1}. ${pattern}`);
        });
      }
      
      // Поиск пагинации
      const paginationMatches = content.match(/page|pagination|pager/gi) || [];
      console.log(`📄 Pagination references: ${paginationMatches.length}`);
      
      // Поиск AJAX запросов
      const ajaxMatches = content.match(/ajax|fetch|XMLHttpRequest/gi) || [];
      console.log(`📡 AJAX references: ${ajaxMatches.length}`);
      
      console.log('─'.repeat(80));
    }
    
  } catch (error) {
    console.error('❌ Error analyzing files:', error.message);
  }
}

// Запуск
quickAnalyze();
