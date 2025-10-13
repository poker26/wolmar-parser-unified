/**
 * Серверные функции для управления сбором истории ставок
 * Интегрируется с основной админ-панелью
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

class BiddingHistoryAdminServer {
    constructor() {
        this.runningProcesses = new Map();
        this.logs = [];
    }

    /**
     * Получение статистики по истории ставок
     */
    async getBiddingStats() {
        try {
            // Здесь можно добавить прямые SQL запросы к БД
            // Пока возвращаем заглушку
            return {
                total_lots: 0,
                with_bidding_history: 0,
                without_bidding_history: 0,
                last_updated: new Date().toISOString()
            };
        } catch (error) {
            console.error('Ошибка получения статистики:', error);
            throw error;
        }
    }

    /**
     * Запуск сбора для существующих лотов
     */
    async startExistingCollection(options = {}) {
        const { batchSize = 50, maxLots = 1000 } = options;
        
        try {
            const scriptPath = path.join(__dirname, 'add-bidding-history-to-existing-lots.js');
            const args = [batchSize.toString(), maxLots.toString()];
            
            const process = spawn('node', [scriptPath, ...args], {
                cwd: __dirname,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            const processId = `existing-${Date.now()}`;
            this.runningProcesses.set(processId, {
                process,
                type: 'existing_collection',
                startTime: new Date(),
                options
            });

            // Обработка вывода
            process.stdout.on('data', (data) => {
                const message = data.toString();
                this.addLog(`[${processId}] ${message}`);
                console.log(`[${processId}] ${message}`);
            });

            process.stderr.on('data', (data) => {
                const message = data.toString();
                this.addLog(`[${processId}] ERROR: ${message}`);
                console.error(`[${processId}] ERROR: ${message}`);
            });

            process.on('close', (code) => {
                this.addLog(`[${processId}] Процесс завершен с кодом ${code}`);
                this.runningProcesses.delete(processId);
            });

            return {
                processId,
                message: 'Сбор для существующих лотов запущен',
                batchSize,
                maxLots
            };

        } catch (error) {
            console.error('Ошибка запуска сбора:', error);
            throw error;
        }
    }

    /**
     * Запуск парсинга новых лотов
     */
    async startNewLotParsing(options = {}) {
        const { auctionNumber } = options;
        
        if (!auctionNumber) {
            throw new Error('Номер аукциона обязателен');
        }

        try {
            const scriptPath = path.join(__dirname, 'numismat-parser-with-bidding.js');
            const args = [auctionNumber];
            
            const process = spawn('node', [scriptPath, ...args], {
                cwd: __dirname,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            const processId = `new-${Date.now()}`;
            this.runningProcesses.set(processId, {
                process,
                type: 'new_parsing',
                startTime: new Date(),
                options
            });

            // Обработка вывода
            process.stdout.on('data', (data) => {
                const message = data.toString();
                this.addLog(`[${processId}] ${message}`);
                console.log(`[${processId}] ${message}`);
            });

            process.stderr.on('data', (data) => {
                const message = data.toString();
                this.addLog(`[${processId}] ERROR: ${message}`);
                console.error(`[${processId}] ERROR: ${message}`);
            });

            process.on('close', (code) => {
                this.addLog(`[${processId}] Процесс завершен с кодом ${code}`);
                this.runningProcesses.delete(processId);
            });

            return {
                processId,
                message: 'Парсинг новых лотов запущен',
                auctionNumber
            };

        } catch (error) {
            console.error('Ошибка запуска парсинга:', error);
            throw error;
        }
    }

    /**
     * Запуск комплексного сбора
     */
    async startComprehensiveCollection(options = {}) {
        const { batchSize = 50, maxLots = 1000, auctionNumber } = options;
        
        try {
            const scriptPath = path.join(__dirname, 'run-bidding-history-collection.js');
            const args = ['--comprehensive', `--batch=${batchSize}`, `--max=${maxLots}`];
            
            if (auctionNumber) {
                args.push(`--auction=${auctionNumber}`);
            }
            
            const process = spawn('node', [scriptPath, ...args], {
                cwd: __dirname,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            const processId = `comprehensive-${Date.now()}`;
            this.runningProcesses.set(processId, {
                process,
                type: 'comprehensive_collection',
                startTime: new Date(),
                options
            });

            // Обработка вывода
            process.stdout.on('data', (data) => {
                const message = data.toString();
                this.addLog(`[${processId}] ${message}`);
                console.log(`[${processId}] ${message}`);
            });

            process.stderr.on('data', (data) => {
                const message = data.toString();
                this.addLog(`[${processId}] ERROR: ${message}`);
                console.error(`[${processId}] ERROR: ${message}`);
            });

            process.on('close', (code) => {
                this.addLog(`[${processId}] Процесс завершен с кодом ${code}`);
                this.runningProcesses.delete(processId);
            });

            return {
                processId,
                message: 'Комплексный сбор запущен',
                batchSize,
                maxLots,
                auctionNumber
            };

        } catch (error) {
            console.error('Ошибка запуска комплексного сбора:', error);
            throw error;
        }
    }

    /**
     * Получение статуса запущенных процессов
     */
    getProcessStatus() {
        const processes = [];
        
        for (const [processId, processInfo] of this.runningProcesses) {
            processes.push({
                processId,
                type: processInfo.type,
                startTime: processInfo.startTime,
                options: processInfo.options,
                isRunning: !processInfo.process.killed
            });
        }

        return {
            running: processes,
            total: processes.length
        };
    }

    /**
     * Остановка процесса
     */
    async stopProcess(processId) {
        const processInfo = this.runningProcesses.get(processId);
        
        if (!processInfo) {
            throw new Error('Процесс не найден');
        }

        try {
            processInfo.process.kill('SIGTERM');
            this.addLog(`[${processId}] Процесс остановлен`);
            this.runningProcesses.delete(processId);
            
            return { message: 'Процесс остановлен' };
        } catch (error) {
            console.error('Ошибка остановки процесса:', error);
            throw error;
        }
    }

    /**
     * Получение логов
     */
    getLogs(limit = 100) {
        return this.logs.slice(-limit);
    }

    /**
     * Добавление лога
     */
    addLog(message) {
        const timestamp = new Date().toISOString();
        this.logs.push({
            timestamp,
            message
        });

        // Ограничиваем количество логов
        if (this.logs.length > 1000) {
            this.logs = this.logs.slice(-1000);
        }
    }

    /**
     * Очистка логов
     */
    clearLogs() {
        this.logs = [];
        return { message: 'Логи очищены' };
    }
}

// Создаем экземпляр для использования в других модулях
const biddingAdminServer = new BiddingHistoryAdminServer();

module.exports = {
    BiddingHistoryAdminServer,
    biddingAdminServer
};
