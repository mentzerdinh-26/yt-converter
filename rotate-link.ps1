# Cloudflare Tunnel Rotator for YT-Converter

Write-Host "🔄 Rotating Cloudflare Tunnel..." -ForegroundColor Cyan

# 1. Kill old tunnel if running
Stop-Process -Name "cloudflared" -ErrorAction SilentlyContinue

# 2. Start a new tunnel (TryCloudflare generates a random .trycloudflare.com URL)
Invoke-Expression "Start-Process ./cloudflared.exe -ArgumentList 'tunnel --url http://localhost:3000' -NoNewWindow"

Write-Host "✨ New tunnel has been started! ✨" -ForegroundColor Green
Write-Host "❗ Check the logs to see your new TryCloudflare link." -ForegroundColor Yellow
Write-Host "--------------------------------------------------------"
