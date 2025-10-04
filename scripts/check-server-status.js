#!/usr/bin/env node

const http = require('http');

async function checkServerStatus() {
    console.log('🔍 Checking server status...');
    
    const ports = [80, 5000, 8080, 3000];
    
    for (const port of ports) {
        console.log(`📡 Checking port ${port}...`);
        
        try {
            const result = await new Promise((resolve, reject) => {
                const options = {
                    hostname: 'localhost',
                    port: port,
                    path: '/',
                    method: 'GET',
                    timeout: 5000
                };
                
                const req = http.request(options, (res) => {
                    let data = '';
                    
                    res.on('data', (chunk) => {
                        data += chunk;
                    });
                    
                    res.on('end', () => {
                        resolve({
                            port: port,
                            status: res.statusCode,
                            contentType: res.headers['content-type'],
                            data: data.substring(0, 200) + '...'
                        });
                    });
                });
                
                req.on('error', (error) => {
                    resolve({
                        port: port,
                        error: error.message
                    });
                });
                
                req.on('timeout', () => {
                    req.destroy();
                    resolve({
                        port: port,
                        error: 'Timeout'
                    });
                });
                
                req.end();
            });
            
            if (result.error) {
                console.log(`❌ Port ${port}: ${result.error}`);
            } else {
                console.log(`✅ Port ${port}: Status ${result.status}, Content-Type: ${result.contentType}`);
                console.log(`📄 Response: ${result.data}`);
            }
            
        } catch (error) {
            console.log(`❌ Port ${port}: ${error.message}`);
        }
    }
    
    console.log('\n💡 Recommendations:');
    console.log('1. Start C# server: npm run start:proxy');
    console.log('2. Check if Chrome is running with DevTools on port 9222');
    console.log('3. Verify systemd services: systemctl status browser-proxy');
}

async function checkChromeDevTools() {
    console.log('\n🌐 Checking Chrome DevTools...');
    
    try {
        const result = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'localhost',
                port: 9222,
                path: '/json/version',
                method: 'GET',
                timeout: 5000
            };
            
            const req = http.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const version = JSON.parse(data);
                        resolve({
                            success: true,
                            version: version
                        });
                    } catch (error) {
                        resolve({
                            success: false,
                            error: 'Invalid JSON response'
                        });
                    }
                });
            });
            
            req.on('error', (error) => {
                resolve({
                    success: false,
                    error: error.message
                });
            });
            
            req.on('timeout', () => {
                req.destroy();
                resolve({
                    success: false,
                    error: 'Timeout'
                });
            });
            
            req.end();
        });
        
        if (result.success) {
            console.log('✅ Chrome DevTools is running');
            console.log(`📊 Browser: ${result.version.Browser}`);
            console.log(`📊 Version: ${result.version['User-Agent']}`);
        } else {
            console.log(`❌ Chrome DevTools error: ${result.error}`);
            console.log('💡 Start Chrome with: google-chrome --remote-debugging-port=9222');
        }
        
    } catch (error) {
        console.log(`❌ Chrome DevTools error: ${error.message}`);
    }
}

async function runDiagnostics() {
    console.log('🔧 Running server diagnostics...\n');
    
    await checkServerStatus();
    await checkChromeDevTools();
    
    console.log('\n📋 Next steps:');
    console.log('1. Install dependencies: npm install');
    console.log('2. Setup Linux environment: npm run setup:linux');
    console.log('3. Start Chrome with DevTools: google-chrome --remote-debugging-port=9222');
    console.log('4. Start C# server: npm run start:proxy');
    console.log('5. Test again: npm run test:original');
}

runDiagnostics();
