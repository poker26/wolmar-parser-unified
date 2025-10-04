const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const { promisify } = require('util');

const execAsync = promisify(exec);

async function fetchUndetected(categoryId = '252', finished = true) {
  console.log('🥷 Using undetected approach...');
  
  const url = `https://meshok.net/good/${categoryId}${finished ? '?opt=2' : ''}`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `undetected_good${categoryId}_opt${finished ? '2' : '1'}_${timestamp}.html`;
  const filepath = path.join(__dirname, '../data', filename);
  
  console.log(`📄 Fetching: ${url}`);
  
  try {
    await fs.ensureDir(path.join(__dirname, '../data'));
    
    // Попробуем разные подходы
    const approaches = [
      // Подход 1: Обычный curl с минимальными заголовками
      `curl -L -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" "${url}" > "${filepath}"`,
      
      // Подход 2: Curl с реалистичными заголовками
      `curl -L -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
        -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
        -H "Accept-Language: en-US,en;q=0.9" \
        -H "Cache-Control: no-cache" \
        -H "Pragma: no-cache" \
        "${url}" > "${filepath}"`,
      
      // Подход 3: Wget с реалистичными заголовками
      `wget --user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
        --header="Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
        --header="Accept-Language: en-US,en;q=0.9" \
        --header="Cache-Control: no-cache" \
        -O "${filepath}" "${url}"`
    ];
    
    for (let i = 0; i < approaches.length; i++) {
      console.log(`\n🧪 Attempt ${i + 1}/${approaches.length}`);
      
      try {
        const { stdout, stderr } = await execAsync(approaches[i]);
        
        if (stderr) {
          console.log('⚠️  Warnings:', stderr);
        }
        
        // Проверяем, что файл создался
        const stats = await fs.stat(filepath);
        console.log(`✅ Saved to: ${filename}`);
        console.log(`📊 Size: ${(stats.size / 1024).toFixed(2)} KB`);
        
        // Читаем содержимое для анализа
        const content = await fs.readFile(filepath, 'utf-8');
        
        // Проверяем на Cloudflare
        if (content.includes('Just a moment') || content.includes('Один момент')) {
          console.log('⚠️  Cloudflare protection detected');
          continue; // Пробуем следующий подход
        } else {
          console.log('✅ No Cloudflare challenge detected');
        }
        
        // Анализ содержимого
        if (content.includes('<title>')) {
          const titleMatch = content.match(/<title>(.*?)<\/title>/);
          if (titleMatch) {
            console.log(`📋 Page title: ${titleMatch[1]}`);
          }
        }
        
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
          
          return; // Успешно завершили
        } else {
          console.log('⚠️  No auction links found');
        }
        
      } catch (error) {
        console.error(`❌ Error with approach ${i + 1}:`, error.message);
      }
    }
    
    console.log('\n❌ All approaches failed');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Запуск
const categoryId = process.argv[2] || '252';
const finished = process.argv[3] !== 'false';
fetchUndetected(categoryId, finished);
