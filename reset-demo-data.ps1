# Wipes the local demo database and reseeds it on the next gateway start:
# fresh 90-day history, original policy v1, no leftover rehearsal apps or
# policy versions. Run before an important demo, then start-demo.ps1.
$root = $PSScriptRoot
& "$root\stop-demo.ps1"
docker compose -f "$root\deploy\compose\docker-compose.dev.yml" down -v
docker compose -f "$root\deploy\compose\docker-compose.dev.yml" up -d --wait
docker exec sf-postgres-dev psql -U sf -d sovereignfabric -c "create database sovereignfabric_test" | Out-Null
Write-Host "Demo data reset. Run .\start-demo.ps1 to start with a fresh seed." -ForegroundColor Green
