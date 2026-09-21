# SovereignFabric demo launcher — starts the backend, builds + starts the
# frontend in production mode, waits for both to be healthy, then opens the
# chat console. No internet / hosting dependency: everything runs on
# localhost so it can't be taken down by wifi or a cloud outage mid-pitch.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Wait-ForHealthy($url, $label, $maxTries = 60) {
    Write-Host "Waiting for $label..." -ForegroundColor Cyan
    for ($i = 0; $i -lt $maxTries; $i++) {
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) {
                Write-Host "$label is up." -ForegroundColor Green
                return $true
            }
        } catch {}
        Start-Sleep -Seconds 1
    }
    Write-Host "$label did not start in time." -ForegroundColor Red
    return $false
}

Write-Host "=== SovereignFabric Demo Launcher ===" -ForegroundColor Magenta

Write-Host "Starting AI Control Gateway (FastAPI)..." -ForegroundColor Cyan
Start-Process -FilePath "$root\api\venv\Scripts\python.exe" `
    -ArgumentList "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory "$root\api" -WindowStyle Minimized

if (-not (Wait-ForHealthy "http://127.0.0.1:8000/api/health" "Backend")) {
    Write-Host "Check api\venv is set up (see README) and try again." -ForegroundColor Red
    exit 1
}

Write-Host "Building + starting frontend (production mode)..." -ForegroundColor Cyan
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run build && npm start" `
    -WorkingDirectory "$root\web" -WindowStyle Minimized

if (-not (Wait-ForHealthy "http://localhost:3000/chat" "Frontend" 90)) {
    exit 1
}

Write-Host ""
Write-Host "Ready. Opening the chat console." -ForegroundColor Green
Write-Host "Backend:  http://127.0.0.1:8000" -ForegroundColor DarkGray
Write-Host "Frontend: http://localhost:3000" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Tip: click 'Reset demo state' inside Guided Demo right before you present," -ForegroundColor Yellow
Write-Host "     especially if you rehearse first." -ForegroundColor Yellow
Write-Host ""
Write-Host "Run stop-demo.ps1 when you're done." -ForegroundColor DarkGray

Start-Process "http://localhost:3000/chat"
