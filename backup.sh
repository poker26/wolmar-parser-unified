#!/bin/bash

# Backup script for Wolmar Parser
# Usage: ./backup.sh

echo "💾 Starting backup of Wolmar Parser..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Configuration
BACKUP_DIR="./backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="wolmar-parser-backup-$DATE"
BACKUP_FILE="$BACKUP_DIR/$BACKUP_NAME.tar.gz"

# Create backup directory if it doesn't exist
if [ ! -d "$BACKUP_DIR" ]; then
    print_status "Creating backup directory..."
    mkdir -p "$BACKUP_DIR"
fi

# Create backup
print_status "Creating backup: $BACKUP_FILE"

tar -czf "$BACKUP_FILE" \
    --exclude=node_modules \
    --exclude=logs \
    --exclude=.git \
    --exclude=backups \
    --exclude=*.log \
    --exclude=.env \
    --exclude=test_results.json \
    --exclude=*_progress.json \
    --exclude=*_analysis.json \
    --exclude=debug-*.png \
    --exclude=debug-*.jpg \
    .

if [ $? -eq 0 ]; then
    print_status "Backup created successfully!"
    
    # Get backup size
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    print_status "Backup size: $BACKUP_SIZE"
    
    # Clean old backups (keep last 7 days)
    print_status "Cleaning old backups..."
    find "$BACKUP_DIR" -name "wolmar-parser-backup-*.tar.gz" -mtime +7 -delete
    
    # List remaining backups
    print_status "Remaining backups:"
    ls -lh "$BACKUP_DIR"/wolmar-parser-backup-*.tar.gz 2>/dev/null || echo "No backups found"
    
else
    print_error "Backup failed!"
    exit 1
fi

print_status "Backup completed successfully! 🎉"
