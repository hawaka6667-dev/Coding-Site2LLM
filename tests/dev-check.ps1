# @machine
# file: tests/dev-check.ps1
# role: block development until repository and browser prerequisites are ready
# contract: fail fast with a reason; does not start the development server

param(
    [string]$McpSnapshot = $env:CHROME_DEVTOOLS_MCP_SNAPSHOT,
    [string]$ExtensionId = $env:CODING_SITE2LLM_EXTENSION_ID,
    [int]$SnapshotMaxAgeSeconds = 300
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Fail-Check([string]$reason) {
    Write-Host "FAIL: $reason" -ForegroundColor Red
    exit 1
}

function Pass-Check([string]$message) {
    Write-Host "PASS: $message" -ForegroundColor Green
}

function Require-Check([bool]$condition, [string]$reason) {
    if (-not $condition) {
        Fail-Check $reason
    }
}

Write-Host "Coding Site2LLM development preflight"

try {
    $packageJson = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json
    $manifest = Get-Content -LiteralPath (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
} catch {
    Fail-Check "package.json or manifest.json is missing or invalid: $($_.Exception.Message)"
}

$requiredFiles = @(
    "background.js",
    "content.js",
    "popup/popup.html",
    "popup/popup.js",
    "options/options.html",
    "options/options.js",
    "worker/llm_copy_tracker.js",
    "worker/configure_supported_coding_sites_and_llm_providers.js",
    "worker/exercism/open_exercise_in_editor.js",
    "worker/exercism/auto_mark_exercise_complete.js",
    "worker/exercism/auto_submit_after_manual_run.js",
    "tests/dev-check.ps1",
    "tests/session-end.ps1",
    "tests/version-contract.test.js",
    "tests/chrome-mcp-snapshot.example.json"
)

foreach ($file in $requiredFiles) {
    Require-Check (Test-Path -LiteralPath (Join-Path $root $file) -PathType Leaf) `
        "Required development file is missing: $file"
}

foreach ($scriptName in @("test:unit", "test:routing", "test:contracts", "test:version", "dev:check")) {
    Require-Check (-not [string]::IsNullOrWhiteSpace($packageJson.scripts.$scriptName)) `
        "Required npm script is missing: $scriptName"
}

Require-Check ($manifest.background.service_worker -eq "background.js") `
    "Manifest background service worker must be background.js."
Pass-Check "Repository entry points and manifest are valid"

$chrome = Get-Process -Name chrome -ErrorAction SilentlyContinue | Select-Object -First 1
Require-Check ($null -ne $chrome) "Chrome is not running. Start Chrome before development."
Pass-Check "Chrome is running"

Require-Check (-not [string]::IsNullOrWhiteSpace($McpSnapshot)) `
    "Chrome DevTools MCP snapshot is missing. Export a current MCP page snapshot and set CHROME_DEVTOOLS_MCP_SNAPSHOT."
Require-Check (Test-Path -LiteralPath $McpSnapshot -PathType Leaf) `
    "Chrome DevTools MCP snapshot does not exist: $McpSnapshot"

try {
    $snapshot = Get-Content -LiteralPath $McpSnapshot -Raw | ConvertFrom-Json
} catch {
    Fail-Check "Chrome DevTools MCP snapshot is not valid JSON: $McpSnapshot"
}

Require-Check ($snapshot.mcpConnected -eq $true) `
    "Chrome DevTools MCP is not marked connected in the snapshot."

$connectedAt = $null
try {
    $connectedAt = [DateTimeOffset]::Parse($snapshot.connectedAt)
} catch {
    Fail-Check "Chrome DevTools MCP snapshot has no valid connectedAt timestamp."
}

$age = ([DateTimeOffset]::UtcNow - $connectedAt.ToUniversalTime()).TotalSeconds
Require-Check ($age -ge -30 -and $age -le $SnapshotMaxAgeSeconds) `
    "Chrome DevTools MCP snapshot is stale ($([math]::Round($age)) seconds old)."
Pass-Check "Chrome DevTools MCP is connected and the snapshot is fresh"

$pages = @($snapshot.pages)
$serviceWorkers = @($snapshot.extensionServiceWorkers)

if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
    $worker = $serviceWorkers |
        Where-Object { $_.url -match '^chrome-extension://[^/]+/background\.js$' } |
        Select-Object -First 1
} else {
    $worker = $serviceWorkers |
        Where-Object { $_.url -eq "chrome-extension://$ExtensionId/background.js" } |
        Select-Object -First 1
}

Require-Check ($null -ne $worker) `
    "Coding Site2LLM Extension Service Worker is not visible in the MCP snapshot. Reload the unpacked extension and refresh the snapshot."
Pass-Check "Extension Service Worker is visible"

$requiredPagePatterns = @(
    '^https://exercism\.org/tracks/[^/]+/exercises/[^/]+/edit(?:[/?#]|$)',
    '^https://chat\.deepseek\.com/'
)

foreach ($pattern in $requiredPagePatterns) {
    $page = $pages | Where-Object { $_.url -match $pattern } | Select-Object -First 1
    Require-Check ($null -ne $page) "Required test page is missing for pattern: $pattern"
}
Pass-Check "Required coding and LLM test pages are open"
Write-Host "PASS: development may start" -ForegroundColor Green