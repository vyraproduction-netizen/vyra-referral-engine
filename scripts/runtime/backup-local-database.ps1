param(
    [string]$DatabaseContainer = "supabase_db_vyra-local-permanent",
    [string]$BackupRoot = "C:\VYRA-BACKUPS\vyra-local"
)

$ErrorActionPreference = "Stop"

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = Join-Path `
    $BackupRoot `
    "vyra-local-$timestamp.dump"

$dumpInContainer = "/tmp/vyra-local-$timestamp.dump"
$verifyInContainer = "/tmp/vyra-local-verify-$timestamp.dump"

New-Item `
    -ItemType Directory `
    -Path $BackupRoot `
    -Force |
    Out-Null

try {
    & docker exec `
        $DatabaseContainer `
        pg_dump `
        -U postgres `
        -d postgres `
        -Fc `
        -f $dumpInContainer

    if ($LASTEXITCODE -ne 0) {
        throw "Local database backup failed"
    }

    & docker cp `
        "${DatabaseContainer}:$dumpInContainer" `
        $backupFile

    if ($LASTEXITCODE -ne 0) {
        throw "Copying the backup from Docker failed"
    }

    & docker cp `
        $backupFile `
        "${DatabaseContainer}:$verifyInContainer"

    if ($LASTEXITCODE -ne 0) {
        throw "Copying the backup back into Docker failed"
    }

    & docker exec `
        $DatabaseContainer `
        pg_restore `
        -l `
        $verifyInContainer |
        Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw "Backup verification with pg_restore failed"
    }

    $hash = (
        Get-FileHash `
            -LiteralPath $backupFile `
            -Algorithm SHA256
    ).Hash

    $hashFile = "$backupFile.sha256"

    "$hash  $(Split-Path -Path $backupFile -Leaf)" |
        Set-Content `
            -LiteralPath $hashFile `
            -Encoding ascii

    Write-Host "[PASS] Backup created: $backupFile"
    Write-Host "[PASS] Restore structure verified with pg_restore"
    Write-Host "[PASS] SHA256 file created: $hashFile"
}
finally {
    & docker exec `
        $DatabaseContainer `
        rm `
        -f `
        $dumpInContainer `
        $verifyInContainer |
        Out-Null
}