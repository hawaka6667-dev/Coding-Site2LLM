<#
Creates the current version's CRX and ZIP in .build/.
The stable signing key lives only in ignored .build/.
#>
param(
    [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $projectRoot "dist"
$manifest = Get-Content -Raw -Path (Join-Path $distRoot "manifest.json") | ConvertFrom-Json
$version = $manifest.version
$keyPath = Join-Path $PSScriptRoot "coding-site2llm.pem"
$outputDirectory = if ($OutputDirectory) {
    [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
    $PSScriptRoot
}
$generatedCrx = "$distRoot.crx"
$generatedKey = "$distRoot.pem"
$chromeCandidates = @(
    (Join-Path ${env:ProgramFiles} "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
)
$chromePath = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chromePath) {
    throw "Chrome executable was not found."
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $outputDirectory "Coding-Site2LLM-*.crx")
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $outputDirectory "Coding-Site2LLM-*.zip")
Remove-Item -Force -ErrorAction SilentlyContinue $generatedCrx, $generatedKey

try {
    $chromeArguments = @("--pack-extension=$distRoot")
    if (Test-Path $keyPath) {
        $chromeArguments += "--pack-extension-key=$keyPath"
    }
    & $chromePath @chromeArguments

    $waitAttempts = 0
    while (-not (Test-Path $generatedCrx) -and $waitAttempts -lt 20) {
        Start-Sleep -Milliseconds 250
        $waitAttempts++
    }
    if (-not (Test-Path $generatedCrx)) {
        throw "Chrome did not create the expected CRX."
    }

    if (-not (Test-Path $keyPath)) {
        if (-not (Test-Path $generatedKey)) {
            throw "Chrome did not create a signing key."
        }
        Move-Item -Force $generatedKey $keyPath
    }

    $releaseBaseName = "Coding-Site2LLM-v$version"
    $crxPath = Join-Path $outputDirectory "$releaseBaseName.crx"
    $zipPath = Join-Path $outputDirectory "$releaseBaseName.zip"
    Copy-Item -Force $generatedCrx $crxPath
    Compress-Archive -Path (Join-Path $distRoot "*") -DestinationPath $zipPath

    Write-Host "CRX created: $crxPath"
    Write-Host "ZIP created: $zipPath"
    Write-Host "Signing key: $keyPath"
}
finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $generatedCrx, $generatedKey
}