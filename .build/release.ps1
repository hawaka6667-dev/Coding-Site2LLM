<#
Publish the already-committed manifest version as a GitHub release.
Local CodeGraph state and feedback screenshots are intentionally ignored.
#>
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
$manifest = Get-Content -Raw "manifest.json" | ConvertFrom-Json
$version = $manifest.version
$tag = "v$version"
$releaseDirectory = Join-Path $PSScriptRoot $tag
$crxPath = Join-Path $releaseDirectory "Coding-Site2LLM-$tag.crx"
$zipPath = Join-Path $releaseDirectory "Coding-Site2LLM-$tag.zip"

if ((git branch --show-current) -ne "main") {
    throw "Releases must be published from main."
}

$unexpectedChanges = git status --porcelain | Where-Object {
    $_ -notmatch '^ [M?] \.codegraph/' -and
    $_ -notmatch '^\?\? \.feedback/Snipaste_'
}
if ($unexpectedChanges) {
    throw "Commit or stash release changes before publishing:`n$($unexpectedChanges -join "`n")"
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI is required to publish a release."
}
& gh auth status
if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI authentication failed."
}

& npm run test:release
if ($LASTEXITCODE -ne 0) {
    throw "Release tests failed."
}

& npm run package:crx
if ($LASTEXITCODE -ne 0) {
    throw "Extension packaging failed."
}
if (-not (Test-Path $crxPath) -or -not (Test-Path $zipPath)) {
    throw "Release artifacts were not created for $tag."
}

& git push origin main
if ($LASTEXITCODE -ne 0) {
    throw "Failed to push main."
}

$headCommit = git rev-parse HEAD
$tagCommit = git rev-parse -q --verify "$tag^{}" 2>$null
if ($tagCommit) {
    if ($tagCommit -ne $headCommit) {
        throw "$tag already exists and does not point to HEAD."
    }
} else {
    & git tag -a $tag -m "Release $tag"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create $tag."
    }
}

& git push origin $tag
if ($LASTEXITCODE -ne 0) {
    throw "Failed to push $tag."
}

& gh release view $tag *> $null
if ($LASTEXITCODE -eq 0) {
    & gh release upload $tag $crxPath $zipPath --clobber
} else {
    & gh release create $tag $crxPath $zipPath --title "Coding Site2LLM $tag" --generate-notes
}
if ($LASTEXITCODE -ne 0) {
    throw "Failed to publish GitHub release $tag."
}

Write-Host "Published ${tag}: $(gh release view $tag --json url --jq .url)"