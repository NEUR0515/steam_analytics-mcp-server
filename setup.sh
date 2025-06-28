#!/bin/bash

# Steam MCP Server - Automated Setup Script
# This script automates the build and test process

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="steam-analytics-mcp-server"
NODE_VERSION_REQUIRED="18"

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Node.js version
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed. Please install Node.js ${NODE_VERSION_REQUIRED}+ from https://nodejs.org/"
        exit 1
    fi
    
    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -lt "$NODE_VERSION_REQUIRED" ]; then
        log_error "Node.js version ${NODE_VERSION_REQUIRED}+ required. Current version: $(node -v)"
        exit 1
    fi
    log_success "Node.js $(node -v) found"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        log_error "npm is not installed"
        exit 1
    fi
    log_success "npm $(npm -v) found"
    
    # Check if we're in the right directory
    if [ ! -f "package.json" ]; then
        log_error "package.json not found. Make sure you're in the project root directory."
        exit 1
    fi
    log_success "Project structure validated"
}

setup_environment() {
    log_info "Setting up environment..."
    
    # Check if .env exists
    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            cp .env.example .env
            log_warning ".env file created from .env.example"
            log_warning "Please edit .env and add your Steam API key before continuing"
            
            # Check if Steam API key is set
            if ! grep -q "^STEAM_API_KEY=.*[^=]" .env; then
                log_error "Steam API key not set in .env file"
                log_info "Get your Steam API key from: https://steamcommunity.com/dev/apikey"
                log_info "Then edit .env file and set: STEAM_API_KEY=your_key_here"
                exit 1
            fi
        else
            log_error ".env file not found and no .env.example to copy from"
            exit 1
        fi
    fi
    
    # Load environment variables
    if [ -f ".env" ]; then
        export $(cat .env | grep -v '^#' | xargs)
    fi
    
    # Validate Steam API key
    if [ -z "$STEAM_API_KEY" ] || [ "$STEAM_API_KEY" = "your_steam_api_key_here" ]; then
        log_error "Steam API key not properly set in .env file"
        log_info "Get your Steam API key from: https://steamcommunity.com/dev/apikey"
        exit 1
    fi
    
    log_success "Environment configured"
}

install_dependencies() {
    log_info "Installing dependencies..."
    
    # Clear npm cache if needed
    if [ -d "node_modules" ]; then
        log_info "Cleaning existing node_modules..."
        rm -rf node_modules
    fi
    
    # Install dependencies
    npm install
    
    log_success "Dependencies installed"
}

build_project() {
    log_info "Building project..."
    
    # Clean dist directory
    if [ -d "dist" ]; then
        rm -rf dist
    fi
    
    # Build TypeScript
    npm run build
    
    # Verify build output
    if [ ! -f "dist/index.js" ]; then
        log_error "Build failed - dist/index.js not found"
        exit 1
    fi
    
    log_success "Project built successfully"
}

test_steam_api() {
    log_info "Testing Steam API connectivity..."
    
    # Test Steam API with curl
    STEAM_API_URL="https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=76561197960435530"
    
    if command -v curl &> /dev/null; then
        HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$STEAM_API_URL")
        if [ "$HTTP_STATUS" = "200" ]; then
            log_success "Steam API connectivity verified"
        else
            log_error "Steam API returned status code: $HTTP_STATUS"
            log_info "Check your Steam API key and network connection"
            exit 1
        fi
    else
        log_warning "curl not found, skipping Steam API connectivity test"
    fi
}

run_tests() {
    log_info "Running MCP server tests..."
    
    # Create test script if it doesn't exist
    if [ ! -f "test-mcp.js" ]; then
        log_info "Creating test script..."
        # The test script content would be created here
        # For now, we'll run a basic test
    fi
    
    # Run the test
    timeout 30s node test-mcp.js || {
        EXIT_CODE=$?
        if [ $EXIT_CODE -eq 124 ]; then
            log_error "Tests timed out after 30 seconds"
        else
            log_error "Tests failed with exit code: $EXIT_CODE"
        fi
        exit 1
    }
    
    log_success "All tests passed"
}

generate_config() {
    log_info "Generating Claude Desktop configuration..."
    
    CURRENT_DIR=$(pwd)
    CONFIG_JSON="{
  \"mcpServers\": {
    \"steam-analytics\": {
      \"command\": \"node\",
      \"args\": [\"${CURRENT_DIR}/dist/index.js\"],
      \"env\": {
        \"STEAM_API_KEY\": \"${STEAM_API_KEY}\"
      }
    }
  }
}"
    
    echo "$CONFIG_JSON" > claude_desktop_config.json
    log_success "Claude Desktop config saved to: claude_desktop_config.json"
    
    # Detect OS and provide instructions
    if [[ "$OSTYPE" == "darwin"* ]]; then
        CONFIG_PATH="~/Library/Application Support/Claude/claude_desktop_config.json"
        log_info "On macOS, copy this config to: $CONFIG_PATH"
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
        CONFIG_PATH="%APPDATA%\\Claude\\claude_desktop_config.json"
        log_info "On Windows, copy this config to: $CONFIG_PATH"
    else
        log_info "Copy the generated config to your Claude Desktop configuration file"
    fi
}

cleanup() {
    log_info "Cleaning up temporary files..."
    # Add any cleanup logic here
    log_success "Cleanup completed"
}

main() {
    echo -e "${BLUE}"
    echo "🎮 Steam MCP Server - Automated Setup"
    echo "====================================="
    echo -e "${NC}"
    
    check_prerequisites
    setup_environment
    install_dependencies
    build_project
    test_steam_api
    run_tests
    generate_config
    
    echo -e "${GREEN}"
    echo "🎉 Setup completed successfully!"
    echo "==============================="
    echo -e "${NC}"
    
    log_info "Next steps:"
    echo "1. Copy claude_desktop_config.json to your Claude Desktop config location"
    echo "2. Restart Claude Desktop"
    echo "3. Test the MCP tools in Claude Desktop"
    echo ""
    log_info "Available MCP tools:"
    echo "• get_player_summary - Get Steam player information"
    echo "• analyze_gaming_habits - Analyze gaming patterns and statistics"
    echo "• get_game_recommendations - Generate personalized game recommendations"
    echo ""
    log_info "For troubleshooting, run: npm run dev"
}

# Handle script interruption
trap cleanup EXIT

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --clean)
            log_info "Performing clean setup..."
            rm -rf node_modules dist
            shift
            ;;
        --help|-h)
            echo "Steam MCP Server Setup Script"
            echo ""
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --clean       Clean build (remove node_modules and dist)"
            echo "  --skip-tests  Skip running tests"
            echo "  --help, -h    Show this help message"
            echo ""
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Run main function
main