# @machine
# when end run this
# file: tests/session-end.ps1
# role: finish a development session by reloading the extension and refreshing pages
# contract: reload must be provided by an external Chrome/MCP bridge; never claim success without it

param(
    [string]$McpSnapshot = $env:CHROME_DEVTOOLS_MCP_SNAPSHOT,
    [string]$ReloadCommand = $env:CODING_SITE2LLM_RELOAD_COMMAND,
    [string]$RefreshCommand = $env:CODING_SITE2LLM_REFRESH_COMMAND
)

$ErrorActionPreference = "Stop"
$snapshot = $null
if ([string]::IsNullOrWhiteSpace($McpSnapshot) -or -not (Test-Path -LiteralPath $McpSnapshot -PathType Leaf)) {
    throw "先去开 MCP"
}

try {
    $snapshot = Get-Content -LiteralPath $McpSnapshot -Raw | ConvertFrom-Json
    $connectedAt = [DateTimeOffset]::Parse($snapshot.connectedAt)
} catch {
    throw "先去开 MCP"
}

$snapshotAge = ([DateTimeOffset]::UtcNow - $connectedAt.ToUniversalTime()).TotalSeconds
if ($snapshot.mcpConnected -ne $true -or $snapshotAge -lt -30 -or $snapshotAge -gt 300) {
    throw "先去开 MCP"
}

$root = Split-Path -Parent $PSScriptRoot

function Fail-Session([string]$reason) {
    Write-Host "FAIL: $reason" -ForegroundColor Red
    exit 1
}

function Pass-Session([string]$message) {
    Write-Host "PASS: $message" -ForegroundColor Green
}

Push-Location $root
try {
    Write-Host "Coding Site2LLM session end"

    if ([string]::IsNullOrWhiteSpace($ReloadCommand)) {
        Fail-Session "Extension reload command is not configured. Set CODING_SITE2LLM_RELOAD_COMMAND to an external Chrome/MCP bridge command."
    }

    if ([string]::IsNullOrWhiteSpace($RefreshCommand)) {
        Fail-Session "Page refresh command is not configured. Set CODING_SITE2LLM_REFRESH_COMMAND to an external Chrome/MCP bridge command."
    }

    Write-Host "Reloading extension through configured bridge..."
    & $ReloadCommand
    if ($LASTEXITCODE -ne 0) {
        Fail-Session "Extension reload command failed with exit code $LASTEXITCODE."
    }

    Pass-Session "Extension reload command completed"

    Write-Host "Refreshing existing coding and LLM pages through configured bridge..."
    & $RefreshCommand
    if ($LASTEXITCODE -ne 0) {
        Fail-Session "Page refresh command failed with exit code $LASTEXITCODE."
    }

    Pass-Session "Existing coding and LLM pages refreshed"
} finally {
    Pop-Location
}