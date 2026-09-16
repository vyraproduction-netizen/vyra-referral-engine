param(
    [string]$DatabaseContainer = "supabase_db_vyra-local-permanent",
    [string]$BackupRoot = "C:\VYRA-BACKUPS\vyra-local"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-ContainerSql {
    param(
        [string]$DatabaseName,
        [string]$Sql
    )

    $result = & docker exec `
        $DatabaseContainer `
        psql `
        -U postgres `
        -d $DatabaseName `
        -v ON_ERROR_STOP=1 `
        -qAt `
        -c $Sql

    if ($LASTEXITCODE -ne 0) {
        throw "PostgreSQL query failed for database: $DatabaseName"
    }

    return (($result | Out-String).Trim())
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = Join-Path `
    $BackupRoot `
    "vyra-local-$timestamp.dump"

$dumpInContainer = "/tmp/vyra-local-$timestamp.dump"
$verifyInContainer = "/tmp/vyra-local-verify-$timestamp.dump"
$verifyDatabase = "vyra_restore_verify_$($timestamp.Replace('-', '_'))"

$stateSql = @"
select
  (select count(*) from public.agents) || '|' ||
  (select count(*) from public.jobs) || '|' ||
  (select count(*) from public.programs) || '|' ||
  (select count(*) from public.referral_links) || '|' ||
  (select count(*) from public.content) || '|' ||
  (select count(*) from public.vyra_cost_budget_policy) || '|' ||
  (select count(*) from public.vyra_cost_observations) || '|' ||
  (select count(*) from public.vyra_cost_reservations);
"@

New-Item `
    -ItemType Directory `
    -Path $BackupRoot `
    -Force |
    Out-Null

try {
    $sourceState = Invoke-ContainerSql `
        -DatabaseName "postgres" `
        -Sql $stateSql

    & docker exec `
        $DatabaseContainer `
        pg_dump `
        -U postgres `
        -d postgres `
		--schema=public `
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
        throw "Backup archive verification failed"
    }

    & docker exec `
        $DatabaseContainer `
        createdb `
        -U postgres `
        $verifyDatabase

    if ($LASTEXITCODE -ne 0) {
        throw "Creating the temporary restore database failed"
    }

    & docker exec `
        $DatabaseContainer `
        pg_restore `
        -U postgres `
        -d $verifyDatabase `
		--clean `
        --if-exists `
        --no-owner `
        --no-privileges `
        --exit-on-error `
        $verifyInContainer

    if ($LASTEXITCODE -ne 0) {
        throw "Restoring the backup into the temporary database failed"
    }

    $restoredState = Invoke-ContainerSql `
        -DatabaseName $verifyDatabase `
        -Sql $stateSql

    if ($restoredState -ne $sourceState) {
        throw (
            "Restored data does not match the source database. " +
            "Source: $sourceState; restored: $restoredState"
        )
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
    Write-Host "[PASS] Archive structure verified"
    Write-Host (
        "[PASS] Data restored and verified in temporary database: " +
        $verifyDatabase
    )
    Write-Host "[PASS] SHA256 file created: $hashFile"
}
finally {
    & docker exec `
        $DatabaseContainer `
        dropdb `
        -U postgres `
        --if-exists `
        $verifyDatabase |
        Out-Null

    & docker exec `
        $DatabaseContainer `
        rm `
        -f `
        $dumpInContainer `
        $verifyInContainer |
        Out-Null
}