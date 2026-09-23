$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $projectRoot "manifest.json"
$manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
$version = $manifest.version

$stagingRoot = Join-Path $projectRoot ".build"
$extensionRoot = Join-Path $stagingRoot "extension"
$keyRoot = Join-Path $projectRoot ".keys"
$keyPath = Join-Path $keyRoot "coding-site2llm.pem"
$releaseRoot = Join-Path $projectRoot "release"
$chromeCandidates = @(
    (Join-Path ${env:ProgramFiles} "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
)

$chromePath = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chromePath) {
    throw "Chrome executable was not found. Install Chrome or update build/package-crx.ps1."
}

New-Item -ItemType Directory -Force -Path $extensionRoot, $keyRoot, $releaseRoot | Out-Null
if (Test-Path $extensionRoot) {
    Remove-Item -Recurse -Force $extensionRoot
}
New-Item -ItemType Directory -Force -Path $extensionRoot | Out-Null

$filesToCopy = @(
    "manifest.json",
    "background.js",
    "content.js",
    "icons",
    "options",
    "popup",
    "worker"
)
foreach ($item in $filesToCopy) {
    Copy-Item -Recurse -Force (Join-Path $projectRoot $item) $extensionRoot
}

$chromeArguments = @("--pack-extension=$extensionRoot")
if (Test-Path $keyPath) {
    $chromeArguments += "--pack-extension-key=$keyPath"
}

& $chromePath @chromeArguments
$generatedCrx = "$extensionRoot.crx"
$waitAttempts = 0
while (-not (Test-Path $generatedCrx) -and $waitAttempts -lt 20) {
    Start-Sleep -Milliseconds 250
    $waitAttempts++
}

if (-not (Test-Path $generatedCrx)) {
    throw "Chrome did not create the expected CRX at $generatedCrx."
}
if (-not (Test-Path $keyPath)) {
    $generatedKey = "$extensionRoot.pem"
    if (Test-Path $generatedKey) {
        Move-Item -Force $generatedKey $keyPath
    }
}

$releasePath = Join-Path $releaseRoot "Coding-Site2LLM-v$version.crx"
Copy-Item -Force $generatedCrx $releasePath
Remove-Item -Force $generatedCrx

Write-Host "CRX created: $releasePath"
Write-Host "Signing key: $keyPath"