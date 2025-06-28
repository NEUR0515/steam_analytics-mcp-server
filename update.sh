# ================================
# update.sh - Update deployment script
# ================================

#!/bin/bash

set -e

ENV_FILE=".env.docker"

echo "🔄 Updating Steam MCP Server..."

# Pull latest code (if using git)
if [ -d ".git" ]; then
    echo "📥 Pulling latest code..."
    git pull
fi

# Rebuild and redeploy
echo "🔨 Rebuilding services..."
docker-compose --env-file "$ENV_FILE" build

echo "🚀 Restarting services..."
docker-compose --env-file "$ENV_FILE" up -d

echo "✅ Update completed"