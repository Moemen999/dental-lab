#!/usr/bin/env bash
# =============================================================================
# Database Restore Script for Dental Laboratory Case Management System
# POSIX Shell (Linux / macOS)
# =============================================================================
# Usage:
#   ./scripts/restore.sh [BACKUP_FILE] [DATABASE_URL]
# =============================================================================

set -euo pipefail

BACKUP_FILE="${1:-}"
DATABASE_URL="${2:-${DATABASE_URL:-}}"

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
    echo "Error: Valid backup file path is required as first argument." >&2
    exit 1
fi

if [ -z "$DATABASE_URL" ]; then
    echo "Error: Database URL is required as second argument or DATABASE_URL env var." >&2
    exit 1
fi

echo "=========================================="
echo "WARNING: DATABASE RESTORE OPERATION"
echo "Target: $DATABASE_URL"
echo "Source: $BACKUP_FILE"
echo "=========================================="

read -p "Are you sure you want to restore this backup? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
fi

if command -v psql &> /dev/null; then
    psql "$DATABASE_URL" -f "$BACKUP_FILE"
    echo "Database restored successfully!"
else
    echo "psql not found in PATH."
    echo "Alternative: Run contents of $BACKUP_FILE via Supabase Dashboard SQL Editor."
fi
