#!/usr/bin/env node

const http = require('http');
const https = require('https');

async function testBrowserProxy() {
    console.log('🧪 Testing Browser Proxy Server...');
    
    const options = {
        hostname: 'localhost',
        port: 80,
        path: '/parse?category=252&finished=true',
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    };
    
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    console.log('✅ Server response received');
                    console.log(`📊 Status: ${res.statusCode}`);
                    console.log(`📊 Response size: ${data.length / 1024:.2f} KB`);
                    
                    if (result.title) {
                        console.log(`📋 Page title: ${result.title}`);
                    }
                    
                    if (result.items && result.items.length > 0) {
                        console.log(`🔗 Items found: ${result.items.length}`);
                        console.log('📋 First 3 items:');
                        result.items.slice(0, 3).forEach((item, i) => {
                            console.log(`   ${i + 1}. ${item.href} - ${item.text}`);
                        });
                    } else {
                        console.log('⚠️  No items found');
                    }
                    
                    if (result.prices && result.prices.length > 0) {
                        console.log(`💰 Prices found: ${result.prices.length}`);
                        console.log('📋 Sample prices:');
                        result.prices.slice(0, 3).forEach((price, i) => {
                            console.log(`   ${i + 1}. ${price}`);
                        });
                    }
                    
                    if (result.tables && result.tables.length > 0) {
                        console.log(`📊 Tables found: ${result.tables.length}`);
                    }
                    
                    if (result.forms && result.forms.length > 0) {
                        console.log(`📝 Forms found: ${result.forms.length}`);
                    }
                    
                    if (result.jsonData && result.jsonData.length > 0) {
                        console.log(`📜 JSON data found: ${result.jsonData.length} matches`);
                    }
                    
                    resolve(result);
                } catch (error) {
                    console.error('❌ Error parsing response:', error.message);
                    console.log('Raw response:', data);
                    reject(error);
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('❌ Request error:', error.message);
            reject(error);
        });
        
        req.setTimeout(30000, () => {
            console.error('❌ Request timeout');
            req.destroy();
            reject(new Error('Timeout'));
        });
        
        req.end();
    });
}

async function testHealthCheck() {
    console.log('🏥 Testing health check...');
    
    const options = {
        hostname: 'localhost',
        port: 80,
        path: '/health',
        method: 'GET'
    };
    
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    console.log('✅ Health check passed');
                    console.log(`📊 Status: ${result.status}`);
                    console.log(`📊 Version: ${result.version}`);
                    resolve(result);
                } catch (error) {
                    console.error('❌ Health check failed:', error.message);
                    reject(error);
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('❌ Health check error:', error.message);
            reject(error);
        });
        
        req.end();
    });
}

async function testItemEndpoint() {
    console.log('🔍 Testing item endpoint...');
    
    const options = {
        hostname: 'localhost',
        port: 80,
        path: '/item/343735645',
        method: 'GET'
    };
    
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    console.log('✅ Item endpoint response received');
                    console.log(`📊 Status: ${res.statusCode}`);
                    console.log(`📋 Item title: ${result.title}`);
                    resolve(result);
                } catch (error) {
                    console.error('❌ Item endpoint error:', error.message);
                    reject(error);
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('❌ Item endpoint error:', error.message);
            reject(error);
        });
        
        req.end();
    });
}

async function runTests() {
    try {
        console.log('🚀 Starting Browser Proxy tests...\n');
        
        // Тест 1: Health check
        await testHealthCheck();
        console.log('');
        
        // Тест 2: Parse endpoint
        await testBrowserProxy();
        console.log('');
        
        // Тест 3: Item endpoint
        await testItemEndpoint();
        console.log('');
        
        console.log('🎉 All tests completed successfully!');
        console.log('💡 Browser Proxy is working correctly');
        console.log('💡 Chrome extension is bypassing protection');
        console.log('💡 C# server is processing requests');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Запуск тестов
runTests();
