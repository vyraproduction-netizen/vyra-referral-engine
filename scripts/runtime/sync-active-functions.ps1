param(
    [string]$ProjectRoot = "C:\VYRA-GITHUB",
    [string]$DatabaseContainer = "supabase_db_vyra-local-permanent",
    [switch]$Apply
)

$ErrorActionPreference = "Stop"

$sourceRoot = Join-Path $ProjectRoot "supabase\functions"

# Это фактическая папка, подключённая к постоянному локальному Edge Runtime.
$runtimeRoot = "C:\VYRA-LOCAL\supabase\functions"

if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    throw "Git functions directory was not found: $sourceRoot"
}

if (-not (Test-Path -LiteralPath $runtimeRoot -PathType Container)) {
    throw "Active Runtime functions directory was not found: $runtimeRoot"
}

$mismatches = @()

Get-ChildItem `
    -LiteralPath $sourceRoot `
    -Recurse `
    -File `
    -Filter "*.ts" |
    ForEach-Object {
        $sourceFile = $_
        $relativePath = $sourceFile.FullName.Substring(
            $sourceRoot.Length
        ).TrimStart('\')

        $runtimeFile = Join-Path `
            $runtimeRoot `
            $relativePath

        $different = -not (
            Test-Path -LiteralPath $runtimeFile -PathType Leaf
        )

        if (-not $different) {
            $sourceHash = (
                Get-FileHash `
                    -LiteralPath $sourceFile.FullName `
                    -Algorithm SHA256
            ).Hash

            $runtimeHash = (
                Get-FileHash `
                    -LiteralPath $runtimeFile `
                    -Algorithm SHA256
            ).Hash

            $different = $sourceHash -ne $runtimeHash
        }

        if ($different) {
            $mismatches += [PSCustomObject]@{
                RelativePath = $relativePath
                SourceFile   = $sourceFile.FullName
                RuntimeFile  = $runtimeFile
            }
        }
    }

Write-Host "Git functions:     $sourceRoot"
Write-Host "Runtime functions: $runtimeRoot"

if ($mismatches.Count -eq 0) {
    Write-Host "[PASS] Active Edge Runtime sources already match Git worktree"
    exit 0
}

Write-Host (
    "[INFO] Files requiring synchronization: " +
    $mismatches.Count
)

$mismatches |
    ForEach-Object {
        Write-Host " - $($_.RelativePath)"
    }

if (-not $Apply) {
    throw (
        "No files were changed. Review the list, then run again with -Apply"
    )
}

foreach ($mismatch in $mismatches) {
    $destinationDirectory = Split-Path `
        -Path $mismatch.RuntimeFile `
        -Parent

    New-Item `
        -ItemType Directory `
        -Path $destinationDirectory `
        -Force |
        Out-Null

    Copy-Item `
        -LiteralPath $mismatch.SourceFile `
        -Destination $mismatch.RuntimeFile `
        -Force
}

Write-Host "[PASS] Changed TypeScript function files synchronized"

& $PSCommandPath `
    -ProjectRoot $ProjectRoot `
    -DatabaseContainer $DatabaseContainer