# PowerShell script to generate required secrets for .env.local and Secrets Store
# Usage: .\scripts\generate-secrets.ps1

Write-Host "🔐 Generating cryptographic secrets for Lumigift..." -ForegroundColor Cyan
Write-Host ""

# Function to generate random base64 string
function New-RandomSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    return [Convert]::ToBase64String($bytes)
}

# Generate NEXTAUTH_SECRET
$NEXTAUTH_SECRET = New-RandomSecret
Write-Host "NEXTAUTH_SECRET=$NEXTAUTH_SECRET" -ForegroundColor Green
Write-Host ""

# Generate CSRF_SECRET
$CSRF_SECRET = New-RandomSecret
Write-Host "CSRF_SECRET=$CSRF_SECRET" -ForegroundColor Green
Write-Host ""

# Generate CRON_SECRET
$CRON_SECRET = New-RandomSecret
Write-Host "CRON_SECRET=$CRON_SECRET" -ForegroundColor Green
Write-Host ""

Write-Host "✅ Secrets generated successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 For local development: copy these to .env.local" -ForegroundColor Yellow
Write-Host "☁️  For AWS Secrets Manager (production):" -ForegroundColor Cyan
Write-Host "   aws secretsmanager put-secret-value --secret-id lumigift/prod/NEXTAUTH_SECRET --secret-string `"$NEXTAUTH_SECRET`"" -ForegroundColor Gray
Write-Host "   aws secretsmanager put-secret-value --secret-id lumigift/prod/CSRF_SECRET --secret-string `"$CSRF_SECRET`"" -ForegroundColor Gray
Write-Host "   aws secretsmanager put-secret-value --secret-id lumigift/prod/CRON_SECRET --secret-string `"$CRON_SECRET`"" -ForegroundColor Gray

