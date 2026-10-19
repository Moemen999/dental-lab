# =============================================================================
# Database Restore Script for Dental Laboratory Case Management System
# PowerShell (Windows)
# =============================================================================
# Usage:
#   .\scripts\restore.ps1 -BackupFile "./backups/dental_cms_backup_20261014_120000.sql" -DatabaseUrl "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"
# =============================================================================

param (
    [Parameter(Mandatory=$true)]
    [string]$BackupFile,
    [string]$DatabaseUrl = $env:DATABASE_URL
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupFile)) {
    Write-Error "Backup file does not exist: $BackupFile"
    exit 1
}

if (-not $DatabaseUrl) {
    Write-Error "Database URL is required. Provide -DatabaseUrl parameter or set `$env:DATABASE_URL."
    exit 1
}

Write-Host "==========================================" -ForegroundColor Red
Write-Host "WARNING: DATABASE RESTORE OPERATION" -ForegroundColor Red
Write-Host "Target: $DatabaseUrl" -ForegroundColor Yellow
Write-Host "Source: $BackupFile" -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Red

$confirmation = Read-Host "Are you sure you want to restore this backup into the target database? (yes/no)"
if ($confirmation -ne "yes") {
    Write-Host "Restore operation cancelled." -ForegroundColor Yellow
    exit 0
}

$psql = Get-Command psql -ErrorAction SilentlyContinue

if ($psql) {
    & psql "$DatabaseUrl" -f "$BackupFile"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Database restored successfully from $BackupFile" -ForegroundColor Green
    } else {
        Write-Error "psql restore failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
} else {
    Write-Warning "psql utility not found in PATH."
    Write-Host "Alternative: Use Supabase SQL Editor or client to execute $BackupFile."
}
