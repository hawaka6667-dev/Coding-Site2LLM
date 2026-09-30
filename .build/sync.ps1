param(
    [string]$Message = "Sync changes"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

& git pull --rebase --autostash
if ($LASTEXITCODE -ne 0) {
    throw "Git pull --rebase failed."
}

& git add -A
if ($LASTEXITCODE -ne 0) {
    throw "Failed to stage working tree changes."
}

& git diff --cached --quiet
$stagedChanges = $LASTEXITCODE -eq 1
if ($LASTEXITCODE -gt 1) {
    throw "Failed to inspect staged changes."
}

if ($stagedChanges) {
    & git commit -m $Message
    if ($LASTEXITCODE -ne 0) {
        throw "Git commit failed."
    }
}

& git push
if ($LASTEXITCODE -ne 0) {
    throw "Git push failed."
}

Write-Host "Sync complete."