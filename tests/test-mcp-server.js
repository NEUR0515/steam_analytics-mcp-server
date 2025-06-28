#!/usr/bin/env node

/**
 * MCP Server Integration Test
 * Tests the complete MCP server functionality including all tools
 * Run: node test-mcp-server.js
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { config } from 'dotenv';

// Load environment variables from parent directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname); // Go up one directory from tests/
config({ path: join(projectRoot, '.env') });

// Test configuration
const TEST_CONFIG = {
  serverPath: join(projectRoot, 'dist', 'index.js'), // Updated path
  testSteamId: '76561197960435530', // Robin Walker (public profile)
  timeout: 30000, // 30 seconds total timeout
  requestTimeout: 10000, // 10 seconds per request
};

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// MCP Protocol Test Cases
const MCP_TESTS = [
  {
    name: 'Initialize MCP Server',
    message: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" }
      }
    },
    validate: (response) => {
      return response.result && 
             typeof response.result.protocolVersion === 'string' &&
             response.result.capabilities !== undefined;
    },
    description: 'Tests MCP server initialization and capability exchange'
  },
  {
    name: 'List Available Tools',
    message: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    },
    validate: (response) => {
      return response.result && 
             response.result.tools && 
             Array.isArray(response.result.tools) &&
             response.result.tools.length > 0;
    },
    description: 'Retrieves list of available MCP tools',
    expectedTools: ['get_player_summary', 'analyze_gaming_habits', 'get_game_recommendations']
  },
  {
    name: 'Get Player Summary',
    message: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_player_summary",
        arguments: { steamId: TEST_CONFIG.testSteamId }
      }
    },
    validate: (response) => {
      if (!response.result || !response.result.content) return false;
      try {
        const content = response.result.content[0];
        const playerData = JSON.parse(content.text);
        return playerData.steamid && playerData.personaname;
      } catch (error) {
        return false;
      }
    },
    description: 'Tests Steam player profile retrieval'
  },
  {
    name: 'Analyze Gaming Habits',
    message: {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "analyze_gaming_habits",
        arguments: { 
          steamId: TEST_CONFIG.testSteamId,
          includeAchievements: false 
        }
      }
    },
    validate: (response) => {
      if (!response.result || !response.result.content) return false;
      try {
        const content = response.result.content[0];
        const analysisData = JSON.parse(content.text);
        return analysisData.player && 
               analysisData.analysis && 
               analysisData.insights;
      } catch (error) {
        return false;
      }
    },
    description: 'Tests comprehensive gaming habits analysis'
  },
  {
    name: 'Get Game Recommendations',
    message: {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "get_game_recommendations",
        arguments: { 
          steamId: TEST_CONFIG.testSteamId,
          maxRecommendations: 3
        }
      }
    },
    validate: (response) => {
      if (!response.result || !response.result.content) return false;
      try {
        const content = response.result.content[0];
        const recData = JSON.parse(content.text);
        return recData.player && 
               recData.recommendations && 
               Array.isArray(recData.recommendations);
      } catch (error) {
        return false;
      }
    },
    description: 'Tests AI-powered game recommendations'
  },
  {
    name: 'Test Invalid Tool',
    message: {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "non_existent_tool",
        arguments: {}
      }
    },
    validate: (response) => {
      return response.error && 
             response.error.code === -32601; // Method not found
    },
    description: 'Tests error handling for invalid tool names',
    expectError: true
  },
  {
    name: 'Test Invalid Steam ID',
    message: {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "get_player_summary",
        arguments: { steamId: "invalid_steam_id" }
      }
    },
    validate: (response) => {
      return response.error || 
             (response.result && response.result.content && 
              response.result.content[0].text.includes('error'));
    },
    description: 'Tests error handling for invalid Steam IDs',
    expectError: true
  }
];

class MCPServerTester {
  constructor() {
    this.server = null;
    this.results = [];
    this.currentTestIndex = 0;
    this.responseBuffer = '';
    this.pendingRequests = new Map();
    this.startTime = Date.now();
    this.testTimeout = null;
  }

  async runAllTests() {
    log('cyan', '🧪 MCP Server Integration Test Suite');
    log('cyan', '=====================================\n');

    try {
      // Validate prerequisites
      if (!this.validatePrerequisites()) {
        return false;
      }

      // Start server
      await this.startServer();

      // Set global timeout
      this.testTimeout = setTimeout(() => {
        this.finishTests('❌ Tests timed out after 30 seconds');
      }, TEST_CONFIG.timeout);

      // Run tests sequentially
      await this.runTestsSequentially();

      return true;

    } catch (error) {
      log('red', `💥 Test suite failed: ${error.message}`);
      return false;
    }
  }

  validatePrerequisites() {
    log('blue', '🔍 Validating prerequisites...');
    
    // Check if server build exists
    try {
      readFileSync(TEST_CONFIG.serverPath);
      log('green', '✅ MCP server build found');
    } catch (error) {
      log('red', '❌ MCP server not built. Run: npm run build');
      return false;
    }

    // Check environment variables
    if (!process.env.STEAM_API_KEY) {
      log('red', '❌ STEAM_API_KEY not found in environment');
      return false;
    }
    log('green', '✅ Steam API key found');

    // Check Node.js version
    const nodeVersion = parseInt(process.version.slice(1));
    if (nodeVersion < 18) {
      log('red', `❌ Node.js 18+ required. Current: ${process.version}`);
      return false;
    }
    log('green', `✅ Node.js ${process.version} compatible`);

    console.log();
    return true;
  }

  async startServer() {
    log('blue', '🚀 Starting MCP server...');
    
    this.server = spawn('node', [TEST_CONFIG.serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    // Set up event handlers
    this.server.stdout.on('data', (data) => {
      this.handleServerResponse(data.toString());
    });

    this.server.stderr.on('data', (data) => {
      const errorMsg = data.toString();
      if (errorMsg.includes('running on stdio')) {
        log('green', '✅ MCP server started successfully');
      } else if (!errorMsg.includes('Steam Analytics MCP Server')) {
        console.error('Server stderr:', errorMsg);
      }
    });

    this.server.on('error', (error) => {
      log('red', `❌ Failed to start server: ${error.message}`);
      throw error;
    });

    this.server.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        log('red', `❌ Server exited with code ${code}`);
      }
    });

    // Give server time to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log();
  }

  handleServerResponse(data) {
    this.responseBuffer += data;
    
    // Process complete JSON lines
    const lines = this.responseBuffer.split('\n');
    this.responseBuffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.trim()) {
        try {
          const response = JSON.parse(line.trim());
          this.processResponse(response);
        } catch (error) {
          // Sometimes we get non-JSON debug output, ignore it
          if (line.includes('{') || line.includes('}')) {
            console.log('Failed to parse response:', line.trim());
          }
        }
      }
    }
  }

  processResponse(response) {
    const requestId = response.id;
    const pendingTest = this.pendingRequests.get(requestId);
    
    if (!pendingTest) {
      console.log('Unexpected response:', response);
      return;
    }

    this.pendingRequests.delete(requestId);
    clearTimeout(pendingTest.timeout);

    const testResult = this.validateTestResponse(pendingTest.test, response);
    this.results.push(testResult);

    this.logTestResult(testResult);

    // Continue with next test or finish
    if (this.results.length >= MCP_TESTS.length) {
      this.finishTests();
    }
  }

  validateTestResponse(test, response) {
    const result = {
      name: test.name,
      description: test.description,
      status: 'unknown',
      duration: Date.now() - test.startTime,
      response: response,
      error: null
    };

    try {
      if (response.error) {
        if (test.expectError) {
          result.status = test.validate(response) ? 'passed' : 'failed';
          result.error = response.error.message;
        } else {
          result.status = 'failed';
          result.error = response.error.message;
        }
      } else {
        result.status = test.validate(response) ? 'passed' : 'failed';
        if (result.status === 'failed') {
          result.error = 'Response validation failed';
        }
      }
    } catch (error) {
      result.status = 'failed';
      result.error = `Validation error: ${error.message}`;
    }

    // Additional validation for specific tests
    if (test.expectedTools && result.status === 'passed') {
      const tools = response.result.tools.map(t => t.name);
      const missingTools = test.expectedTools.filter(tool => !tools.includes(tool));
      if (missingTools.length > 0) {
        result.status = 'failed';
        result.error = `Missing expected tools: ${missingTools.join(', ')}`;
      }
    }

    return result;
  }

  logTestResult(result) {
    const statusColor = result.status === 'passed' ? 'green' : 'red';
    const statusIcon = result.status === 'passed' ? '✅' : '❌';
    
    log('blue', `📋 ${result.name}:`);
    log('magenta', `   ${result.description}`);
    log(statusColor, `${statusIcon} ${result.status.toUpperCase()} (${result.duration}ms)`);
    
    if (result.error) {
      log('yellow', `   Error: ${result.error}`);
    }

    // Log additional details for successful tests
    if (result.status === 'passed' && !result.response.error) {
      this.logTestDetails(result);
    }
    
    console.log();
  }

  logTestDetails(result) {
    try {
      switch (result.name) {
        case 'List Available Tools':
          const tools = result.response.result.tools.map(t => t.name);
          log('cyan', `   Available tools: ${tools.join(', ')}`);
          break;
        
        case 'Get Player Summary':
          const content = result.response.result.content[0];
          const playerData = JSON.parse(content.text);
          log('cyan', `   Player: ${playerData.personaname} (ID: ${playerData.steamid})`);
          break;
        
        case 'Analyze Gaming Habits':
          const analysisContent = result.response.result.content[0];
          const analysisData = JSON.parse(analysisContent.text);
          log('cyan', `   Total hours: ${analysisData.analysis.totalHours}`);
          log('cyan', `   Games owned: ${analysisData.analysis.totalGames}`);
          break;
        
        case 'Get Game Recommendations':
          const recContent = result.response.result.content[0];
          const recData = JSON.parse(recContent.text);
          log('cyan', `   Recommendations: ${recData.recommendations.length}`);
          break;
      }
    } catch (error) {
      // Ignore detail logging errors
    }
  }

  async runTestsSequentially() {
    for (let i = 0; i < MCP_TESTS.length; i++) {
      const test = MCP_TESTS[i];
      await this.runSingleTest(test);
      
      // Wait a bit between tests
      if (i < MCP_TESTS.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Wait for any remaining responses
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    if (this.results.length < MCP_TESTS.length) {
      this.finishTests('❌ Some tests did not complete');
    }
  }

  async runSingleTest(test) {
    return new Promise((resolve) => {
      test.startTime = Date.now();
      
      // Set timeout for this specific test
      const testTimeout = setTimeout(() => {
        this.pendingRequests.delete(test.message.id);
        this.results.push({
          name: test.name,
          description: test.description,
          status: 'timeout',
          duration: Date.now() - test.startTime,
          error: 'Test timed out'
        });
        resolve();
      }, TEST_CONFIG.requestTimeout);

      // Store pending request
      this.pendingRequests.set(test.message.id, {
        test: test,
        timeout: testTimeout,
        resolve: resolve
      });

      // Send message to server
      const message = JSON.stringify(test.message) + '\n';
      this.server.stdin.write(message);
      
      log('blue', `🔄 Running: ${test.name}`);
    });
  }

  finishTests(customMessage) {
    if (this.testTimeout) {
      clearTimeout(this.testTimeout);
    }

    if (customMessage) {
      log('yellow', customMessage);
    }

    this.displayFinalResults();

    // Cleanup
    if (this.server && !this.server.killed) {
      this.server.kill('SIGTERM');
      setTimeout(() => {
        if (!this.server.killed) {
          this.server.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  displayFinalResults() {
    const totalTime = Date.now() - this.startTime;
    const passed = this.results.filter(r => r.status === 'passed').length;
    const failed = this.results.filter(r => r.status === 'failed').length;
    const timeouts = this.results.filter(r => r.status === 'timeout').length;
    const total = this.results.length;

    log('cyan', '\n📊 Final Test Results');
    log('cyan', '=====================');
    log('green', `✅ Passed: ${passed}/${total}`);
    log('red', `❌ Failed: ${failed}/${total}`);
    log('yellow', `⏰ Timeouts: ${timeouts}/${total}`);
    log('blue', `⏱️  Total Time: ${Math.round(totalTime / 1000)}s`);
    console.log();

    if (failed > 0 || timeouts > 0) {
      log('red', '❌ Failed/Timed Out Tests:');
      this.results
        .filter(r => r.status === 'failed' || r.status === 'timeout')
        .forEach(r => {
          log('red', `   • ${r.name}: ${r.error || 'Unknown error'}`);
        });
      console.log();
    }

    // Overall status
    if (passed === total && total > 0) {
      log('green', '🎉 ALL TESTS PASSED!');
      log('cyan', '🚀 Your MCP server is ready for Claude Desktop integration!');
      log('blue', '\n📋 Next Steps:');
      console.log('   1. Copy the generated claude_desktop_config.json to your Claude Desktop config');
      console.log('   2. Restart Claude Desktop');
      console.log('   3. Test the tools in Claude Desktop with prompts like:');
      console.log('      "Analyze gaming habits for Steam ID 76561197960435530"');
    } else {
      log('red', '💥 SOME TESTS FAILED');
      log('yellow', '🔧 Please fix the issues above before proceeding');
    }

    // Exit with appropriate code
    const success = failed === 0 && timeouts === 0;
    setTimeout(() => process.exit(success ? 0 : 1), 1000);
  }
}

// Main execution
async function main() {
  const tester = new MCPServerTester();
  await tester.runAllTests();
}

// Error handling
process.on('unhandledRejection', (error) => {
  log('red', `💥 Unhandled rejection: ${error.message}`);
  process.exit(1);
});

process.on('SIGINT', () => {
  log('yellow', '\n🛑 Tests interrupted by user');
  process.exit(1);
});

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    log('red', `💥 Test suite failed: ${error.message}`);
    process.exit(1);
  });
}