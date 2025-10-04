#!/usr/bin/env node

const http = require('http');

async function testChromeDirect() {
    console.log('🧪 Testing Chrome DevTools Protocol directly...');
    
    try {
        // Тест 1: Проверка версии Chrome
        console.log('📊 Testing Chrome version...');
        const versionResponse = await makeRequest('GET', '/json/version');
        const version = JSON.parse(versionResponse);
        console.log('✅ Chrome version:', version.Browser);
        console.log('✅ Protocol version:', version['Protocol-Version']);
        
        // Тест 2: Получение списка вкладок
        console.log('\n📊 Testing Chrome tabs...');
        const tabsResponse = await makeRequest('GET', '/json');
        const tabs = JSON.parse(tabsResponse);
        console.log('✅ Chrome tabs found:', tabs.length);
        
        if (tabs.length > 0) {
            const tab = tabs[0];
            console.log('✅ First tab:', tab.title);
            console.log('✅ Tab URL:', tab.url);
            
            // Тест 3: Выполнение простого скрипта
            console.log('\n📊 Testing script execution...');
            const scriptCommand = {
                id: 1,
                method: "Runtime.evaluate",
                params: {
                    expression: "document.title",
                    returnByValue: true
                }
            };
            
            const scriptResponse = await sendChromeCommand(scriptCommand);
            console.log('✅ Script result:', scriptResponse.result.value);
            
            // Тест 4: Навигация на простую страницу
            console.log('\n📊 Testing navigation...');
            const navigateCommand = {
                id: 2,
                method: "Page.navigate",
                params: {
                    url: "https://httpbin.org/get",
                    waitUntil: "networkidle2"
                }
            };
            
            await sendChromeCommand(navigateCommand);
            console.log('✅ Navigation command sent');
            
            // Ждем загрузки
            await sleep(3000);
            
            // Получаем результат
            const getTitleCommand = {
                id: 3,
                method: "Runtime.evaluate",
                params: {
                    expression: "document.title",
                    returnByValue: true
                }
            };
            
            const titleResponse = await sendChromeCommand(getTitleCommand);
            console.log('✅ Page title:', titleResponse.result.value);
            
        } else {
            console.log('⚠️  No tabs found, creating new tab...');
            
            // Создаем новую вкладку
            const newTabCommand = {
                id: 1,
                method: "Target.createTarget",
                params: {
                    url: "about:blank"
                }
            };
            
            const newTabResponse = await sendChromeCommand(newTabCommand);
            console.log('✅ New tab created:', newTabResponse.result.targetId);
        }
        
        console.log('\n🎉 Chrome DevTools Protocol is working!');
        console.log('💡 Chrome is ready for BrowserProxy operations');
        
    } catch (error) {
        console.error('❌ Chrome test failed:', error.message);
        console.log('💡 Make sure Chrome is running with: google-chrome --remote-debugging-port=9222');
    }
}

async function makeRequest(method, path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 9222,
            path: path,
            method: method
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });

        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.end();
    });
}

async function sendChromeCommand(command) {
    const postData = JSON.stringify(command);
    
    const options = {
        hostname: 'localhost',
        port: 9222,
        path: '/json/runtime/evaluate',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.error) {
                        reject(new Error(result.error.message || 'Chrome command failed'));
                    } else {
                        resolve(result);
                    }
                } catch (error) {
                    reject(new Error('Invalid JSON response: ' + data.substring(0, 200)));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Chrome command timeout'));
        });
        req.write(postData);
        req.end();
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Запуск теста
testChromeDirect();
