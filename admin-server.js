const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// Глобальные переменные для отслеживания процессов
let mainParserProcess = null;
let updateParserProcess = null;
let predictionsProcess = null;
let scheduleJob = null;

// Файл для сохранения расписания
const SCHEDULE_FILE = './schedule.json';

// Функции для работы с расписанием
function saveScheduleToFile(time, auctionNumber, cronExpression) {
    const scheduleData = {
        time,
        auctionNumber,
        cronExpression,
        createdAt: new Date().toISOString()
    };
    
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(scheduleData, null, 2));
    writeLog('schedule', `Расписание сохранено в файл: ${SCHEDULE_FILE}`);
}

function loadScheduleFromFile() {
    if (!fs.existsSync(SCHEDULE_FILE)) {
        return null;
    }
    
    try {
        const data = fs.readFileSync(SCHEDULE_FILE, 'utf8');
        const scheduleData = JSON.parse(data);
        writeLog('schedule', `Загружено расписание из файла: ${scheduleData.time} UTC для аукциона ${scheduleData.auctionNumber}`);
        return scheduleData;
    } catch (error) {
        writeLog('schedule', `Ошибка загрузки расписания: ${error.message}`);
        return null;
    }
}

function deleteScheduleFile() {
    if (fs.existsSync(SCHEDULE_FILE)) {
        fs.unlinkSync(SCHEDULE_FILE);
        writeLog('schedule', 'Файл расписания удален');
    }
}

// Пути к файлам
const MAIN_PARSER_PATH = '/var/www/wolmar-parser5.js';
const UPDATE_PARSER_PATH = '/var/www/update-current-auction-fixed.js';
const PREDICTIONS_PATH = '/var/www/wolmar-parser/generate-predictions-with-progress.js';
const LOGS_DIR = path.join(__dirname, 'logs');

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
    console.log(`🔍 readLogs вызвана для типа: ${type}, LOGS_DIR: ${LOGS_DIR}`);
    let logFile;
    
    // Специальная обработка для category-parser
    if (type === 'category-parser') {
        logFile = path.join(LOGS_DIR, 'category-parser.log');
    } else {
        logFile = path.join(LOGS_DIR, `${type}-parser.log`);
    }
    
    if (!fs.existsSync(logFile)) {
        console.log(`❌ Файл логов не найден: ${logFile}`);
        return [];
    }
    
    const content = fs.readFileSync(logFile, 'utf8');
    const logLines = content.split('\n').filter(line => line.trim());
    
    return logLines.slice(-lines);
}

// Функция для очистки логов
function clearLogs(type) {
    let logFile;
    
    // Специальная обработка для category-parser
    if (type === 'category-parser') {
        logFile = path.join(LOGS_DIR, 'category-parser.log');
    } else {
        logFile = path.join(LOGS_DIR, `${type}-parser.log`);
    }
    
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

        let args = [];
        
        // Определяем правильную команду и аргументы
        if (mode === 'resume' && resumeLot) {
            // Для продолжения с определенного лота используем команду 'index'
            args = ['index', auctionNumber.toString(), resumeLot.toString()];
        } else {
            // Для основных режимов используем переданный mode
            args = [mode, auctionNumber.toString()];
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

    // Сохраняем расписание в файл
    saveScheduleToFile(time, auctionNumber, cronExpression);
    
    return { success: true, message: 'Расписание установлено' };
}

function deleteSchedule() {
    if (scheduleJob) {
        scheduleJob.stop();
        scheduleJob = null;
    }
    
    // Удаляем файл расписания
    deleteScheduleFile();
    
    writeLog('schedule', 'Расписание удалено');
    return { success: true, message: 'Расписание удалено' };
}

// Получение статуса
function getStatus() {
    // Проверяем статус парсера каталога
    let catalogParserStatus = 'stopped';
    let catalogParserMessage = 'Остановлен';
    let catalogParserPid = null;
    
    try {
        if (fs.existsSync('catalog-parser-pid.json')) {
            const pidData = JSON.parse(fs.readFileSync('catalog-parser-pid.json', 'utf8'));
            catalogParserPid = pidData.pid;
            catalogParserStatus = 'running';
            catalogParserMessage = `Запущен (PID: ${pidData.pid})`;
        }
    } catch (e) {
        // Файл PID поврежден или не существует
    }
    
    // Дополнительная проверка через ps
    try {
        exec('ps aux | grep "catalog-parser.js" | grep -v grep', (error, stdout) => {
            if (stdout.trim()) {
                catalogParserStatus = 'running';
                catalogParserMessage = 'Запущен';
            }
        });
    } catch (e) {
        // Игнорируем ошибки проверки ps
    }

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
        predictionsGenerator: {
            status: predictionsProcess ? 'running' : 'stopped',
            message: predictionsProcess ? 'Запущен' : 'Остановлен',
            pid: predictionsProcess ? predictionsProcess.pid : null
        },
        catalogParser: {
            status: catalogParserStatus,
            message: catalogParserMessage,
            pid: catalogParserPid
        },
        categoryParser: {
            status: global.categoryParser ? 'running' : 'stopped',
            message: global.categoryParser ? 'Запущен' : 'Остановлен'
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

// Запуск генерации прогнозов
function startPredictionsGenerator(auctionNumber, startFromIndex = null) {
    return new Promise((resolve, reject) => {
        if (predictionsProcess) {
            reject(new Error('Генератор прогнозов уже запущен'));
            return;
        }

        let args = [auctionNumber.toString()];
        if (startFromIndex !== null) {
            args.push(startFromIndex.toString());
        }

        writeLog('predictions', `Запуск генерации прогнозов: ${PREDICTIONS_PATH} ${args.join(' ')}`);

        predictionsProcess = spawn('node', [PREDICTIONS_PATH, ...args], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        predictionsProcess.stdout.on('data', (data) => {
            const message = data.toString().trim();
            writeLog('predictions', message);
        });

        predictionsProcess.stderr.on('data', (data) => {
            const message = data.toString().trim();
            writeLog('predictions', `ERROR: ${message}`);
        });

        predictionsProcess.on('close', (code) => {
            writeLog('predictions', `Генератор прогнозов завершен с кодом: ${code}`);
            predictionsProcess = null;
        });

        predictionsProcess.on('error', (error) => {
            writeLog('predictions', `Ошибка генератора прогнозов: ${error.message}`);
            predictionsProcess = null;
            reject(error);
        });

        // Даем процессу время запуститься
        setTimeout(() => {
            if (predictionsProcess && !predictionsProcess.killed) {
                resolve({ success: true, pid: predictionsProcess.pid });
            } else {
                resolve({ success: true, message: 'Генератор прогнозов завершился успешно' });
            }
        }, 1000);
    });
}

// Остановка генерации прогнозов
function stopPredictionsGenerator() {
    return new Promise((resolve) => {
        if (!predictionsProcess) {
            resolve({ success: true, message: 'Генератор прогнозов не запущен' });
            return;
        }

        writeLog('predictions', 'Остановка генерации прогнозов...');
        
        predictionsProcess.kill('SIGTERM');
        
        // Ждем 5 секунд, затем принудительно завершаем
        setTimeout(() => {
            if (predictionsProcess && !predictionsProcess.killed) {
                predictionsProcess.kill('SIGKILL');
                writeLog('predictions', 'Генератор прогнозов принудительно завершен');
            }
            predictionsProcess = null;
            resolve({ success: true, message: 'Генератор прогнозов остановлен' });
        }, 5000);
    });
}

// Функция для получения прогресса генерации прогнозов
function getPredictionsProgress(auctionNumber) {
    const progressFile = path.join(__dirname, `predictions_progress_${auctionNumber}.json`);
    
    if (!fs.existsSync(progressFile)) {
        return null;
    }
    
    try {
        const data = fs.readFileSync(progressFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Ошибка чтения прогресса прогнозов:', error);
        return null;
    }
}

// Функция для очистки прогресса генерации прогнозов
function clearPredictionsProgress(auctionNumber) {
    const progressFile = path.join(__dirname, `predictions_progress_${auctionNumber}.json`);
    
    try {
        if (fs.existsSync(progressFile)) {
            fs.unlinkSync(progressFile);
            writeLog('predictions', `Прогресс прогнозов для аукциона ${auctionNumber} очищен`);
            return { success: true, message: 'Прогресс прогнозов очищен' };
        } else {
            return { success: true, message: 'Прогресс прогнозов не найден' };
        }
    } catch (error) {
        console.error('Ошибка очистки прогресса прогнозов:', error);
        return { success: false, error: error.message };
    }
}

// Функция восстановления расписания при запуске
function restoreSchedule() {
    const scheduleData = loadScheduleFromFile();
    if (scheduleData) {
        try {
            scheduleJob = cron.schedule(scheduleData.cronExpression, () => {
                writeLog('schedule', `Автоматический запуск обновления для аукциона ${scheduleData.auctionNumber}`);
                startUpdateParser(scheduleData.auctionNumber).catch(error => {
                    writeLog('schedule', `Ошибка автоматического запуска: ${error.message}`);
                });
            }, {
                scheduled: true,
                timezone: "UTC"
            });
            
            writeLog('schedule', `Расписание восстановлено: ${scheduleData.time} UTC для аукциона ${scheduleData.auctionNumber}`);
        } catch (error) {
            writeLog('schedule', `Ошибка восстановления расписания: ${error.message}`);
        }
    }
}

// Восстанавливаем расписание при запуске модуля
restoreSchedule();

// Экспорт функций для использования в server.js
module.exports = {
    startMainParser,
    stopMainParser,
    startUpdateParser,
    stopUpdateParser,
    startPredictionsGenerator,
    stopPredictionsGenerator,
    setSchedule,
    deleteSchedule,
    getStatus,
    readLogs,
    clearLogs,
    getUpdateProgress,
    clearUpdateProgress,
    getPredictionsProgress,
    clearPredictionsProgress
};




