const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');

async function findHiddenApi() {
  console.log('🔍 Searching for hidden API endpoints...');
  
  const dataDir = path.join(__dirname, '../data');
  
  try {
    // Получаем список всех HTML файлов
    const files = await fs.readdir(dataDir);
    const htmlFiles = files.filter(file => file.endsWith('.html'));
    
    if (htmlFiles.length === 0) {
      console.log('❌ No HTML files found in data directory');
      return;
    }
    
    console.log(`📁 Analyzing ${htmlFiles.length} HTML files for API endpoints...`);
    
    // Анализируем каждый файл
    for (const file of htmlFiles) {
      console.log(`\n📄 Analyzing: ${file}`);
      
      const filePath = path.join(dataDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Поиск API endpoints
      const apiPatterns = [
        /https?:\/\/[^"'\s]+\.meshok\.net\/[^"'\s]*api[^"'\s]*/gi,
        /https?:\/\/[^"'\s]+\.meshok\.net\/[^"'\s]*\/api\/[^"'\s]*/gi,
        /https?:\/\/[^"'\s]+\.meshok\.net\/[^"'\s]*\/v\d+\/[^"'\s]*/gi,
        /https?:\/\/[^"'\s]+\.meshok\.net\/[^"'\s]*\/ajax\/[^"'\s]*/gi,
        /https?:\/\/[^"'\s]+\.meshok\.net\/[^"'\s]*\/json\/[^"'\s]*/gi,
        /https?:\/\/[^"'\s]+\.meshok\.net\/[^"'\s]*\/data\/[^"'\s]*/gi,
        /https?:\/\/[^"'\s]+\.meshok\.net\/[^"'\s]*\/fetch\/[^"'\s]*/gi,
        /https?:\/\/[^"'\s]+\.meshok\.net\/[^"'\s]*\/load\/[^"'\s]*/gi
      ];
      
      let apiEndpoints = new Set();
      
      apiPatterns.forEach(pattern => {
        const matches = content.match(pattern);
        if (matches) {
          matches.forEach(match => apiEndpoints.add(match));
        }
      });
      
      if (apiEndpoints.size > 0) {
        console.log(`🔗 Found ${apiEndpoints.size} potential API endpoints:`);
        Array.from(apiEndpoints).forEach((endpoint, index) => {
          console.log(`   ${index + 1}. ${endpoint}`);
        });
      } else {
        console.log('❌ No API endpoints found');
      }
      
      // Поиск JavaScript переменных с данными
      const $ = cheerio.load(content);
      const scripts = $('script');
      
      console.log(`📜 Analyzing ${scripts.length} script tags...`);
      
      let dataVariables = new Set();
      
      scripts.each((index, element) => {
        const scriptContent = $(element).html();
        if (scriptContent) {
          // Поиск переменных с данными
          const varPatterns = [
            /var\s+(\w*[Dd]ata\w*)\s*=/gi,
            /let\s+(\w*[Dd]ata\w*)\s*=/gi,
            /const\s+(\w*[Dd]ata\w*)\s*=/gi,
            /window\.(\w*[Dd]ata\w*)\s*=/gi,
            /window\[['"]([^'"]*[Dd]ata[^'"]*)['"]\]\s*=/gi
          ];
          
          varPatterns.forEach(pattern => {
            const matches = scriptContent.match(pattern);
            if (matches) {
              matches.forEach(match => dataVariables.add(match));
            }
          });
          
          // Поиск JSON данных
          const jsonMatches = scriptContent.match(/\{[^{}]*"[^"]*"[^{}]*\}/g);
          if (jsonMatches) {
            console.log(`📜 Found JSON data in script ${index + 1}:`);
            jsonMatches.slice(0, 3).forEach((json, i) => {
              console.log(`   ${i + 1}. ${json.substring(0, 100)}...`);
            });
          }
        }
      });
      
      if (dataVariables.size > 0) {
        console.log(`📊 Found ${dataVariables.size} data variables:`);
        Array.from(dataVariables).forEach((variable, index) => {
          console.log(`   ${index + 1}. ${variable}`);
        });
      }
      
      // Поиск форм с данными
      const forms = $('form');
      console.log(`📝 Found ${forms.length} forms`);
      
      forms.each((index, element) => {
        const action = $(element).attr('action');
        const method = $(element).attr('method');
        const inputs = $(element).find('input');
        
        if (action || method) {
          console.log(`📝 Form ${index + 1}: ${method || 'GET'} ${action || 'no action'}`);
          console.log(`   Inputs: ${inputs.length}`);
        }
      });
      
      // Поиск AJAX запросов
      const ajaxPatterns = [
        /\.ajax\(/gi,
        /fetch\(/gi,
        /XMLHttpRequest/gi,
        /axios\./gi,
        /\.post\(/gi,
        /\.get\(/gi
      ];
      
      let ajaxFound = false;
      ajaxPatterns.forEach(pattern => {
        if (content.match(pattern)) {
          ajaxFound = true;
        }
      });
      
      if (ajaxFound) {
        console.log('📡 AJAX requests found in JavaScript');
      }
      
      // Поиск ссылок на категории
      const categoryLinks = $('a[href*="/good/"]');
      console.log(`📂 Category links: ${categoryLinks.length}`);
      
      if (categoryLinks.length > 0) {
        console.log('📋 Category link patterns:');
        const patterns = new Set();
        categoryLinks.each((index, element) => {
          const href = $(element).attr('href');
          if (href) {
            const pattern = href.replace(/\d+/g, '{id}');
            patterns.add(pattern);
          }
        });
        
        Array.from(patterns).slice(0, 5).forEach((pattern, index) => {
          console.log(`   ${index + 1}. ${pattern}`);
        });
      }
      
      // Поиск ссылок на лоты
      const itemLinks = $('a[href*="/item/"]');
      console.log(`🔗 Item links: ${itemLinks.length}`);
      
      if (itemLinks.length > 0) {
        console.log('📋 Item link patterns:');
        const patterns = new Set();
        itemLinks.each((index, element) => {
          const href = $(element).attr('href');
          if (href) {
            const pattern = href.replace(/\d+/g, '{id}');
            patterns.add(pattern);
          }
        });
        
        Array.from(patterns).slice(0, 5).forEach((pattern, index) => {
          console.log(`   ${index + 1}. ${pattern}`);
        });
      }
      
      console.log('─'.repeat(80));
    }
    
  } catch (error) {
    console.error('❌ Error analyzing files:', error.message);
  }
}

// Запуск
findHiddenApi();
