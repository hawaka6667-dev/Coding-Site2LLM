# @machine
# file: tests/session-end.ps1
# role: finish a development session by validating code and invoking extension reload
# contract: reload must be provided by an external Chrome/MCP bridge; never claim success without it

param(
    [string]$ReloadCommand = $env:CODING_SITE2LLM_RELOAD_COMMAND
)

$ErrorActionPreference = "Stop"
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

    & npm run test:all
    if ($LASTEXITCODE -ne 0) {
        Fail-Session "Tests failed with exit code $LASTEXITCODE. Extension reload was skipped."
    }
    Pass-Session "All code tests passed"

    if ([string]::IsNullOrWhiteSpace($ReloadCommand)) {
        Fail-Session "Extension reload command is not configured. Set CODING_SITE2LLM_RELOAD_COMMAND to an external Chrome/MCP bridge command."
    }

    Write-Host "Reloading extension through configured bridge..."
    & $ReloadCommand
    if ($LASTEXITCODE -ne 0) {
        Fail-Session "Extension reload command failed with exit code $LASTEXITCODE."
    }

    Pass-Session "Extension reload command completed"
    Write-Host "NEXT: refresh existing coding and LLM pages before browser verification."
} finally {
    Pop-Location
}