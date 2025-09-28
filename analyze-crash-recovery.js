const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

class CrashRecoveryAnalyzer {
    constructor() {
        this.logFiles = [
            '/var/log/wolmar-auto-restart.log',
            './logs/wolmar-parser-out.log',
            './logs/wolmar-parser-error.log'
        ];
        this.progressFiles = [
            './parser_progress_*.json',
            './mass_update_progress*.json',
            './optimized_mass_update_progress.json'
        ];
    }

    // Анализ логов для поиска последней активности парсера
    async analyzeLogs() {
        console.log('🔍 Анализ логов для восстановления парсера...');
        
        const analysis = {
            lastParserActivity: null,
            lastAuctionNumber: null,
            lastLotNumber: null,
            crashTime: null,
            recoveryData: null
        };

        // Анализируем каждый лог файл
        for (const logFile of this.logFiles) {
            if (fs.existsSync(logFile)) {
                const logContent = fs.readFileSync(logFile, 'utf8');
                const lines = logContent.split('\n').reverse(); // Читаем с конца
                
                for (const line of lines) {
                    // Ищем последнюю активность парсера
                    if (this.isParserActivity(line)) {
                        analysis.lastParserActivity = line;
                        analysis.crashTime = this.extractTimestamp(line);
                        
                        // Извлекаем номер аукциона и лота
                        const auctionMatch = line.match(/аукцион[а]?\s*(\d+)/i);
                        const lotMatch = line.match(/лот[а]?\s*(\d+)/i);
                        
                        if (auctionMatch) analysis.lastAuctionNumber = auctionMatch[1];
                        if (lotMatch) analysis.lastLotNumber = lotMatch[1];
                        
                        break;
                    }
                }
            }
        }

        // Анализируем файлы прогресса
        analysis.recoveryData = await this.analyzeProgressFiles();
        
        return analysis;
    }

    // Проверка, является ли строка активностью парсера
    isParserActivity(line) {
        const parserKeywords = [
            'парсер',
            'parser',
            'обработка лота',
            'lot processing',
            'аукцион',
            'auction',
            'прогресс',
            'progress',
            'обновление',
            'update'
        ];
        
        return parserKeywords.some(keyword => 
            line.toLowerCase().includes(keyword.toLowerCase())
        );
    }

    // Извлечение временной метки из строки лога
    extractTimestamp(line) {
        const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
        return timestampMatch ? timestampMatch[1] : null;
    }

    // Анализ файлов прогресса
    async analyzeProgressFiles() {
        console.log('📊 Анализ файлов прогресса...');
        
        const progressData = {
            activeParsers: [],
            lastProcessedLots: {},
            recoveryCommands: []
        };

        // Ищем файлы прогресса
        const progressFiles = this.findProgressFiles();
        
        for (const file of progressFiles) {
            try {
                const content = JSON.parse(fs.readFileSync(file, 'utf8'));
                
                // Анализируем прогресс основного парсера
                if (content.currentIndex && content.auctionUrl) {
                    // Извлекаем номер аукциона из URL
                    const auctionMatch = content.auctionUrl.match(/auction\/(\d+)/);
                    const auctionNumber = auctionMatch ? auctionMatch[1] : 'unknown';
                    
                    progressData.activeParsers.push({
                        type: 'main',
                        auctionNumber: auctionNumber,
                        currentLot: content.currentIndex,
                        progress: content.totalLots ? (content.currentIndex / content.totalLots * 100) : 0,
                        file: file
                    });
                    
                    progressData.recoveryCommands.push({
                        command: 'main',
                        auctionNumber: auctionNumber,
                        startLot: content.currentIndex + 1,
                        description: `Основной парсер: аукцион ${auctionNumber}, индекс ${content.currentIndex + 1}`
                    });
                } else if (content.currentLot && content.auctionNumber) {
                    // Старый формат файлов прогресса
                    progressData.activeParsers.push({
                        type: 'main',
                        auctionNumber: content.auctionNumber,
                        currentLot: content.currentLot,
                        progress: content.progress || 0,
                        file: file
                    });
                    
                    progressData.recoveryCommands.push({
                        command: 'main',
                        auctionNumber: content.auctionNumber,
                        startLot: content.currentLot + 1,
                        description: `Основной парсер: аукцион ${content.auctionNumber}, лот ${content.currentLot + 1}`
                    });
                }
                
                // Анализируем прогресс обновления ставок
                if (content.updateProgress && content.auctionNumber) {
                    progressData.activeParsers.push({
                        type: 'update',
                        auctionNumber: content.auctionNumber,
                        currentLot: content.updateProgress.currentLot,
                        progress: content.updateProgress.progress || 0,
                        file: file
                    });
                    
                    progressData.recoveryCommands.push({
                        command: 'update',
                        auctionNumber: content.auctionNumber,
                        startLot: content.updateProgress.currentLot + 1,
                        description: `Парсер обновления: аукцион ${content.auctionNumber}, лот ${content.updateProgress.currentLot + 1}`
                    });
                }
                
                // Анализируем прогресс генерации прогнозов
                if (content.predictionsProgress && content.auctionNumber) {
                    progressData.activeParsers.push({
                        type: 'predictions',
                        auctionNumber: content.auctionNumber,
                        currentLot: content.predictionsProgress.currentIndex,
                        progress: content.predictionsProgress.progress || 0,
                        file: file
                    });
                    
                    progressData.recoveryCommands.push({
                        command: 'predictions',
                        auctionNumber: content.auctionNumber,
                        startLot: content.predictionsProgress.currentIndex + 1,
                        description: `Генерация прогнозов: аукцион ${content.auctionNumber}, индекс ${content.predictionsProgress.currentIndex + 1}`
                    });
                }
                
            } catch (error) {
                console.log(`⚠️ Ошибка чтения файла ${file}:`, error.message);
            }
        }
        
        return progressData;
    }

    // Поиск файлов прогресса
    findProgressFiles() {
        const files = [];
        const currentDir = process.cwd();
        
        // Ищем файлы прогресса
        const patterns = [
            'parser_progress_*.json',
            'mass_update_progress*.json',
            'optimized_mass_update_progress.json',
            'working_mass_update_progress.json',
            'predictions_progress_*.json',
            'catalog_progress.json'
        ];
        
        for (const pattern of patterns) {
            try {
                const { execSync } = require('child_process');
                const result = execSync(`find ${currentDir} -name "${pattern}" -type f`, { encoding: 'utf8' });
                const foundFiles = result.trim().split('\n').filter(f => f);
                files.push(...foundFiles);
            } catch (error) {
                // Игнорируем ошибки поиска
            }
        }
        
        return files;
    }

    // Генерация команд восстановления
    generateRecoveryCommands(analysis) {
        console.log('🔄 Генерация команд восстановления...');
        
        const commands = [];
        
        if (analysis.recoveryData && analysis.recoveryData.recoveryCommands.length > 0) {
            for (const cmd of analysis.recoveryData.recoveryCommands) {
                if (cmd.command === 'main') {
                    commands.push({
                        type: 'main_parser',
                        command: `node wolmar-parser5.js index ${cmd.auctionNumber} ${cmd.startLot}`,
                        description: cmd.description,
                        apiCall: `POST /api/admin/start-main-parser`,
                        body: {
                            auctionNumber: cmd.auctionNumber,
                            resumeLot: cmd.startLot,
                            mode: 'resume'
                        }
                    });
                } else if (cmd.command === 'update') {
                    // Для парсера обновления используем внутренний номер БД
                    commands.push({
                        type: 'update_parser',
                        command: `node update-current-auction-fixed.js ${cmd.auctionNumber} ${cmd.startLot}`,
                        description: cmd.description,
                        apiCall: `POST /api/admin/start-update-parser`,
                        body: {
                            auctionNumber: cmd.auctionNumber,
                            resumeLot: cmd.startLot,
                            mode: 'resume'
                        }
                    });
                } else if (cmd.command === 'predictions') {
                    // Для генерации прогнозов используем Wolmar номер и индекс
                    commands.push({
                        type: 'predictions_generator',
                        command: `node generate-predictions-with-progress.js ${cmd.auctionNumber} ${cmd.startLot}`,
                        description: cmd.description,
                        apiCall: `POST /api/admin/start-predictions`,
                        body: {
                            auctionNumber: cmd.auctionNumber,
                            startFromIndex: cmd.startLot
                        }
                    });
                }
            }
        }
        
        return commands;
    }

    // Автоматическое восстановление
    async autoRecovery() {
        console.log('🚀 Автоматическое восстановление парсеров...');
        
        const analysis = await this.analyzeLogs();
        const commands = this.generateRecoveryCommands(analysis);
        
        if (commands.length === 0) {
            console.log('ℹ️ Нет активных парсеров для восстановления');
            return;
        }
        
        console.log('📋 Найдены парсеры для восстановления:');
        commands.forEach((cmd, index) => {
            console.log(`${index + 1}. ${cmd.description}`);
            console.log(`   Команда: ${cmd.command}`);
            console.log(`   API: ${cmd.apiCall}`);
            console.log('');
        });
        
        // Автоматически восстанавливаем парсеры
        for (const cmd of commands) {
            try {
                console.log(`🔄 Восстанавливаем: ${cmd.description}`);
                
                // Выполняем команду восстановления
                await this.executeRecoveryCommand(cmd);
                
                console.log(`✅ Восстановлен: ${cmd.description}`);
            } catch (error) {
                console.error(`❌ Ошибка восстановления ${cmd.description}:`, error.message);
            }
        }
    }

    // Выполнение команды восстановления
    async executeRecoveryCommand(cmd) {
        return new Promise((resolve, reject) => {
            exec(cmd.command, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    console.log('Вывод команды:', stdout);
                    if (stderr) console.log('Ошибки:', stderr);
                    resolve(stdout);
                }
            });
        });
    }

    // Отчет о восстановлении
    generateRecoveryReport(analysis, commands) {
        const report = {
            timestamp: new Date().toISOString(),
            crashAnalysis: analysis,
            recoveryCommands: commands,
            recommendations: []
        };
        
        if (commands.length > 0) {
            report.recommendations.push('✅ Найдены парсеры для восстановления');
            report.recommendations.push('🔄 Рекомендуется запустить команды восстановления');
        } else {
            report.recommendations.push('ℹ️ Активные парсеры не найдены');
            report.recommendations.push('✅ Сервер можно запускать в обычном режиме');
        }
        
        return report;
    }
}

// Основная функция
async function main() {
    const analyzer = new CrashRecoveryAnalyzer();
    
    console.log('🔍 Анализ сбоя сервера и восстановление парсеров');
    console.log('=' .repeat(60));
    
    try {
        // Анализируем логи
        const analysis = await analyzer.analyzeLogs();
        console.log('📊 Результаты анализа:');
        console.log(JSON.stringify(analysis, null, 2));
        
        // Генерируем команды восстановления
        const commands = analyzer.generateRecoveryCommands(analysis);
        console.log('\n🔄 Команды восстановления:');
        commands.forEach((cmd, index) => {
            console.log(`${index + 1}. ${cmd.description}`);
            console.log(`   Команда: ${cmd.command}`);
        });
        
        // Генерируем отчет
        const report = analyzer.generateRecoveryReport(analysis, commands);
        fs.writeFileSync('./crash-recovery-report.json', JSON.stringify(report, null, 2));
        console.log('\n📄 Отчет сохранен в crash-recovery-report.json');
        
        // Спрашиваем о восстановлении
        if (commands.length > 0) {
            console.log('\n❓ Хотите автоматически восстановить парсеры? (y/n)');
            // В реальном использовании здесь будет интерактивный ввод
            console.log('💡 Для автоматического восстановления запустите: node analyze-crash-recovery.js --auto-recovery');
        }
        
    } catch (error) {
        console.error('❌ Ошибка анализа:', error);
    }
}

// Проверяем аргументы командной строки
if (process.argv.includes('--auto-recovery')) {
    const analyzer = new CrashRecoveryAnalyzer();
    analyzer.autoRecovery().catch(console.error);
} else {
    main().catch(console.error);
}
