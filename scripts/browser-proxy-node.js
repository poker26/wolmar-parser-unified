#!/usr/bin/env node

const http = require('http');
const https = require('https');
const url = require('url');

// Простой HTTP сервер, который работает с Chrome DevTools Protocol
// Основан на оригинальном BrowserProxy из статьи Habr

class BrowserProxyNode {
    constructor() {
        this.chromeDebugUrl = 'http://localhost:9222';
        this.server = null;
    }

    async start(port = 8080) {
        console.log('🚀 Starting BrowserProxy Node.js server...');
        console.log(`📡 Chrome DevTools URL: ${this.chromeDebugUrl}`);
        
        this.server = http.createServer(async (req, res) => {
            try {
                await this.handleRequest(req, res);
            } catch (error) {
                console.error('❌ Server error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });

        this.server.listen(port, () => {
            console.log(`✅ BrowserProxy server running on port ${port}`);
            console.log(`🌐 API endpoints:`);
            console.log(`   GET  /load?url=<url>     - Load URL through Chrome`);
            console.log(`   GET  /status             - Check Chrome status`);
            console.log(`   POST /execute            - Execute JavaScript`);
        });
    }

    async handleRequest(req, res) {
        const parsedUrl = url.parse(req.url, true);
        const path = parsedUrl.pathname;
        const method = req.method;

        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        if (path === '/load') {
            await this.handleLoad(parsedUrl.query.url, res);
        } else if (path === '/status') {
            await this.handleStatus(res);
        } else if (path === '/execute' && method === 'POST') {
            await this.handleExecute(req, res);
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    }

    async handleLoad(targetUrl, res) {
        if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'URL parameter is required' }));
            return;
        }

        console.log(`📄 Loading URL: ${targetUrl}`);

        try {
            // Отправляем команду в Chrome через DevTools Protocol
            const navigateCommand = {
                id: 1,
                method: "Page.navigate",
                params: {
                    url: targetUrl,
                    waitUntil: "networkidle2"
                }
            };

            await this.sendChromeCommand(navigateCommand);

            // Ждем загрузки страницы
            await this.sleep(3000);

            // Получаем HTML содержимое
            const htmlCommand = {
                id: 2,
                method: "Runtime.evaluate",
                params: {
                    expression: "document.documentElement.outerHTML"
                }
            };

            const htmlResult = await this.sendChromeCommand(htmlCommand);
            const html = htmlResult.result.value;

            // Проверяем на Cloudflare
            if (html.includes('Just a moment') || html.includes('Один момент') || html.includes('Cloudflare')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    message: 'Cloudflare challenge detected',
                    html: html
                }));
                return;
            }

            // Анализируем содержимое
            const analysis = this.analyzeContent(html);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                url: targetUrl,
                html: html,
                analysis: analysis,
                timestamp: new Date().toISOString()
            }));

        } catch (error) {
            console.error('❌ Load error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: error.message
            }));
        }
    }

    async handleStatus(res) {
        try {
            const response = await this.makeRequest('GET', '/json/version');
            const version = JSON.parse(response);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'connected',
                chrome: version,
                timestamp: new Date().toISOString()
            }));

        } catch (error) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'disconnected',
                error: error.message,
                timestamp: new Date().toISOString()
            }));
        }
    }

    async handleExecute(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { script } = JSON.parse(body);
                
                const command = {
                    id: 3,
                    method: "Runtime.evaluate",
                    params: {
                        expression: script,
                        returnByValue: true
                    }
                };

                const result = await this.sendChromeCommand(command);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    result: result,
                    timestamp: new Date().toISOString()
                }));

            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: error.message
                }));
            }
        });
    }

    async sendChromeCommand(command) {
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
                        console.error('Chrome response:', data);
                        reject(new Error('Invalid JSON response from Chrome: ' + data.substring(0, 200)));
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

    async makeRequest(method, path) {
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
            req.end();
        });
    }

    analyzeContent(html) {
        const analysis = {
            itemLinks: 0,
            prices: 0,
            tables: 0,
            forms: 0,
            jsonData: 0
        };

        // Поиск ссылок на лоты
        const itemLinkMatches = html.match(/href="\/item\/[^"]*"/g);
        analysis.itemLinks = itemLinkMatches ? itemLinkMatches.length : 0;

        // Поиск цен
        const priceMatches = html.match(/[0-9,]+[ ]*₽|[0-9,]+[ ]*руб/g);
        analysis.prices = priceMatches ? priceMatches.length : 0;

        // Поиск таблиц
        const tableMatches = html.match(/<table/g);
        analysis.tables = tableMatches ? tableMatches.length : 0;

        // Поиск форм
        const formMatches = html.match(/<form/g);
        analysis.forms = formMatches ? formMatches.length : 0;

        // Поиск JSON данных
        const jsonMatches = html.match(/\{[^{}]*"[^"]*"[^{}]*\}/g);
        analysis.jsonData = jsonMatches ? jsonMatches.length : 0;

        return analysis;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Запуск сервера
const proxy = new BrowserProxyNode();
proxy.start(8080);
