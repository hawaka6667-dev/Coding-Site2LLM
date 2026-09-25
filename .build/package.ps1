<#
Creates the current version's CRX and ZIP in .build/dist/.
The stable signing key lives only in ignored .build/secrets/.
#>
param(
    [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -Path (Join-Path $projectRoot "manifest.json") | ConvertFrom-Json
$version = $manifest.version
$keyDirectory = Join-Path $PSScriptRoot "secrets"
$keyPath = Join-Path $keyDirectory "coding-site2llm.pem"
$outputDirectory = if ($OutputDirectory) {
    [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
    Join-Path $PSScriptRoot "dist"
}
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
    "icons",
    "options",
    "popup",
    "worker"
)

New-Item -ItemType Directory -Force -Path $extensionRoot, $keyDirectory, $outputDirectory | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $outputDirectory "Coding-Site2LLM-*.crx")
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $outputDirectory "Coding-Site2LLM-*.zip")

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
        if (-not (Test-Path $generatedKey)) {
            throw "Chrome did not create a signing key."
        }
        Move-Item -Force $generatedKey $keyPath
    }

    $releaseBaseName = "Coding-Site2LLM-v$version"
    $crxPath = Join-Path $outputDirectory "$releaseBaseName.crx"
    $zipPath = Join-Path $outputDirectory "$releaseBaseName.zip"
    Copy-Item -Force $generatedCrx $crxPath
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