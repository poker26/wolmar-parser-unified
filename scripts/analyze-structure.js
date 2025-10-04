const fs = require('fs-extra');
const cheerio = require('cheerio');
const path = require('path');

async function analyzeHTML(filename) {
  console.log(`🔍 Analyzing: ${filename}`);
  
  const filepath = path.join(__dirname, '../data', filename);
  
  try {
    const html = await fs.readFile(filepath, 'utf-8');
    const $ = cheerio.load(html);
    
    console.log('\n📊 ANALYSIS RESULTS:\n');
    
    // Проверка на Cloudflare
    if (html.includes('Just a moment')) {
      console.log('⚠️  Cloudflare protection detected');
      return;
    }
    
    // Поиск JSON данных
    console.log('🔎 Looking for embedded JSON data...');
    let jsonFound = false;
    $('script').each((i, elem) => {
      const scriptContent = $(elem).html();
      if (scriptContent && scriptContent.includes('window.__')) {
        console.log(`   Found window.__ in script ${i}`);
        console.log(`   Preview: ${scriptContent.substring(0, 200)}...`);
        jsonFound = true;
      }
    });
    
    if (!jsonFound) {
      console.log('   No embedded JSON data found');
    }
    
    // Поиск ссылок на лоты
    console.log('\n🔗 Looking for item links...');
    const itemLinks = [];
    $('a[href*="/item/"]').each((i, elem) => {
      const href = $(elem).attr('href');
      itemLinks.push(href);
    });
    
    console.log(`   Found ${itemLinks.length} item links`);
    if (itemLinks.length > 0) {
      console.log('   First 5 links:');
      itemLinks.slice(0, 5).forEach(link => {
        console.log(`   - ${link}`);
      });
    }
    
    // Поиск цен
    console.log('\n💰 Looking for price information...');
    const priceElements = $('[class*="price"], [class*="cost"], .price, .cost').length;
    console.log(`   Found ${priceElements} price-related elements`);
    
    // Поиск информации о датах
    console.log('\n📅 Looking for date information...');
    const dateElements = $('[class*="date"], [class*="time"], .date, .time').length;
    console.log(`   Found ${dateElements} date-related elements`);
    
    // Структура данных
    console.log('\n📋 Page structure:');
    console.log(`   Total size: ${(html.length / 1024).toFixed(2)} KB`);
    console.log(`   Scripts: ${$('script').length}`);
    console.log(`   Links: ${$('a').length}`);
    console.log(`   Images: ${$('img').length}`);
    console.log(`   Tables: ${$('table').length}`);
    
    // Поиск пагинации
    console.log('\n📄 Looking for pagination...');
    const pagination = $('[class*="page"], [class*="pagination"], .pagination').length;
    console.log(`   Found ${pagination} pagination elements`);
    
    // Поиск форм поиска
    console.log('\n🔍 Looking for search forms...');
    const forms = $('form').length;
    console.log(`   Found ${forms} forms`);
    
    if (forms > 0) {
      $('form').each((i, form) => {
        const action = $(form).attr('action');
        const method = $(form).attr('method');
        console.log(`   Form ${i}: ${method} ${action}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error reading file:', error.message);
  }
}

// Запуск
const filename = process.argv[2];
if (!filename) {
  console.log('Usage: node analyze-structure.js <filename>');
  console.log('Example: node analyze-structure.js listing_good252_opt2_2025-10-04.html');
  process.exit(1);
}

analyzeHTML(filename);
