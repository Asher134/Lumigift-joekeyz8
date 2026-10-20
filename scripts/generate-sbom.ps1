# Lumigift SBOM Generation Script (PowerShell)
param (
    [string]$ImageTag = "lumigift-app:latest",
    [string]$OutputDir = "./build/sbom"
)

$ErrorActionPreference = "Stop"

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "   Lumigift SBOM Generation Tool (PowerShell)" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "Target Image: $ImageTag"
Write-Host "Output Dir:   $OutputDir"
Write-Host ""

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$syftCmd = Get-Command syft -ErrorAction SilentlyContinue

if ($syftCmd) {
    Write-Host "Generating SPDX JSON SBOM via Syft..." -ForegroundColor Green
    syft $ImageTag -o spdx-json | Out-File -FilePath "$OutputDir/lumigift-sbom.spdx.json" -Encoding utf8
    
    Write-Host "Generating CycloneDX JSON SBOM via Syft..." -ForegroundColor Green
    syft $ImageTag -o cyclonedx-json | Out-File -FilePath "$OutputDir/lumigift-sbom.cdx.json" -Encoding utf8
    
    Write-Host "Generating Human-Readable Table SBOM..." -ForegroundColor Green
    syft $ImageTag -o table | Out-File -FilePath "$OutputDir/lumigift-sbom.txt" -Encoding utf8

    Write-Host "`nSBOM generation complete:" -ForegroundColor Cyan
    Write-Host "   - $OutputDir/lumigift-sbom.spdx.json (SPDX standard)"
    Write-Host "   - $OutputDir/lumigift-sbom.cdx.json (CycloneDX standard)"
    Write-Host "   - $OutputDir/lumigift-sbom.txt (Summary table)"
} else {
    Write-Host "Syft CLI not found in PATH." -ForegroundColor Yellow
    Write-Host "Attempting fallback using Dockerized Syft..." -ForegroundColor Yellow
    
    docker run --rm -v /var/run/docker.sock:/var/run/docker.sock anchore/syft $ImageTag -o spdx-json | Out-File -FilePath "$OutputDir/lumigift-sbom.spdx.json" -Encoding utf8
    docker run --rm -v /var/run/docker.sock:/var/run/docker.sock anchore/syft $ImageTag -o cyclonedx-json | Out-File -FilePath "$OutputDir/lumigift-sbom.cdx.json" -Encoding utf8
    
    Write-Host "SBOM generated via containerized Syft." -ForegroundColor Green
}
