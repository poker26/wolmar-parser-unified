# Диагностика 502 Bad Gateway
Write-Host "🔍 ДИАГНОСТИКА 502 BAD GATEWAY" -ForegroundColor Yellow
Write-Host "================================" -ForegroundColor Yellow

Write-Host ""
Write-Host "1️⃣ Проверяем доступность сервера:" -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "https://coins.begemot26.ru" -Method Head -TimeoutSec 10
    Write-Host "✅ Сервер отвечает: $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "❌ Сервер недоступен: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "2️⃣ Проверяем доступность через IP:" -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "http://46.173.16.68:3001" -Method Head -TimeoutSec 10
    Write-Host "✅ Node.js отвечает на IP: $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js недоступен на IP: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "3️⃣ Проверяем доступность через домен:" -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "https://coins.begemot26.ru" -Method Head -TimeoutSec 10
    Write-Host "✅ Домен отвечает: $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "❌ Домен недоступен: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "4️⃣ Проверяем DNS резолюцию:" -ForegroundColor Cyan
try {
    $dns = Resolve-DnsName -Name "coins.begemot26.ru" -Type A
    Write-Host "✅ DNS резолюция: $($dns.IPAddress)" -ForegroundColor Green
} catch {
    Write-Host "❌ DNS резолюция не работает: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "5️⃣ Проверяем SSL сертификат:" -ForegroundColor Cyan
try {
    $cert = [System.Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}
    $request = [System.Net.WebRequest]::Create("https://coins.begemot26.ru")
    $response = $request.GetResponse()
    $cert = $request.ServicePoint.Certificate
    Write-Host "✅ SSL сертификат действителен до: $($cert.GetExpirationDateString())" -ForegroundColor Green
} catch {
    Write-Host "❌ Проблема с SSL: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "✅ Диагностика завершена" -ForegroundColor Green
