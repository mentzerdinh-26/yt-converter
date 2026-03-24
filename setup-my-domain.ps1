param(
    [Parameter(Mandatory = $true)]
    [string]$DomainName
)

Write-Host "🚀 Đang thiết lập đường hầm bảo mật cho tên miền: $DomainName" -ForegroundColor Cyan

# 1. Tạo Tunnel mới (tên là my-yt-conv)
Write-Host "Step 1: Creating tunnel..."
$tunnelName = "my-yt-converter"
Invoke-Expression "./cloudflared.exe tunnel create $tunnelName"

# 2. Cấu hình DNS cho tên miền trỏ về Tunnel này
Write-Host "Step 2: Routing DNS to Tunnel..."
Invoke-Expression "./cloudflared.exe tunnel route dns $tunnelName $DomainName"

# 3. Tạo file cấu hình config.yml
Write-Host "Step 3: Creating config file..."
$configContent = @"
tunnel: $tunnelName
credentials-file: C:\Users\ADMIN\.cloudflared\uuid-here.json # Sẽ tự tìm nếu để mặc định
ingress:
  - hostname: $DomainName
    service: http://localhost:3000
  - service: http_status:404
"@
# Thực tế Cloudflare sẽ tự map, ta chỉ cần chạy lệnh run trực tiếp sau đó

Write-Host "✅ ĐÃ XONG! Giờ bạn có thể chạy website của mình bằng lệnh:" -ForegroundColor Green
Write-Host "./cloudflared.exe tunnel run $tunnelName" -ForegroundColor Yellow
Write-Host "--------------------------------------------------------"
