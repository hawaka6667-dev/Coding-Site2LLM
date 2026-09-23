<#
Build artifact management:
- This file is the only packaging entry point.
- The manifest version selects the output directory: .build/v<version>/.
- Each version directory owns its CRX, ZIP, and PEM signing key.
- The extension staging directory lives in the system TEMP directory and is
    removed after packaging; no extension staging files remain in the project.
#>
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $projectRoot "manifest.json"
$manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
$version = $manifest.version

$releaseRoot = Join-Path $PSScriptRoot "v$version"
$keyPath = Join-Path $releaseRoot "coding-site2llm.pem"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "coding-site2llm-$version-$PID"
$extensionRoot = Join-Path $tempRoot "extension"
$chromeCandidates = @(
    (Join-Path ${env:ProgramFiles} "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
)

$chromePath = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chromePath) {
    throw "Chrome executable was not found."
}

$filesToCopy = @(
    "manifest.json",
    "background.js",
    "content.js",
    "icons",
    "options",
    "popup",
    "worker"
)

New-Item -ItemType Directory -Force -Path $extensionRoot, $releaseRoot | Out-Null
try {
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
        throw "Chrome did not create the expected CRX."
    }
    if (-not (Test-Path $keyPath)) {
        $generatedKey = "$extensionRoot.pem"
        if (Test-Path $generatedKey) {
            Move-Item -Force $generatedKey $keyPath
        }
    }

    $releaseBaseName = "Coding-Site2LLM-v$version"
    $crxPath = Join-Path $releaseRoot "$releaseBaseName.crx"
    $zipPath = Join-Path $releaseRoot "$releaseBaseName.zip"
    Copy-Item -Force $generatedCrx $crxPath
    if (Test-Path $zipPath) {
        Remove-Item -Force $zipPath
    }
    Compress-Archive -Path (Join-Path $extensionRoot "*") -DestinationPath $zipPath

    Write-Host "CRX created: $crxPath"
    Write-Host "ZIP created: $zipPath"
    Write-Host "Signing key: $keyPath"
}
finally {
    if (Test-Path $tempRoot) {
        Remove-Item -Recurse -Force $tempRoot
    }
}