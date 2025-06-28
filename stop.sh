# ================================
# stop.sh - Stop services script
# ================================

#!/bin/bash

set -e

ENV_FILE=".env.docker"

echo "🛑 Stopping Steam MCP Server stack..."

# Stop all services
docker-compose --env-file "$ENV_FILE" down

# Optional: Remove volumes (uncomment if needed)
# docker-compose --env-file "$ENV_FILE" down -v

echo "✅ All services stopped"
