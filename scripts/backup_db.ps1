$env:PGPASSWORD = "01072545"

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = "backups\inventory_backup_$timestamp.sql"
$pgDump = "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"

& $pgDump `
-U postgres `
-h localhost `
-p 5432 `
inventory_db > $backupFile

if ($LASTEXITCODE -eq 0) {
    Write-Host "Backup completed: $backupFile"
} else {
    Write-Host "Backup failed"
}

Remove-Item Env:\PGPASSWORD