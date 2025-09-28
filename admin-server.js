const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// Глобальные переменные для отслеживания процессов
let mainParserProcess = null;
let updateParserProcess = null;
let scheduleJob = null;

// Пути к файлам
const MAIN_PARSER_PATH = '/var/www/wolmar-parser5.js';
const UPDATE_PARSER_PATH = '/var/www/update-current-auction-fixed.js';
const LOGS_DIR = './logs';

// Создаем директорию для логов если её нет
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Функция для записи логов
function writeLog(type, message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    const logFile = path.join(LOGS_DIR, `${type}-parser.log`);
    
    fs.appendFileSync(logFile, logMessage);
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// Функция для чтения логов
function readLogs(type, lines = 100) {
    const logFile = path.join(LOGS_DIR, `${type}-parser.log`);
    
    if (!fs.existsSync(logFile)) {
        return [];
    }
    
    const content = fs.readFileSync(logFile, 'utf8');
    const logLines = content.split('\n').filter(line => line.trim());
    
    return logLines.slice(-lines);
}

// Функция для очистки логов
function clearLogs(type) {
    const logFile = path.join(LOGS_DIR, `${type}-parser.log`);
    
    if (fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, '');
    }
}

// Запуск основного парсера
function startMainParser(auctionNumber, mode = 'main', resumeLot = null) {
    return new Promise((resolve, reject) => {
        if (mainParserProcess) {
            reject(new Error('Основной парсер уже запущен'));
            return;
        }

        let args = [mode, auctionNumber.toString()];
        if (mode === 'resume' && resumeLot) {
            args.push(resumeLot.toString());
        }

        writeLog('main', `Запуск основного парсера: ${MAIN_PARSER_PATH} ${args.join(' ')}`);

        mainParserProcess = spawn('node', [MAIN_PARSER_PATH, ...args], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        mainParserProcess.stdout.on('data', (data) => {
            const message = data.toString().trim();
            writeLog('main', message);
        });

        mainParserProcess.stderr.on('data', (data) => {
            const message = data.toString().trim();
            writeLog('main', `ERROR: ${message}`);
        });

        mainParserProcess.on('close', (code) => {
            writeLog('main', `Основной парсер завершен с кодом: ${code}`);
            mainParserProcess = null;
        });

        mainParserProcess.on('error', (error) => {
            writeLog('main', `Ошибка основного парсера: ${error.message}`);
            mainParserProcess = null;
            reject(error);
        });

        // Даем процессу время запуститься
        setTimeout(() => {
            if (mainParserProcess && !mainParserProcess.killed) {
                resolve({ success: true, pid: mainParserProcess.pid });
            } else {
                // Если процесс завершился, но без ошибки - это нормально
                resolve({ success: true, message: 'Парсер завершился успешно' });
            }
        }, 1000);
    });
}

// Остановка основного парсера
function stopMainParser() {
    return new Promise((resolve) => {
        if (!mainParserProcess) {
            resolve({ success: true, message: 'Основной парсер не запущен' });
            return;
        }

        writeLog('main', 'Остановка основного парсера...');
        
        mainParserProcess.kill('SIGTERM');
        
        // Ждем 5 секунд, затем принудительно завершаем
        setTimeout(() => {
            if (mainParserProcess && !mainParserProcess.killed) {
                mainParserProcess.kill('SIGKILL');
                writeLog('main', 'Основной парсер принудительно завершен');
            }
            mainParserProcess = null;
            resolve({ success: true, message: 'Основной парсер остановлен' });
        }, 5000);
    });
}

// Запуск парсера обновлений
function startUpdateParser(auctionNumber) {
    return new Promise((resolve, reject) => {
        if (updateParserProcess) {
            reject(new Error('Парсер обновлений уже запущен'));
            return;
        }

        writeLog('update', `Запуск парсера обновлений: ${UPDATE_PARSER_PATH} ${auctionNumber}`);

        updateParserProcess = spawn('node', [UPDATE_PARSER_PATH, auctionNumber.toString()], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        updateParserProcess.stdout.on('data', (data) => {
            const message = data.toString().trim();
            writeLog('update', message);
        });

        updateParserProcess.stderr.on('data', (data) => {
            const message = data.toString().trim();
            writeLog('update', `ERROR: ${message}`);
        });

        updateParserProcess.on('close', (code) => {
            writeLog('update', `Парсер обновлений завершен с кодом: ${code}`);
            updateParserProcess = null;
        });

        updateParserProcess.on('error', (error) => {
            writeLog('update', `Ошибка парсера обновлений: ${error.message}`);
            updateParserProcess = null;
            reject(error);
        });

        // Даем процессу время запуститься
        setTimeout(() => {
            if (updateParserProcess && !updateParserProcess.killed) {
                resolve({ success: true, pid: updateParserProcess.pid });
            } else {
                // Если процесс завершился, но без ошибки - это нормально
                resolve({ success: true, message: 'Парсер обновлений завершился успешно' });
            }
        }, 1000);
    });
}

// Остановка парсера обновлений
function stopUpdateParser() {
    return new Promise((resolve) => {
        if (!updateParserProcess) {
            resolve({ success: true, message: 'Парсер обновлений не запущен' });
            return;
        }

        writeLog('update', 'Остановка парсера обновлений...');
        
        updateParserProcess.kill('SIGTERM');
        
        // Ждем 5 секунд, затем принудительно завершаем
        setTimeout(() => {
            if (updateParserProcess && !updateParserProcess.killed) {
                updateParserProcess.kill('SIGKILL');
                writeLog('update', 'Парсер обновлений принудительно завершен');
            }
            updateParserProcess = null;
            resolve({ success: true, message: 'Парсер обновлений остановлен' });
        }, 5000);
    });
}

// Управление расписанием
function setSchedule(time, auctionNumber) {
    // Удаляем существующее расписание
    if (scheduleJob) {
        scheduleJob.stop();
        scheduleJob = null;
    }

    // Парсим время (формат HH:MM)
    const [hours, minutes] = time.split(':').map(Number);
    
    // Создаем cron выражение для ежедневного запуска
    const cronExpression = `${minutes} ${hours} * * *`;
    
    writeLog('schedule', `Установлено расписание: ${time} UTC для аукциона ${auctionNumber}`);
    
    scheduleJob = cron.schedule(cronExpression, () => {
        writeLog('schedule', `Автоматический запуск обновления для аукциона ${auctionNumber}`);
        startUpdateParser(auctionNumber).catch(error => {
            writeLog('schedule', `Ошибка автоматического запуска: ${error.message}`);
        });
    }, {
        scheduled: true,
        timezone: "UTC"
    });

    return { success: true, message: 'Расписание установлено' };
}

function deleteSchedule() {
    if (scheduleJob) {
        scheduleJob.stop();
        scheduleJob = null;
        writeLog('schedule', 'Расписание удалено');
        return { success: true, message: 'Расписание удалено' };
    }
    return { success: true, message: 'Расписание не было установлено' };
}

// Получение статуса
function getStatus() {
    const status = {
        mainParser: {
            status: mainParserProcess ? 'running' : 'stopped',
            message: mainParserProcess ? 'Запущен' : 'Остановлен',
            pid: mainParserProcess ? mainParserProcess.pid : null
        },
        updateParser: {
            status: updateParserProcess ? 'running' : 'stopped',
            message: updateParserProcess ? 'Запущен' : 'Остановлен',
            pid: updateParserProcess ? updateParserProcess.pid : null
        },
        schedule: {
            status: scheduleJob ? 'active' : 'inactive',
            message: scheduleJob ? 'Активно' : 'Неактивно'
        }
    };

    return status;
}

// Функция для получения прогресса парсера обновления
function getUpdateProgress(auctionNumber) {
    const progressFile = path.join(__dirname, `update_progress_${auctionNumber}.json`);
    
    if (!fs.existsSync(progressFile)) {
        return null;
    }
    
    try {
        const data = fs.readFileSync(progressFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Ошибка чтения прогресса:', error);
        return null;
    }
}

// Функция для очистки прогресса парсера обновления
function clearUpdateProgress(auctionNumber) {
    const progressFile = path.join(__dirname, `update_progress_${auctionNumber}.json`);
    
    try {
        if (fs.existsSync(progressFile)) {
            fs.unlinkSync(progressFile);
            writeLog('update', `Прогресс для аукциона ${auctionNumber} очищен`);
            return { success: true, message: 'Прогресс очищен' };
        } else {
            return { success: true, message: 'Прогресс не найден' };
        }
    } catch (error) {
        console.error('Ошибка очистки прогресса:', error);
        return { success: false, error: error.message };
    }
}

// Экспорт функций для использования в server.js
module.exports = {
    startMainParser,
    stopMainParser,
    startUpdateParser,
    stopUpdateParser,
    setSchedule,
    deleteSchedule,
    getStatus,
    readLogs,
    clearLogs,
    getUpdateProgress,
    clearUpdateProgress
};




