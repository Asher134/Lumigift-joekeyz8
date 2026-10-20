# Lumigift Docker Security Check (PowerShell)
param (
    [string]$ImageTag = "lumigift-app:latest"
)

$ErrorActionPreference = "Continue"

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "   Lumigift Docker Security & Compliance Check" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "Target Image: $ImageTag`n"

$failures = 0

# Step 1: Hadolint check
Write-Host "▶ [1/4] Running Hadolint on Dockerfile..." -ForegroundColor Yellow
$hadolintCmd = Get-Command hadolint -ErrorAction SilentlyContinue
if ($hadolintCmd) {
    hadolint Dockerfile
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Hadolint reported issues in Dockerfile" -ForegroundColor Red
        $failures++
    } else {
        Write-Host "✅ Hadolint passed." -ForegroundColor Green
    }
} else {
    Write-Host "Running Hadolint via Docker..." -ForegroundColor Gray
    Get-Content Dockerfile | docker run --rm -i hadolint/hadolint -
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Hadolint reported issues in Dockerfile" -ForegroundColor Red
        $failures++
    } else {
        Write-Host "✅ Hadolint passed." -ForegroundColor Green
    }
}

# Step 2: Build verification
Write-Host "`n▶ [2/4] Verifying Docker Build..." -ForegroundColor Yellow
docker build -t $ImageTag --target runner .
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker build failed." -ForegroundColor Red
    $failures++
} else {
    Write-Host "✅ Docker build succeeded." -ForegroundColor Green
}

# Step 3: Trivy Vulnerability Scan
Write-Host "`n▶ [3/4] Running Trivy Vulnerability Scan..." -ForegroundColor Yellow
$trivyCmd = Get-Command trivy -ErrorAction SilentlyContinue
if ($trivyCmd) {
    trivy image --severity CRITICAL,HIGH --ignore-unfixed $ImageTag
} else {
    Write-Host "Running Trivy via Docker container..." -ForegroundColor Gray
    docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image --severity CRITICAL,HIGH --ignore-unfixed $ImageTag
}

# Step 4: Verify Non-Root User
Write-Host "`n▶ [4/4] Verifying Non-Root User..." -ForegroundColor Yellow
$userId = (docker run --rm $ImageTag id -u).Trim()
$groupId = (docker run --rm $ImageTag id -g).Trim()

if ($userId -eq "0") {
    Write-Host "❌ SECURITY FAILURE: Container is running as root (UID 0)!" -ForegroundColor Red
    $failures++
} else {
    Write-Host "✅ Verified non-root user: UID $userId, GID $groupId (nextjs:nodejs)" -ForegroundColor Green
}

Write-Host ""
if ($failures -gt 0) {
    Write-Host "❌ Docker security checks failed ($failures errors found)." -ForegroundColor Red
    exit 1
} else {
    Write-Host "🎉 All Docker security and hardening checks passed successfully!" -ForegroundColor Green
}
