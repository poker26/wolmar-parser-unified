   # connect.ps1
   $password = "#D9*SejHhs9Y"
   $username = "root"
   $server = "45.9.41.191"

   Write-Host "Подключение к серверу $server..." -ForegroundColor Green

   # Создаем временный файл с паролем
   $tempFile = [System.IO.Path]::GetTempFileName()
   $password | Out-File -FilePath $tempFile -Encoding ASCII

   try {
       # Подключаемся через SSH
       ssh -o StrictHostKeyChecking=no $username@$server
   } finally {
       # Удаляем временный файл
       Remove-Item $tempFile -Force
   }