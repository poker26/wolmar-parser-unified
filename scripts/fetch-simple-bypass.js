const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const { promisify } = require('util');

const execAsync = promisify(exec);

async function fetchSimpleBypass(categoryId = '252', finished = true) {
  console.log('🔄 Using simple bypass methods...');
  
  const url = `https://meshok.net/good/${categoryId}${finished ? '?opt=2' : ''}`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `simple_bypass_good${categoryId}_opt${finished ? '2' : '1'}_${timestamp}.html`;
  const filepath = path.join(__dirname, '../data', filename);
  
  console.log(`📄 Fetching: ${url}`);
  
  try {
    await fs.ensureDir(path.join(__dirname, '../data'));
    
    // Метод 1: Простой curl с минимальными заголовками
    console.log('🧪 Method 1: Simple curl...');
    try {
      const curlCommand = `curl -L -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" "${url}" > "${filepath}"`;
      
      const { stdout, stderr } = await execAsync(curlCommand);
      
      if (stderr) {
        console.log('⚠️  curl warnings:', stderr);
      }
      
      // Проверяем результат
      const stats = await fs.stat(filepath);
      console.log(`✅ curl saved: ${(stats.size / 1024).toFixed(2)} KB`);
      
      const content = await fs.readFile(filepath, 'utf-8');
      
      if (!content.includes('Just a moment') && !content.includes('Один момент')) {
        console.log('🎉 Simple curl method successful!');
        await analyzeContent(content, filename);
        return;
      } else {
        console.log('⚠️  Simple curl method blocked by Cloudflare');
      }
      
    } catch (error) {
      console.log('❌ Simple curl method failed:', error.message);
    }
    
    // Метод 2: Использование lynx
    console.log('🧪 Method 2: lynx text browser...');
    try {
      const lynxCommand = `lynx -dump -useragent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" "${url}" > "${filepath}"`;
      
      const { stdout, stderr } = await execAsync(lynxCommand);
      
      if (stderr) {
        console.log('⚠️  lynx warnings:', stderr);
      }
      
      // Проверяем результат
      const stats = await fs.stat(filepath);
      console.log(`✅ lynx saved: ${(stats.size / 1024).toFixed(2)} KB`);
      
      const content = await fs.readFile(filepath, 'utf-8');
      
      if (!content.includes('Just a moment') && !content.includes('Один момент')) {
        console.log('🎉 lynx method successful!');
        await analyzeContent(content, filename);
        return;
      } else {
        console.log('⚠️  lynx method blocked by Cloudflare');
      }
      
    } catch (error) {
      console.log('❌ lynx method failed:', error.message);
    }
    
    // Метод 3: Использование wget с простыми заголовками
    console.log('🧪 Method 3: Simple wget...');
    try {
      const wgetCommand = `wget --user-agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" \
        --timeout=30 \
        --tries=3 \
        -O "${filepath}" "${url}"`;
      
      const { stdout, stderr } = await execAsync(wgetCommand);
      
      if (stderr) {
        console.log('⚠️  wget warnings:', stderr);
      }
      
      // Проверяем результат
      const stats = await fs.stat(filepath);
      console.log(`✅ wget saved: ${(stats.size / 1024).toFixed(2)} KB`);
      
      const content = await fs.readFile(filepath, 'utf-8');
      
      if (!content.includes('Just a moment') && !content.includes('Один момент')) {
        console.log('🎉 wget method successful!');
        await analyzeContent(content, filename);
        return;
      } else {
        console.log('⚠️  wget method blocked by Cloudflare');
      }
      
    } catch (error) {
      console.log('❌ wget method failed:', error.message);
    }
    
    console.log('❌ All simple methods failed');
    console.log('💡 This site has very strong Cloudflare protection');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function analyzeContent(content, filename) {
  console.log(`📋 Page title: ${content.match(/<title>(.*?)<\/title>/) ? content.match(/<title>(.*?)<\/title>/)[1] : 'No title found'}`);
  
  // Поиск ссылок на лоты
  const lotLinks = (content.match(/href="\/item\/[^"]*"/g) || []).length;
  console.log(`🔗 Found ${lotLinks} item links`);
  
  if (lotLinks > 0) {
    console.log('🎉 Successfully obtained auction data!');
    
    // Извлекаем первые несколько ссылок
    const linkMatches = content.match(/href="(\/item\/[^"]*)"/g) || [];
    console.log('📋 First 5 item links:');
    linkMatches.slice(0, 5).forEach((link, index) => {
      const cleanLink = link.replace('href="', '').replace('"', '');
      console.log(`   ${index + 1}. https://meshok.net${cleanLink}`);
    });
    
    // Поиск цен
    const priceMatches = content.match(/[0-9,]+[ ]*₽|[0-9,]+[ ]*руб/g) || [];
    if (priceMatches.length > 0) {
      console.log('💰 Sample prices found:');
      priceMatches.slice(0, 3).forEach((price, index) => {
        console.log(`   ${index + 1}. ${price}`);
      });
    }
  } else {
    console.log('⚠️  No auction links found');
  }
}

// Запуск
const categoryId = process.argv[2] || '252';
const finished = process.argv[3] !== 'false';
fetchSimpleBypass(categoryId, finished);
