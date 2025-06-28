# ================================
# logs.sh - View logs script
# ================================

#!/bin/bash

ENV_FILE=".env.docker"
SERVICE=${1:-steam-mcp}

echo "📋 Viewing logs for $SERVICE..."
echo "Press Ctrl+C to exit"

docker-compose --env-file "$ENV_FILE" logs -f "$SERVICE"