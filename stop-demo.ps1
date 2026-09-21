# Stops the SovereignFabric backend (:8000) and frontend (:3000) dev/prod
# processes started by start-demo.ps1.

function Stop-Port($port, $label) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        Write-Host "$label (:$port) is not running." -ForegroundColor DarkGray
        return
    }
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $pids) {
        try {
            Stop-Process -Id $p -Force -ErrorAction Stop
            Write-Host "Stopped $label (:$port, pid $p)." -ForegroundColor Green
        } catch {
            Write-Host "Could not stop pid $p on :$port - $_" -ForegroundColor Red
        }
    }
}

Stop-Port 8000 "Backend"
Stop-Port 3000 "Frontend"
