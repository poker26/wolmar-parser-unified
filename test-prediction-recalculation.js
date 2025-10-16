const { spawn } = require('child_process');

console.log('🧪 Тестируем пересчет прогнозов...');

// Тестируем запуск simplified-price-predictor.js с флагом --watchlist
const testProcess = spawn('node', ['simplified-price-predictor.js', '--watchlist', '112527'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
let errorOutput = '';

testProcess.stdout.on('data', (data) => {
    output += data.toString();
    console.log('📤 STDOUT:', data.toString().trim());
});

testProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
    console.log('❌ STDERR:', data.toString().trim());
});

testProcess.on('close', (code) => {
    console.log(`\n🏁 Процесс завершен с кодом: ${code}`);
    
    if (code === 0) {
        console.log('✅ Пересчет прогнозов прошел успешно!');
    } else {
        console.log('❌ Ошибка пересчета прогнозов');
        console.log('📊 Полный вывод:', output);
        console.log('📊 Полные ошибки:', errorOutput);
    }
});

testProcess.on('error', (error) => {
    console.error('❌ Ошибка запуска процесса:', error.message);
});
