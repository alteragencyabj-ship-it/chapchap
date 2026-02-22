# Run as Administrator: right-click > Run with PowerShell (as Admin)
netsh advfirewall firewall add rule name="ARTISAN - Metro Bundler 8081" dir=in action=allow protocol=TCP localport=8081
netsh advfirewall firewall add rule name="ARTISAN - Backend API 8001" dir=in action=allow protocol=TCP localport=8001
Write-Host "Firewall rules created for ports 8081 and 8001" -ForegroundColor Green
pause
