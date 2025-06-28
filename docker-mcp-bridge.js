#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

// Configuration
const DOCKER_COMPOSE_FILE = path.join(__dirname, 'docker-compose.yml');
const ENV_FILE = path.join(__dirname, '.env.docker');

class DockerMCPBridge {
  constructor() {
    this.dockerProcess = null;
  }

  async start() {
    console.error('Starting Docker MCP Bridge...');
    
    try {
      // Ensure services are running
      await this.ensureServicesRunning();
      
      // Create bridge to Docker container
      this.dockerProcess = spawn('docker-compose', [
        '--env-file', ENV_FILE,
        'exec', '-T', 'steam-mcp',
        'node', 'dist/index.js'
      ], {
        stdio: ['pipe', 'pipe', 'inherit'],
        cwd: __dirname
      });

      // Pipe stdio
      process.stdin.pipe(this.dockerProcess.stdin);
      this.dockerProcess.stdout.pipe(process.stdout);

      // Handle process events
      this.dockerProcess.on('error', (error) => {
        console.error('Docker process error:', error);
        process.exit(1);
      });

      this.dockerProcess.on('exit', (code) => {
        console.error(`Docker process exited with code ${code}`);
        process.exit(code);
      });

      console.error('Docker MCP Bridge started successfully');

    } catch (error) {
      console.error('Failed to start Docker MCP Bridge:', error);
      process.exit(1);
    }
  }

  async ensureServicesRunning() {
    return new Promise((resolve, reject) => {
      const checkProcess = spawn('docker-compose', [
        '--env-file', ENV_FILE,
        'ps', '-q', 'steam-mcp'
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: __dirname
      });

      let output = '';
      checkProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      checkProcess.on('exit', (code) => {
        if (code === 0 && output.trim()) {
          resolve();
        } else {
          // Start services if not running
          const startProcess = spawn('docker-compose', [
            '--env-file', ENV_FILE,
            'up', '-d', 'steam-mcp'
          ], {
            stdio: 'inherit',
            cwd: __dirname
          });

          startProcess.on('exit', (startCode) => {
            if (startCode === 0) {
              resolve();
            } else {
              reject(new Error(`Failed to start services: exit code ${startCode}`));
            }
          });
        }
      });
    });
  }

  async stop() {
    if (this.dockerProcess) {
      this.dockerProcess.kill();
    }
  }
}

// Handle signals
const bridge = new DockerMCPBridge();

process.on('SIGINT', async () => {
  console.error('Received SIGINT, shutting down...');
  await bridge.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('Received SIGTERM, shutting down...');
  await bridge.stop();
  process.exit(0);
});

// Start the bridge
bridge.start().catch((error) => {
  console.error('Bridge startup failed:', error);
  process.exit(1);
});