#!/usr/bin/env node

/**
 * Complete Test Runner for Steam MCP Server
 * Runs both Steam API tests and MCP server integration tests
 * Usage: node test-all.js [--steam-only] [--mcp-only] [--help]
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

// Load environment variables from parent directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname); // Go up one directory from tests/
config({ path: join(projectRoot, '.env') });

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bright: '\x1b[1m',
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logBright(color, message) {
  console.log(`${colors.bright}${colors[color]}${message}${colors.reset}`);
}

// Command line argument parsing
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    steamOnly: false,
    mcpOnly: false,
    help: false,
    verbose: false,
  };

  for (const arg of args) {
    switch (arg) {
      case '--steam-only':
        options.steamOnly = true;
        break;
      case '--mcp-only':
        options.mcpOnly = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (arg.startsWith('--')) {
          log('red', `Unknown option: ${arg}`);
          options.help = true;
        }
    }
  }

  return options;
}

function showHelp() {
  logBright('cyan', '🧪 Steam MCP Server Test Suite');
  console.log('');
  console.log('Usage: node test-all.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --steam-only    Run only Steam API connectivity tests');
  console.log('  --mcp-only      Run only MCP server integration tests');
  console.log('  --verbose, -v   Enable verbose output');
  console.log('  --help, -h      Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  node test-all.js                    # Run all tests');
  console.log('  node test-all.js --steam-only       # Test Steam API only');
  console.log('  node test-all.js --mcp-only         # Test MCP server only');
  console.log('  node test-all.js --verbose          # Run with detailed output');
  console.log('');
}

// Test runner utilities
function runTestScript(scriptPath, description) {
  return new Promise((resolve) => {
    log('blue', `🚀 Starting: ${description}`);
    console.log('━'.repeat(60));
    
    const child = spawn('node', [scriptPath], {
      stdio: 'inherit',
      env: process.env
    });

    let completed = false;
    
    child.on('exit', (code) => {
      if (!completed) {
        completed = true;
        console.log('━'.repeat(60));
        if (code === 0) {
          log('green', `✅ ${description} - PASSED`);
        } else {
          log('red', `❌ ${description} - FAILED (exit code: ${code})`);
        }
        console.log();
        resolve(code === 0);
      }
    });

    child.on('error', (error) => {
      if (!completed) {
        completed = true;
        console.log('━'.repeat(60));
        log('red', `❌ ${description} - ERROR: ${error.message}`);
        console.log();
        resolve(false);
      }
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      if (!completed) {
        completed = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
        console.log('━'.repeat(60));
        log('red', `❌ ${description} - TIMEOUT (2 minutes)`);
        console.log();
        resolve(false);
      }
    }, 120000);
  });
}

// Main test orchestrator
class TestOrchestrator {
  constructor(options) {
    this.options = options;
    this.results = [];
    this.startTime = Date.now();
  }

  async runAllTests() {
    logBright('cyan', '🎮 Steam MCP Server - Complete Test Suite');
    logBright('cyan', '==========================================');
    console.log();

    // Show configuration
    this.showConfiguration();

    // Run tests based on options
    if (!this.options.mcpOnly) {
      const steamResult = await this.runSteamTests();
      this.results.push({ name: 'Steam API Tests', success: steamResult });
      
      if (!steamResult) {
        log('yellow', '⚠️  Steam API tests failed. MCP server tests may not work properly.');
        console.log();
      }
    }

    if (!this.options.steamOnly) {
      const mcpResult = await this.runMCPTests();
      this.results.push({ name: 'MCP Server Tests', success: mcpResult });
    }

    // Show final results
    this.showFinalSummary();
  }

  showConfiguration() {
    log('blue', '🔧 Test Configuration:');
    console.log(`   Steam API Key: ${process.env.STEAM_API_KEY ? '✅ Set' : '❌ Missing'}`);
    console.log(`   Node Version: ${process.version}`);
    console.log(`   Test Mode: ${this.getTestMode()}`);
    console.log(`   Verbose: ${this.options.verbose ? 'Enabled' : 'Disabled'}`);
    console.log();
  }

  getTestMode() {
    if (this.options.steamOnly) return 'Steam API Only';
    if (this.options.mcpOnly) return 'MCP Server Only';
    return 'Full Test Suite';
  }

  async runSteamTests() {
    const scriptPath = join(__dirname, 'test-steam-api.js');
    return await runTestScript(scriptPath, 'Steam API Connectivity Tests');
  }

  async runMCPTests() {
    const scriptPath = join(__dirname, 'test-mcp-server.js');
    return await runTestScript(scriptPath, 'MCP Server Integration Tests');
  }

  showFinalSummary() {
    const totalTime = Math.round((Date.now() - this.startTime) / 1000);
    const passed = this.results.filter(r => r.success).length;
    const failed = this.results.filter(r => !r.success).length;
    const total = this.results.length;

    logBright('cyan', '🏁 Final Test Summary');
    logBright('cyan', '====================');
    console.log();

    // Individual results
    this.results.forEach(result => {
      const icon = result.success ? '✅' : '❌';
      const color = result.success ? 'green' : 'red';
      log(color, `${icon} ${result.name}`);
    });

    console.log();
    logBright('blue', `📊 Overall Results: ${passed}/${total} test suites passed`);
    logBright('blue', `⏱️  Total Time: ${totalTime}s`);
    console.log();

    if (passed === total && total > 0) {
      this.showSuccessMessage();
    } else {
      this.showFailureMessage();
    }
  }

  showSuccessMessage() {
    logBright('green', '🎉 ALL TESTS PASSED!');
    console.log();
    log('cyan', '🚀 Your Steam MCP Server is fully functional and ready to use!');
    console.log();
    log('blue', '📋 Next Steps:');
    console.log('   1. Integration with Claude Desktop:');
    console.log('      • Copy claude_desktop_config.json to your Claude Desktop config');
    console.log('      • Restart Claude Desktop');
    console.log('      • Look for the MCP server indicator (hammer icon)');
    console.log();
    console.log('   2. Test in Claude Desktop with these prompts:');
    console.log('      • "Analyze gaming habits for Steam ID 76561197960435530"');
    console.log('      • "Get game recommendations for Steam ID 76561197960435530"');
    console.log('      • "Get player summary for Steam ID 76561197960435530"');
    console.log();
    console.log('   3. Use with your own Steam ID:');
    console.log('      • Find your Steam ID at steamidfinder.com');
    console.log('      • Make sure your profile is public for full functionality');
    console.log();
    log('magenta', '💡 Pro Tips:');
    console.log('   • The server respects Steam API rate limits automatically');
    console.log('   • Private profiles will return limited data');
    console.log('   • Achievement data may be private even on public profiles');
    console.log('   • The server includes caching to improve performance');
  }

  showFailureMessage() {
    logBright('red', '💥 SOME TESTS FAILED');
    console.log();
    log('yellow', '🔧 Troubleshooting Guide:');
    
    const failedSuites = this.results.filter(r => !r.success);
    
    if (failedSuites.some(r => r.name.includes('Steam API'))) {
      console.log();
      log('red', '   Steam API Issues:');
      console.log('   • Check your Steam API key in .env file');
      console.log('   • Verify the key format (32 hexadecimal characters)');
      console.log('   • Test network connectivity to api.steampowered.com');
      console.log('   • Check Steam API status at steamstat.us');
    }

    if (failedSuites.some(r => r.name.includes('MCP'))) {
      console.log();
      log('red', '   MCP Server Issues:');
      console.log('   • Ensure the project built successfully (npm run build)');
      console.log('   • Check that dist/index.js exists');
      console.log('   • Verify Node.js version is 18 or higher');
      console.log('   • Check for any compilation errors');
    }

    console.log();
    log('blue', '🆘 Getting Help:');
    console.log('   • Re-run tests with --verbose for detailed output');
    console.log('   • Check the individual test outputs above');
    console.log('   • Verify all prerequisites are met');
    console.log('   • Try running tests individually:');
    console.log('     - node test-steam-api.js');
    console.log('     - node test-mcp-server.js');
  }
}

// Validation functions
function validateEnvironment() {
  const issues = [];

  if (!process.env.STEAM_API_KEY) {
    issues.push('STEAM_API_KEY environment variable not set');
  } else if (!/^[A-F0-9]{32}$/i.test(process.env.STEAM_API_KEY)) {
    issues.push('STEAM_API_KEY format is invalid (should be 32 hex characters)');
  }

  const nodeVersion = parseInt(process.version.slice(1));
  if (nodeVersion < 18) {
    issues.push(`Node.js 18+ required (current: ${process.version})`);
  }

  return issues;
}

// Quick setup check
function checkProjectSetup() {
  const issues = [];
  const projectRoot = dirname(__dirname); // Go up one directory from tests/

  try {
    const packageJsonPath = join(projectRoot, 'package.json');
    const packageJson = JSON.parse(require('fs').readFileSync(packageJsonPath, 'utf8'));
    if (!packageJson.dependencies?.['@modelcontextprotocol/sdk']) {
      issues.push('MCP SDK not installed (run: npm install)');
    }
  } catch (error) {
    issues.push('package.json not found or invalid');
  }

  const distPath = join(projectRoot, 'dist', 'index.js');
  if (!require('fs').existsSync(distPath)) {
    issues.push('Project not built (run: npm run build)');
  }

  const envPath = join(projectRoot, '.env');
  if (!require('fs').existsSync(envPath) && !process.env.STEAM_API_KEY) {
    issues.push('.env file missing (copy from .env.example and add your Steam API key)');
  }

  return issues;
}

// Main execution
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    return;
  }

  // Pre-flight checks
  log('blue', '🔍 Pre-flight checks...');
  
  const envIssues = validateEnvironment();
  const setupIssues = checkProjectSetup();
  const allIssues = [...envIssues, ...setupIssues];

  if (allIssues.length > 0) {
    log('red', '❌ Pre-flight check failed:');
    allIssues.forEach(issue => {
      console.log(`   • ${issue}`);
    });
    console.log();
    log('yellow', '🔧 Please fix the above issues before running tests');
    process.exit(1);
  }

  log('green', '✅ Pre-flight checks passed');
  console.log();

  // Run tests
  const orchestrator = new TestOrchestrator(options);
  await orchestrator.runAllTests();
}

// Error handling
process.on('unhandledRejection', (error) => {
  log('red', `💥 Unhandled rejection: ${error.message}`);
  process.exit(1);
});

process.on('SIGINT', () => {
  log('yellow', '\n🛑 Test suite interrupted by user');
  process.exit(1);
});

// Export for potential use as module
export default TestOrchestrator;

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    log('red', `💥 Test suite failed: ${error.message}`);
    process.exit(1);
  });
}