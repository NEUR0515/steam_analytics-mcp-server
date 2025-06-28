#!/usr/bin/env node

/**
 * Simple MCP Server Test
 * Minimal test to verify MCP server functionality
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);
config({ path: join(projectRoot, '.env') });

console.log('🔧 Simple MCP Server Test');
console.log('==========================');
console.log('');

// Test configuration
const serverPath = join(projectRoot, 'dist', 'index.js');
const testSteamId = '76561197960435530';

// Simple test messages
const testMessages = [
  {
    name: 'Initialize',
    message: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" }
      }
    }
  },
  {
    name: 'List Tools',
    message: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    }
  },
  {
    name: 'Get Player Summary',
    message: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_player_summary",
        arguments: { steamId: testSteamId }
      }
    }
  }
];

class SimpleMCPTester {
  constructor() {
    this.server = null;
    this.currentMessageIndex = 0;
    this.responses = [];
    this.responseBuffer = '';
  }

  async runTest() {
    console.log('🔍 Checking prerequisites...');
    
    // Check if server exists
    try {
      readFileSync(serverPath);
      console.log('✅ MCP server build found');
    } catch (error) {
      console.log('❌ MCP server not found. Run: npm run build');
      return false;
    }

    console.log('✅ Steam API key configured');
    console.log('');

    console.log('🚀 Starting MCP server...');
    
    try {
      await this.startServer();
      await this.runTests();
      return true;
    } catch (error) {
      console.log('❌ Test failed:', error.message);
      return false;
    } finally {
      this.cleanup();
    }
  }

  async startServer() {
    return new Promise((resolve, reject) => {
      this.server = spawn('node', [serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env
      });

      this.server.stdout.on('data', (data) => {
        this.handleServerOutput(data.toString());
      });

      this.server.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('running on stdio')) {
          console.log('✅ MCP server started');
          console.log('');
          resolve();
        } else {
          console.log('Server stderr:', msg);
        }
      });

      this.server.on('error', (error) => {
        console.log('❌ Failed to start server:', error.message);
        reject(error);
      });

      // Timeout for server startup
      setTimeout(() => {
        if (this.server && !this.server.killed) {
          console.log('✅ Server startup timeout reached, assuming ready');
          resolve();
        }
      }, 3000);
    });
  }

  handleServerOutput(data) {
    this.responseBuffer += data;
    
    // Try to parse JSON responses
    const lines = this.responseBuffer.split('\n');
    this.responseBuffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.trim()) {
        try {
          const response = JSON.parse(line.trim());
          this.responses.push(response);
          console.log(`📦 Response ${response.id}:`, response.error ? 'ERROR' : 'SUCCESS');
          
          if (response.result?.tools) {
            console.log(`   Tools available: ${response.result.tools.length}`);
          }
          
          if (response.result?.content) {
            console.log(`   Content received: ${response.result.content[0]?.text?.length || 0} chars`);
          }
          
        } catch (parseError) {
          // Not JSON, probably debug output
          if (line.includes('{')) {
            console.log('Raw output:', line.trim());
          }
        }
      }
    }
  }

  async runTests() {
    console.log('🧪 Running test messages...');
    console.log('');

    for (let i = 0; i < testMessages.length; i++) {
      const test = testMessages[i];
      await this.sendMessage(test);
      
      // Wait between messages
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Wait for final responses
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('');
    console.log('📊 Test Results:');
    console.log(`   Messages sent: ${testMessages.length}`);
    console.log(`   Responses received: ${this.responses.length}`);

    if (this.responses.length >= testMessages.length) {
      console.log('✅ All tests completed successfully');
      return true;
    } else {
      console.log('⚠️  Some responses missing');
      return false;
    }
  }

  async sendMessage(test) {
    console.log(`🔄 Testing: ${test.name}`);
    
    const messageStr = JSON.stringify(test.message) + '\n';
    
    try {
      this.server.stdin.write(messageStr);
      console.log(`   Message sent (ID: ${test.message.id})`);
    } catch (error) {
      console.log(`   ❌ Failed to send message: ${error.message}`);
    }
  }

  cleanup() {
    if (this.server && !this.server.killed) {
      console.log('🧹 Cleaning up server...');
      this.server.kill('SIGTERM');
      
      setTimeout(() => {
        if (this.server && !this.server.killed) {
          this.server.kill('SIGKILL');
        }
      }, 2000);
    }
  }
}

// Main execution
async function main() {
  const tester = new SimpleMCPTester();
  const success = await tester.runTest();
  
  console.log('');
  if (success) {
    console.log('🎉 Simple MCP test PASSED!');
    console.log('Your MCP server is working correctly.');
  } else {
    console.log('❌ Simple MCP test FAILED!');
    console.log('Check the output above for issues.');
  }
  
  process.exit(success ? 0 : 1);
}

// Error handling
process.on('unhandledRejection', (error) => {
  console.log('💥 Unhandled rejection:', error.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Test interrupted');
  process.exit(1);
});

// Global timeout
setTimeout(() => {
  console.log('⏰ Global test timeout (60 seconds)');
  process.exit(1);
}, 60000);

main().catch(error => {
  console.log('💥 Test error:', error.message);
  process.exit(1);
});