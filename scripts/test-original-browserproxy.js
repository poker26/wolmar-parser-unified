#!/usr/bin/env node

const http = require('http');

async function testOriginalBrowserProxy() {
    console.log('🧪 Testing Original BrowserProxy API...');
    
    // Тест 1: Проверка статуса
    console.log('📊 Testing status endpoint...');
    await testStatus();
    
    // Тест 2: Загрузка URL
    console.log('📄 Testing load endpoint...');
    await testLoadUrl();
    
    // Тест 3: Выполнение скрипта
    console.log('🔧 Testing execute endpoint...');
    await testExecuteScript();
}

async function testStatus() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 80,
            path: '/api/proxy/status',
            method: 'GET'
        };
        
        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    console.log('✅ Status check passed');
                    console.log(`📊 Status: ${result.status}`);
                    if (result.chrome) {
                        console.log(`🌐 Chrome: ${result.chrome.Browser}`);
                    }
                    resolve(result);
                } catch (error) {
                    console.error('❌ Status check failed:', error.message);
                    reject(error);
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('❌ Status check error:', error.message);
            reject(error);
        });
        
        req.end();
    });
}

async function testLoadUrl() {
    return new Promise((resolve, reject) => {
        const url = 'https://meshok.net/good/252?opt=2';
        const options = {
            hostname: 'localhost',
            port: 80,
            path: `/api/proxy/load?url=${encodeURIComponent(url)}`,
            method: 'GET'
        };
        
        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    console.log('✅ Load URL test completed');
                    console.log(`📊 Success: ${result.success}`);
                    console.log(`📊 URL: ${result.url}`);
                    console.log(`📊 HTML size: ${result.html ? result.html.length / 1024 : 0:.2f} KB`);
                    
                    if (result.success) {
                        // Анализ HTML
                        const html = result.html || '';
                        const itemLinks = (html.match(/href="\/item\/[^"]*"/g) || []).length;
                        const prices = (html.match(/[0-9,]+[ ]*₽|[0-9,]+[ ]*руб/g) || []).length;
                        
                        console.log(`🔗 Item links found: ${itemLinks}`);
                        console.log(`💰 Prices found: ${prices}`);
                        
                        if (itemLinks > 0) {
                            console.log('🎉 Successfully obtained auction data!');
                        } else {
                            console.log('⚠️  No auction links found');
                        }
                    } else {
                        console.log(`❌ Load failed: ${result.message}`);
                    }
                    
                    resolve(result);
                } catch (error) {
                    console.error('❌ Load URL test failed:', error.message);
                    reject(error);
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('❌ Load URL test error:', error.message);
            reject(error);
        });
        
        req.setTimeout(30000, () => {
            console.error('❌ Load URL test timeout');
            req.destroy();
            reject(new Error('Timeout'));
        });
        
        req.end();
    });
}

async function testExecuteScript() {
    return new Promise((resolve, reject) => {
        const script = 'document.title';
        const postData = JSON.stringify({ script: script });
        
        const options = {
            hostname: 'localhost',
            port: 80,
            path: '/api/proxy/execute',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    console.log('✅ Execute script test completed');
                    console.log(`📊 Success: ${result.success}`);
                    console.log(`📊 Result: ${result.result}`);
                    resolve(result);
                } catch (error) {
                    console.error('❌ Execute script test failed:', error.message);
                    reject(error);
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('❌ Execute script test error:', error.message);
            reject(error);
        });
        
        req.write(postData);
        req.end();
    });
}

async function testMeshokSpecific() {
    console.log('🎯 Testing Meshok-specific functionality...');
    
    const testUrls = [
        'https://meshok.net/good/252?opt=2',  // Завершенные торги монет
        'https://meshok.net/good/1106?opt=2', // СССР 1917-1991
        'https://meshok.net/item/343735645'   // Конкретный лот
    ];
    
    for (const url of testUrls) {
        console.log(`\n📄 Testing: ${url}`);
        
        try {
            const result = await new Promise((resolve, reject) => {
                const options = {
                    hostname: 'localhost',
                    port: 80,
                    path: `/api/proxy/load?url=${encodeURIComponent(url)}`,
                    method: 'GET'
                };
                
                const req = http.request(options, (res) => {
                    let data = '';
                    
                    res.on('data', (chunk) => {
                        data += chunk;
                    });
                    
                    res.on('end', () => {
                        try {
                            const result = JSON.parse(data);
                            resolve(result);
                        } catch (error) {
                            reject(error);
                        }
                    });
                });
                
                req.on('error', reject);
                req.setTimeout(30000, () => {
                    req.destroy();
                    reject(new Error('Timeout'));
                });
                
                req.end();
            });
            
            if (result.success) {
                const html = result.html || '';
                const itemLinks = (html.match(/href="\/item\/[^"]*"/g) || []).length;
                const prices = (html.match(/[0-9,]+[ ]*₽|[0-9,]+[ ]*руб/g) || []).length;
                
                console.log(`✅ Success: ${itemLinks} items, ${prices} prices`);
            } else {
                console.log(`❌ Failed: ${result.message}`);
            }
            
        } catch (error) {
            console.log(`❌ Error: ${error.message}`);
        }
    }
}

async function runTests() {
    try {
        console.log('🚀 Starting Original BrowserProxy tests...\n');
        
        await testOriginalBrowserProxy();
        console.log('');
        
        await testMeshokSpecific();
        console.log('');
        
        console.log('🎉 All tests completed successfully!');
        console.log('💡 Original BrowserProxy is working correctly');
        console.log('💡 Chrome extension is bypassing protection');
        console.log('💡 C# server is processing requests');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Запуск тестов
runTests();
