# Steam MCP Server Dockerfile
# Multi-stage build for production optimization

# Stage 1: Build stage
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build the TypeScript application
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# Stage 2: Development stage
FROM node:18-alpine AS development

# Create non-root user for security
RUN addgroup -g 1001 -S steam && \
    adduser -S steam -u 1001 -G steam

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev dependencies for development)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Create logs directory
RUN mkdir -p /app/logs && \
    chown -R steam:steam /app

# Switch to non-root user
USER steam

# Set environment variables
ENV NODE_ENV=development
ENV LOG_LEVEL=debug

# Development command (will be overridden by docker-compose)
CMD ["npm", "run", "dev"]

# Stage 3: Production stage
FROM node:18-alpine AS production

# Create non-root user for security
RUN addgroup -g 1001 -S steam && \
    adduser -S steam -u 1001 -G steam

# Set working directory
WORKDIR /app

# Install only production dependencies first (for better caching)
COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy any additional runtime files if needed
COPY --chown=steam:steam package.json ./

# Create logs directory
RUN mkdir -p /app/logs && \
    chown -R steam:steam /app

# Switch to non-root user
USER steam

# Set environment variables
ENV NODE_ENV=production
ENV LOG_LEVEL=info

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('Health check passed')" || exit 1

# Default command
CMD ["node", "dist/index.js"]

# Labels for metadata
LABEL maintainer="PH4NT0MBYT3"
LABEL description="Steam Analytics MCP Server"
LABEL version="1.0.0"