param(
    [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}

$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$script:PassCount = 0
$script:WarningCount = 0
$script:FailCount = 0

function Add-Result {
    param(
        [ValidateSet("PASS", "WARNING", "FAIL")]
        [string]$Level,
        [string]$Check,
        [string]$Detail
    )

    switch ($Level) {
        "PASS" {
            $script:PassCount++
            $color = "Green"
        }
        "WARNING" {
            $script:WarningCount++
            $color = "Yellow"
        }
        "FAIL" {
            $script:FailCount++
            $color = "Red"
        }
    }

    Write-Host ("[{0}] {1}: {2}" -f $Level, $Check, $Detail) -ForegroundColor $color
}

function Get-TrackedFiles {
    param([string]$Pattern)

    $arguments = @("ls-files")
    if ($Pattern) {
        $arguments += $Pattern
    }

    return @(& git @arguments 2>$null | Where-Object { $_ })
}

Write-Host "=== VYRA local validation ===" -ForegroundColor Cyan
Write-Host "ProjectRoot: $ProjectRoot"
Write-Host "Production access: DISABLED (static local checks only)"
Write-Host ""

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    Add-Result "FAIL" "Project root" "Directory not found"
    exit 1
}

Push-Location $ProjectRoot

try {
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        Add-Result "FAIL" "Git" "git command not found"
    }
    else {
        $insideWorkTree = [string](& git rev-parse --is-inside-work-tree 2>$null)
        if ($insideWorkTree.Trim() -eq "true") {
            Add-Result "PASS" "Git repository" "Valid work tree"

            $branch = [string](& git branch --show-current 2>$null)
            if ($branch.Trim()) {
                Add-Result "PASS" "Git branch" $branch.Trim()
            }
            else {
                Add-Result "WARNING" "Git branch" "Detached HEAD"
            }

            $status = @(& git status --short 2>$null)
            if ($status.Count -eq 0) {
                Add-Result "PASS" "Git status" "Clean"
            }
            else {
                Add-Result "WARNING" "Git status" ("{0} uncommitted item(s)" -f $status.Count)
            }
        }
        else {
            Add-Result "FAIL" "Git repository" "ProjectRoot is not a Git work tree"
        }
    }

    $requiredFiles = @(
        ".github/workflows/vyra-validation.yml",
        "scripts/runtime/watch-job.ps1",
		"scripts/runtime/test-local-runtime.ps1",
        "scripts/sql/queue-diagnostics.sql",
        "deno.lock",
        "supabase/config.toml",
        "supabase/functions/_shared/vyra/job-store.ts",
        "supabase/functions/_shared/vyra/supabase-job-store.ts",
        "supabase/functions/topic-scout/index.ts",
        "supabase/functions/research-worker/index.ts",
        "supabase/functions/content-worker/index.ts",
        "supabase/functions/qa-worker/index.ts",
        "supabase/functions/publisher-worker/index.ts",
        "supabase/functions/analytics-worker/index.ts",
        "supabase/functions/vyra-controller/index.ts",
        "supabase/functions/vyra-diagnostics/index.ts"
    )

    $missingRequired = @()
    foreach ($relativePath in $requiredFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $relativePath) -PathType Leaf)) {
            $missingRequired += $relativePath
        }
    }

    if ($missingRequired.Count -eq 0) {
        Add-Result "PASS" "Required files" ("{0} core files present" -f $requiredFiles.Count)
    }
    else {
        Add-Result "FAIL" "Required files" ("Missing: {0}" -f ($missingRequired -join ", "))
    }

    $workflowPath = Join-Path `
        $ProjectRoot `
        ".github/workflows/vyra-validation.yml"

    if (
        Test-Path `
        -LiteralPath $workflowPath `
        -PathType Leaf
    ) {
        $workflowText = Get-Content `
            -LiteralPath $workflowPath `
            -Raw

        $requiredWorkflowMarkers = @(
            "actions/checkout@v4",
            "actions/setup-node@v4",
            "scripts\validate-vyra.ps1",
            "contents: read"
        )

        $missingWorkflowMarkers = @(
            $requiredWorkflowMarkers |
            Where-Object {
                -not $workflowText.Contains($_)
            }
        )

        $forbiddenWorkflowPatterns = @(
            'supabase\s+functions\s+deploy',
            'supabase\s+db\s+push',
            'wrangler\s+deploy',
            'git\s+push'
        )

        $unsafeWorkflowPatterns = @(
            $forbiddenWorkflowPatterns |
            Where-Object {
                $workflowText -match $_
            }
        )

        if ($missingWorkflowMarkers.Count -gt 0) {
            Add-Result `
                "FAIL" `
                "CI workflow" `
                ("Missing marker(s): {0}" -f (
                    $missingWorkflowMarkers -join ", "
                ))
        }
        elseif ($unsafeWorkflowPatterns.Count -gt 0) {
            Add-Result `
                "FAIL" `
                "CI workflow" `
                "Deploy or push command detected"
        }
        else {
            Add-Result `
                "PASS" `
                "CI workflow" `
                "Read-only validation workflow detected"
        }
    }
    else {
        Add-Result `
            "FAIL" `
            "CI workflow" `
            "Workflow file not found"
    }

    $watchJobPath = Join-Path `
        $ProjectRoot `
        "scripts/runtime/watch-job.ps1"

    if (
        Test-Path `
        -LiteralPath $watchJobPath `
        -PathType Leaf
    ) {
        $watchTokens = $null
        $watchParseErrors = $null

        [System.Management.Automation.Language.Parser]::ParseFile(
            $watchJobPath,
            [ref]$watchTokens,
            [ref]$watchParseErrors
        ) | Out-Null

        $watchText = Get-Content `
            -LiteralPath $watchJobPath `
            -Raw

        $requiredWatchMarkers = @(
            '127.0.0.1',
            '[switch]$AllowRemote',
            '-Method Get',
            'Remote Supabase access is blocked'
        )

        $missingWatchMarkers = @(
            $requiredWatchMarkers |
            Where-Object {
                -not $watchText.Contains($_)
            }
        )

        $unsafeWatchMethod = (
            $watchText -match
            '(?i)-Method\s+(Post|Put|Patch|Delete)'
        )

        if ($watchParseErrors.Count -gt 0) {
            Add-Result `
                "FAIL" `
                "Job watcher" `
                "PowerShell syntax error"
        }
        elseif ($missingWatchMarkers.Count -gt 0) {
            Add-Result `
                "FAIL" `
                "Job watcher" `
                ("Missing safety marker(s): {0}" -f (
                    $missingWatchMarkers -join ", "
                ))
        }
        elseif ($unsafeWatchMethod) {
            Add-Result `
                "FAIL" `
                "Job watcher" `
                "Mutating HTTP method detected"
        }
        else {
            Add-Result `
                "PASS" `
                "Job watcher" `
                "Local-first read-only watcher detected"
        }
    }
    else {
        Add-Result `
            "FAIL" `
            "Job watcher" `
            "watch-job.ps1 not found"
    }

    $runtimeTestPath = Join-Path `
        $ProjectRoot `
        "scripts/runtime/test-local-runtime.ps1"

    if (
        Test-Path `
        -LiteralPath $runtimeTestPath `
        -PathType Leaf
    ) {
        $runtimeTokens = $null
        $runtimeParseErrors = $null

        [System.Management.Automation.Language.Parser]::ParseFile(
            $runtimeTestPath,
            [ref]$runtimeTokens,
            [ref]$runtimeParseErrors
        ) | Out-Null

        $runtimeText = Get-Content `
            -LiteralPath $runtimeTestPath `
            -Raw

        $requiredRuntimeMarkers = @(
            "Production access: DISABLED",
            "Only a local HTTP Supabase URL is allowed",
            '$allowedHosts',
            "127.0.0.1",
            "finally",
            "payload->>'request_id'"
        )

        $missingRuntimeMarkers = @(
            $requiredRuntimeMarkers |
                Where-Object {
                    $runtimeText -notmatch [regex]::Escape($_)
                }
        )

        if ($runtimeParseErrors.Count -gt 0) {
            Add-Result `
                "FAIL" `
                "Runtime test" `
                "PowerShell syntax error"
        }
        elseif ($missingRuntimeMarkers.Count -gt 0) {
            Add-Result `
                "FAIL" `
                "Runtime test" `
                ("Missing safety marker(s): {0}" -f (
                    $missingRuntimeMarkers -join ", "
                ))
        }
        else {
            Add-Result `
                "PASS" `
                "Runtime test" `
                "Local-only test with cleanup detected"
        }
    }
    else {
        Add-Result `
            "FAIL" `
            "Runtime test" `
            "test-local-runtime.ps1 not found"
    }

    $queueSqlPath = Join-Path `
        $ProjectRoot `
        "scripts/sql/queue-diagnostics.sql"

    if (
        Test-Path `
        -LiteralPath $queueSqlPath `
        -PathType Leaf
    ) {
        $queueSqlText = Get-Content `
            -LiteralPath $queueSqlPath `
            -Raw

        $hasReadOnlyTransaction = (
            $queueSqlText -match
            '(?im)^\s*begin\s+transaction\s+read\s+only\s*;'
        )

        $hasRollback = (
            $queueSqlText -match
            '(?im)^\s*rollback\s*;'
        )

        $hasMutatingSql = (
            $queueSqlText -match
            '(?im)^\s*(insert|update|delete|truncate|drop|alter|create|grant|revoke|call)\b'
        )

        if (-not $hasReadOnlyTransaction) {
            Add-Result `
                "FAIL" `
                "Queue SQL" `
                "READ ONLY transaction missing"
        }
        elseif (-not $hasRollback) {
            Add-Result `
                "FAIL" `
                "Queue SQL" `
                "ROLLBACK missing"
        }
        elseif ($hasMutatingSql) {
            Add-Result `
                "FAIL" `
                "Queue SQL" `
                "Mutating SQL statement detected"
        }
        else {
            Add-Result `
                "PASS" `
                "Queue SQL" `
                "Read-only diagnostic SQL detected"
        }
    }
    else {
        Add-Result `
            "FAIL" `
            "Queue SQL" `
            "queue-diagnostics.sql not found"
    }

    $configPath = Join-Path $ProjectRoot "supabase/config.toml"
    $activeEntrypoints = @()

    if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        $configText = Get-Content -LiteralPath $configPath -Raw
        $sections = [regex]::Matches(
            $configText,
            '(?ms)^\[functions\.([^\]]+)\]\s*(.*?)(?=^\[|\z)'
        )

        foreach ($section in $sections) {
            $functionName = $section.Groups[1].Value.Trim()
            $body = $section.Groups[2].Value
            $enabledMatch = [regex]::Match($body, '(?m)^enabled\s*=\s*(true|false)\s*$')
            $entrypointMatch = [regex]::Match($body, '(?m)^entrypoint\s*=\s*["'']([^"'']+)["'']\s*$')

            $enabled = $enabledMatch.Success -and $enabledMatch.Groups[1].Value -eq "true"
            if (-not $enabled) {
                continue
            }

            if ($functionName -match '(?i)test') {
                Add-Result "FAIL" "Function config" ("Test function enabled: {0}" -f $functionName)
                continue
            }

            if (-not $entrypointMatch.Success) {
                Add-Result "FAIL" "Function config" ("Enabled function has no entrypoint: {0}" -f $functionName)
                continue
            }

            $entrypoint = $entrypointMatch.Groups[1].Value -replace '^\./', ''
            $entrypointPath = Join-Path (Join-Path $ProjectRoot "supabase") $entrypoint

            if (Test-Path -LiteralPath $entrypointPath -PathType Leaf) {
                $activeEntrypoints += $entrypointPath
            }
            else {
                Add-Result "FAIL" "Function config" ("Missing entrypoint for {0}: {1}" -f $functionName, $entrypoint)
            }
        }

        if ($activeEntrypoints.Count -gt 0) {
            Add-Result "PASS" "Function config" ("{0} active entrypoint(s) resolved" -f $activeEntrypoints.Count)
        }
        else {
            Add-Result "FAIL" "Function config" "No active function entrypoints resolved"
        }
    }
    else {
        Add-Result "FAIL" "Function config" "supabase/config.toml not found"
    }

    $trackedTypeScript = @()
    if ($git) {
        $trackedTypeScript = @(Get-TrackedFiles "*.ts")
    }

    if ($trackedTypeScript.Count -eq 0) {
        Add-Result "FAIL" "TypeScript inventory" "No tracked TypeScript files found"
    }
    else {
        Add-Result "PASS" "TypeScript inventory" ("{0} tracked TypeScript file(s)" -f $trackedTypeScript.Count)

        $npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
        $lockPath = Join-Path $ProjectRoot "deno.lock"

        if (-not $npx) {
            Add-Result "FAIL" "Deno check" "npx.cmd not found"
        }
        elseif (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
            Add-Result "FAIL" "Deno lock" "deno.lock not found"
        }
        else {
            $absoluteTypeScript = @(
                $trackedTypeScript | ForEach-Object { Join-Path $ProjectRoot $_ }
            )

            Write-Host "Running Deno frozen type-check..." -ForegroundColor DarkCyan
            $denoArguments = @(
                "--yes",
                "deno",
                "check",
                "--lock=$lockPath",
                "--frozen-lockfile"
            ) + $absoluteTypeScript

            & $npx.Source @denoArguments
            if ($LASTEXITCODE -eq 0) {
                Add-Result "PASS" "Deno check" "All tracked TypeScript files passed with frozen lockfile"
            }
            else {
                Add-Result "FAIL" "Deno check" ("Exit code {0}" -f $LASTEXITCODE)
            }
        }
    }

    $trackedUnitTests = @(
        $trackedTypeScript |
        Where-Object {
            $_ -match '(?i)-test\.ts$'
        }
    )

    if ($trackedUnitTests.Count -eq 0) {
        Add-Result "WARNING" "Unit tests" "No tracked *-test.ts files found"
    }
    else {
        $testNpx = Get-Command npx.cmd -ErrorAction SilentlyContinue
        $testLockPath = Join-Path $ProjectRoot "deno.lock"

        if (-not $testNpx) {
            Add-Result "FAIL" "Unit tests" "npx.cmd not found"
        }
        elseif (
            -not (
                Test-Path `
                -LiteralPath $testLockPath `
                -PathType Leaf
            )
        ) {
            Add-Result "FAIL" "Unit tests" "deno.lock not found"
        }
        else {
            $absoluteUnitTests = @(
                $trackedUnitTests |
                ForEach-Object {
                    Join-Path $ProjectRoot $_
                }
            )

            Write-Host "Running Deno unit tests..." -ForegroundColor DarkCyan

            $testArguments = @(
                "--yes",
                "deno",
                "test",
                "--lock=$testLockPath",
                "--frozen-lockfile"
            ) + $absoluteUnitTests

            & $testNpx.Source @testArguments

            if ($LASTEXITCODE -eq 0) {
                Add-Result `
                    "PASS" `
                    "Unit tests" `
                    ("{0} test file(s) passed" -f $trackedUnitTests.Count)
            }
            else {
                Add-Result `
                    "FAIL" `
                    "Unit tests" `
                    ("Exit code {0}" -f $LASTEXITCODE)
            }
        }
    }

    $trackedTextFiles = @()
    if ($git) {
        $trackedTextFiles = @(
            Get-TrackedFiles | Where-Object {
                $_ -match '\.(ts|js|json|toml|md|ps1|sql|yml|yaml|txt|example)$'
            }
        )
    }

    $secretPatterns = @(
        'sb_secret_[A-Za-z0-9_-]{20,}',
        'tvly-[A-Za-z0-9_-]{20,}',
        'sk-[A-Za-z0-9_-]{20,}',
        'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}'
    )
    $secretHits = @()

    foreach ($relativePath in $trackedTextFiles) {
        $fullPath = Join-Path $ProjectRoot $relativePath
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            continue
        }

        $text = Get-Content -LiteralPath $fullPath -Raw
        foreach ($pattern in $secretPatterns) {
            if ($text -match $pattern) {
                $secretHits += $relativePath
                break
            }
        }
    }

    if ($secretHits.Count -eq 0) {
        Add-Result "PASS" "Secret scan" "No secret-like values found in tracked text files"
    }
    else {
        Add-Result "FAIL" "Secret scan" ("Potential secret value(s) in: {0}" -f (($secretHits | Sort-Object -Unique) -join ", "))
    }

    $productionTypeScript = @(
        $trackedTypeScript | Where-Object { $_ -notmatch '(?i)(^|[-_/])test([._/-]|$)' }
    )
    $forbiddenMarkers = @(
        "job-inserter-test",
        "34.4.7.7 full claim-complete test",
        "test: true",
        "createResearchJobClient"
    )
    $markerHits = @()

    foreach ($relativePath in $productionTypeScript) {
        $fullPath = Join-Path $ProjectRoot $relativePath
        $text = Get-Content -LiteralPath $fullPath -Raw
        foreach ($marker in $forbiddenMarkers) {
            if ($text.Contains($marker)) {
                $markerHits += ("{0} -> {1}" -f $relativePath, $marker)
            }
        }
    }

    if ($markerHits.Count -eq 0) {
        Add-Result "PASS" "Forbidden markers" "No obsolete production markers found"
    }
    else {
        Add-Result "FAIL" "Forbidden markers" ($markerHits -join "; ")
    }

    $rpcNames = @("claim_next_job", "complete_job", "retry_job")
    $allTypeScriptText = ""
    foreach ($relativePath in $trackedTypeScript) {
        $fullPath = Join-Path $ProjectRoot $relativePath
        if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
            $allTypeScriptText += "`n" + (Get-Content -LiteralPath $fullPath -Raw)
        }
    }

    $missingRpc = @($rpcNames | Where-Object { $allTypeScriptText -notmatch [regex]::Escape($_) })
    if ($missingRpc.Count -eq 0) {
        Add-Result "PASS" "RPC contracts" ("Required RPC names present: {0}" -f ($rpcNames -join ", "))
    }
    else {
        Add-Result "FAIL" "RPC contracts" ("Missing RPC reference(s): {0}" -f ($missingRpc -join ", "))
    }

    $envNames = New-Object System.Collections.Generic.HashSet[string]
    foreach ($relativePath in $trackedTypeScript) {
        $fullPath = Join-Path $ProjectRoot $relativePath
        $text = Get-Content -LiteralPath $fullPath -Raw
        $matches = [regex]::Matches($text, 'Deno\.env\.get\(["'']([^"'']+)["'']\)')
        foreach ($match in $matches) {
            [void]$envNames.Add($match.Groups[1].Value)
        }
    }

    if ($envNames.Count -gt 0) {
        Add-Result "PASS" "Environment contract" ("Detected names only: {0}" -f ((@($envNames) | Sort-Object) -join ", "))
    }
    else {
        Add-Result "WARNING" "Environment contract" "No Deno.env.get names detected"
    }

    $unpinnedImports = @()
    foreach ($relativePath in $trackedTypeScript) {
        $fullPath = Join-Path $ProjectRoot $relativePath
        $hits = Select-String -LiteralPath $fullPath -Pattern 'from\s+["''](?:npm|jsr):[^"'']+@\^?\d+["'']' -AllMatches
        if ($hits) {
            $unpinnedImports += $relativePath
        }
    }

    if ($unpinnedImports.Count -eq 0) {
        Add-Result "PASS" "Dependency pins" "No obvious major-only imports detected"
    }
    else {
        Add-Result "WARNING" "Dependency pins" ("Review major-only import(s) in: {0}" -f (($unpinnedImports | Sort-Object -Unique) -join ", "))
    }
}
catch {
    Add-Result "FAIL" "Validator exception" $_.Exception.Message
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "=== VYRA validation summary ===" -ForegroundColor Cyan
Write-Host ("PASS: {0}" -f $script:PassCount) -ForegroundColor Green
Write-Host ("WARNING: {0}" -f $script:WarningCount) -ForegroundColor Yellow
Write-Host ("FAIL: {0}" -f $script:FailCount) -ForegroundColor Red

if ($script:FailCount -gt 0) {
    Write-Host "RESULT: FAIL" -ForegroundColor Red
    exit 1
}

if ($script:WarningCount -gt 0) {
    Write-Host "RESULT: WARNING" -ForegroundColor Yellow
    exit 0
}

Write-Host "RESULT: PASS" -ForegroundColor Green
exit 0
