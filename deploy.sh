#!/bin/bash

# ================================
# deploy.sh - Main deployment script
# ================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] ✅ $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] ⚠️  $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ❌ $1${NC}"
}

# Configuration
DOCKER_COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env.docker"
BACKUP_DIR="./backups"

# Parse command line arguments
ENVIRONMENT="production"
REBUILD=false
MONITORING=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --rebuild)
            REBUILD=true
            shift
            ;;
        --monitoring)
            MONITORING=true
            shift
            ;;
        --help|-h)
            echo "Steam MCP Server Deployment Script"
            echo ""
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --env ENV        Set environment (production|development|staging)"
            echo "  --rebuild        Force rebuild of Docker images"
            echo "  --monitoring     Include monitoring stack"
            echo "  --help, -h       Show this help message"
            echo ""
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            exit 1
            ;;
    esac
done

log "🚀 Starting Steam MCP Server deployment..."
log "Environment: $ENVIRONMENT"
log "Rebuild: $REBUILD"
log "Monitoring: $MONITORING"

# Check prerequisites
check_prerequisites() {
    log "🔍 Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        error "Docker Compose is not installed"
        exit 1
    fi
    
    # Check environment file
    if [ ! -f "$ENV_FILE" ]; then
        warn "Environment file $ENV_FILE not found"
        if [ -f ".env.example" ]; then
            log "Creating $ENV_FILE from .env.example"
            cp .env.example "$ENV_FILE"
            warn "Please edit $ENV_FILE with your configuration"
            exit 1
        else
            error "No environment file found"
            exit 1
        fi
    fi
    
    # Check Steam API key
    if ! grep -q "^STEAM_API_KEY=.*[^=]" "$ENV_FILE"; then
        error "STEAM_API_KEY not set in $ENV_FILE"
        exit 1
    fi
    
    success "Prerequisites check passed"
}

# Build application
build_app() {
    if [ "$REBUILD" = true ]; then
        log "🔨 Rebuilding Docker images..."
        docker-compose --env-file "$ENV_FILE" build --no-cache
    else
        log "🔨 Building Docker images..."
        docker-compose --env-file "$ENV_FILE" build
    fi
    success "Build completed"
}

# Create necessary directories
setup_directories() {
    log "📁 Setting up directories..."
    
    mkdir -p logs
    mkdir -p config
    mkdir -p monitoring/grafana/dashboards
    mkdir -p monitoring/grafana/provisioning
    mkdir -p "$BACKUP_DIR"
    
    # Set proper permissions
    chmod 755 logs config
    
    success "Directories created"
}

# Deploy services
deploy_services() {
    log "🚀 Deploying services..."
    
    # Prepare compose command
    COMPOSE_CMD="docker-compose --env-file $ENV_FILE"
    
    if [ "$ENVIRONMENT" = "development" ]; then
        COMPOSE_CMD="$COMPOSE_CMD -f docker-compose.yml -f docker-compose.override.yml"
    fi
    
    if [ "$MONITORING" = true ]; then
        COMPOSE_CMD="$COMPOSE_CMD --profile monitoring"
    fi
    
    # Stop existing services
    log "Stopping existing services..."
    $COMPOSE_CMD down
    
    # Start services
    log "Starting services..."
    $COMPOSE_CMD up -d
    
    success "Services deployed"
}

# Health check
health_check() {
    log "🏥 Performing health checks..."
    
    # Wait for services to start
    sleep 10
    
    # Check Steam MCP service
    if docker-compose --env-file "$ENV_FILE" ps steam-mcp | grep -q "Up"; then
        success "Steam MCP service is running"
    else
        error "Steam MCP service failed to start"
        docker-compose --env-file "$ENV_FILE" logs steam-mcp
        exit 1
    fi
    
    # Check gateway if enabled
    if docker-compose --env-file "$ENV_FILE" ps mcp-gateway | grep -q "Up"; then
        success "MCP Gateway is running"
        
        # Test gateway health endpoint
        if curl -f http://localhost:8080/health > /dev/null 2>&1; then
            success "Gateway health check passed"
        else
            warn "Gateway health check failed"
        fi
    fi
    
    success "Health checks completed"
}

# Show status
show_status() {
    log "📊 Service Status:"
    docker-compose --env-file "$ENV_FILE" ps
    
    log "📋 Available endpoints:"
    echo "  • MCP Gateway: http://localhost:8080"
    if [ "$MONITORING" = true ]; then
        echo "  • Prometheus: http://localhost:9090"
        echo "  • Grafana: http://localhost:3000"
    fi
    
    log "📖 Useful commands:"
    echo "  • View logs: docker-compose --env-file $ENV_FILE logs -f steam-mcp"
    echo "  • Stop services: docker-compose --env-file $ENV_FILE down"
    echo "  • Restart: docker-compose --env-file $ENV_FILE restart steam-mcp"
}

# Backup function
backup_data() {
    log "💾 Creating backup..."
    
    BACKUP_FILE="$BACKUP_DIR/mcp-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
    
    tar -czf "$BACKUP_FILE" \
        --exclude=node_modules \
        --exclude=.git \
        --exclude=logs \
        . || true
    
    success "Backup created: $BACKUP_FILE"
}

# Main execution
main() {
    check_prerequisites
    setup_directories
    
    if [ "$ENVIRONMENT" = "production" ]; then
        backup_data
    fi
    
    build_app
    deploy_services
    health_check
    show_status
    
    success "🎉 Deployment completed successfully!"
    
    if [ "$ENVIRONMENT" = "production" ]; then
        log "🔧 Next steps:"
        echo "  1. Update your Claude Desktop config to point to the Docker container"
        echo "  2. Monitor logs: docker-compose --env-file $ENV_FILE logs -f"
        echo "  3. Set up regular backups and monitoring"
    fi
}

# Error handling
trap 'error "Deployment failed"; exit 1' ERR

# Run main function
main