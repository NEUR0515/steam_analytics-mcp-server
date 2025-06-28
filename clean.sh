# ================================
# clean.sh - Cleanup script
# ================================

#!/bin/bash

set -e

echo "🧹 Cleaning up Docker resources..."

# Stop services
docker-compose down

# Remove unused images
docker image prune -f

# Remove unused volumes
docker volume prune -f

# Remove unused networks
docker network prune -f

echo "✅ Cleanup completed"