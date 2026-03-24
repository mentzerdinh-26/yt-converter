Write-Host "Downloading FFmpeg binary..." -ForegroundColor Cyan
Invoke-WebRequest -Uri "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -OutFile "ffmpeg.zip"
Write-Host "Extracting FFmpeg..." -ForegroundColor Yellow
Expand-Archive -Path "ffmpeg.zip" -DestinationPath "ffmpeg-extract" -Force
Move-Item "ffmpeg-extract\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe" -Destination ".\ffmpeg.exe" -Force
Move-Item "ffmpeg-extract\ffmpeg-master-latest-win64-gpl\bin\ffprobe.exe" -Destination ".\ffprobe.exe" -Force
Remove-Item "ffmpeg.zip" -Force
Remove-Item "ffmpeg-extract" -Recurse -Force
Write-Host "FFmpeg successfully installed in the project root!" -ForegroundColor Green
