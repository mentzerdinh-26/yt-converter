# Script Khởi động Web Cố định snapyt2mp4.click

Write-Host "🚀 Đang khởi động Backend YouTube Converter (Port 3000)..." -ForegroundColor Cyan
# Chạy npm start trong cửa sổ mới để bạn dễ theo dõi log
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm start"

Write-Host "🛡️ Đang kết nối đường hầm bảo mật mã hóa snapyt2mp4.click..." -ForegroundColor Green
# Chạy Tunnel my-yt-converter đã thiết lập cố định
./cloudflared.exe tunnel run my-yt-converter
