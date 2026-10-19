#!/usr/bin/env bash
# =============================================================================
# Database Backup Script for Dental Laboratory Case Management System
# POSIX Shell (Linux / macOS)
# =============================================================================
# Usage:
#   ./scripts/backup.sh [DATABASE_URL]
#   Or export DATABASE_URL="postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"
# =============================================================================

set -euo pipefail

DATABASE_URL="${1:-${DATABASE_URL:-}}"
OUTPUT_DIR="./backups"

if [ -z "$DATABASE_URL" ]; then
    echo "Error: Database URL is required. Provide as first argument or set DATABASE_URL environment variable." >&2
    exit 1
fi

mkdir -p "$OUTPUT_DIR"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_FILE="$OUTPUT_DIR/dental_cms_backup_$TIMESTAMP.sql"

echo "=========================================="
echo "Starting Dental CMS Database Backup"
echo "Output: $OUTPUT_FILE"
echo "=========================================="

if command -v pg_dump &> /dev/null; then
    pg_dump "$DATABASE_URL" \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges \
        --file="$OUTPUT_FILE"

    echo "Backup completed successfully!"
    echo "Saved to: $OUTPUT_FILE"
else
    echo "pg_dump not found in PATH."
    echo "Alternative with Supabase CLI:"
    echo "  npx supabase db dump -f $OUTPUT_FILE"
fi
