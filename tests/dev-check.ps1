# @machine
# run this at start
# file: tests/dev-check.ps1
# role: check development prerequisites at startup or at any point during development
# contract: report whether the current environment is ready; never starts the development server

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $root "dist"

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
    $manifest = Get-Content -LiteralPath (Join-Path $distRoot "manifest.json") -Raw | ConvertFrom-Json
} catch {
    Fail-Check "package.json or dist/manifest.json is missing or invalid: $($_.Exception.Message)"
}

$distFiles = @(
    "manifest.json",
    "background.js",
    "worker/exercism/edit/content.js",
    "popup/popup.html",
    "popup/popup.js",
    "popup/daily_practice_providers.js",
    "options/options.html",
    "options/options.js",
    "worker/llm_copy_tracker.js",
    "worker/configure_supported_coding_sites_and_llm_providers.js",
    "worker/exercism/overview/open_exercise_in_editor.js",
    "worker/exercism/overview/auto_mark_exercise_complete.js",
    "worker/exercism/edit/auto_submit_after_manual_run.js"
)
$repositoryFiles = @(
    "tests/dev-check.ps1",
    "tests/session-end.ps1",
    "tests/version-contract.test.js"
)

foreach ($file in $distFiles) {
    Require-Check (Test-Path -LiteralPath (Join-Path $distRoot $file) -PathType Leaf) `
        "Required extension package file is missing: dist/$file"
}

foreach ($file in $repositoryFiles) {
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
Write-Host "For live browser state, use Chrome DevTools MCP list_pages."
Write-Host "PASS: development may start" -ForegroundColor Green