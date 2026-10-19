# =============================================================================
# Database Backup Script for Dental Laboratory Case Management System
# PowerShell (Windows)
# =============================================================================
# Usage:
#   .\scripts\backup.ps1 -DatabaseUrl "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"
#   Or set environment variable: $env:DATABASE_URL
#
# Free Tier Note:
#   Supabase free tier provides 500 MB DB storage without automated daily off-site
#   backups. Run this script regularly to maintain safe local or external backups.
# =============================================================================

param (
    [string]$DatabaseUrl = $env:DATABASE_URL,
    [string]$OutputDir = "./backups"
)

$ErrorActionPreference = "Stop"

if (-not $DatabaseUrl) {
    Write-Error "Database URL is required. Provide -DatabaseUrl parameter or set `$env:DATABASE_URL."
    exit 1
}

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$OutputFile = Join-Path $OutputDir "dental_cms_backup_$Timestamp.sql"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Starting Dental CMS Database Backup" -ForegroundColor Cyan
Write-Host "Target: $OutputFile" -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Cyan

# Check for pg_dump
$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue

if ($pgDump) {
    # Execute pg_dump
    & pg_dump "$DatabaseUrl" `
        --clean `
        --if-exists `
        --no-owner `
        --no-privileges `
        --file="$OutputFile"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Backup completed successfully!" -ForegroundColor Green
        Write-Host "Backup saved to: $OutputFile" -ForegroundColor Green
    } else {
        Write-Error "pg_dump failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
} else {
    Write-Warning "pg_dump not found in system PATH."
    Write-Host "Alternative: Use Supabase CLI to export:" -ForegroundColor Yellow
    Write-Host "  npx supabase db dump -f $OutputFile" -ForegroundColor Yellow
}
