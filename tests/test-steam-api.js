#!/usr/bin/env node

/**
 * Steam API Connectivity Test
 * Tests direct Steam API calls before testing the MCP server
 * Run: node test-steam-api.js
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables from parent directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname); // Go up one directory from tests/
config({ path: join(projectRoot, '.env') });

// Test configuration
const TEST_CONFIG = {
  apiKey: process.env.STEAM_API_KEY,
  baseUrl: 'https://api.steampowered.com',
  testSteamIds: [
    '76561197960435530', // Robin Walker (Valve employee)
    '76561198043441711', // Another known public profile
  ],
  timeout: 10000,
};

// ANSI colors for console output
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

// Test cases for Steam API endpoints
const STEAM_API_TESTS = [
  {
    name: 'Get Player Summaries',
    endpoint: '/ISteamUser/GetPlayerSummaries/v0002/',
    params: { steamids: TEST_CONFIG.testSteamIds[0] },
    validate: (data) => data.response?.players?.length > 0,
    description: 'Retrieves basic player profile information'
  },
  {
    name: 'Get Owned Games',
    endpoint: '/IPlayerService/GetOwnedGames/v0001/',
    params: { 
      steamid: TEST_CONFIG.testSteamIds[0],
      include_appinfo: true,
      include_played_free_games: true 
    },
    validate: (data) => data.response && Array.isArray(data.response.games),
    description: 'Retrieves list of games owned by player'
  },
  {
    name: 'Get Recently Played Games',
    endpoint: '/IPlayerService/GetRecentlyPlayedGames/v0001/',
    params: { 
      steamid: TEST_CONFIG.testSteamIds[0],
      count: 5 
    },
    validate: (data) => data.response && Array.isArray(data.response.games),
    description: 'Retrieves recently played games'
  },
  {
    name: 'Get Friend List',
    endpoint: '/ISteamUser/GetFriendList/v0001/',
    params: { 
      steamid: TEST_CONFIG.testSteamIds[0],
      relationship: 'friend' 
    },
    validate: (data) => data.friendslist && Array.isArray(data.friendslist.friends),
    description: 'Retrieves player friend list (if public)'
  },
  {
    name: 'Get Player Achievements (TF2)',
    endpoint: '/ISteamUserStats/GetPlayerAchievements/v0001/',
    params: { 
      steamid: TEST_CONFIG.testSteamIds[0],
      appid: 440 // Team Fortress 2
    },
    validate: (data) => data.playerstats,
    description: 'Retrieves player achievements for Team Fortress 2',
    allowFailure: true // Achievements might be private
  }
];

class SteamAPITester {
  constructor() {
    this.results = [];
    this.startTime = Date.now();
  }

  async runAllTests() {
    log('cyan', '🧪 Steam API Connectivity Test Suite');
    log('cyan', '=====================================\n');

    // Validate prerequisites
    if (!this.validatePrerequisites()) {
      return;
    }

    // Run all tests
    for (const test of STEAM_API_TESTS) {
      await this.runTest(test);
    }

    // Display results
    this.displayResults();
  }

  validatePrerequisites() {
    log('blue', '🔍 Validating prerequisites...');

    if (!TEST_CONFIG.apiKey) {
      log('red', '❌ STEAM_API_KEY not found in environment variables');
      log('yellow', '   Please set STEAM_API_KEY in your .env file');
      return false;
    }

    if (!/^[A-F0-9]{32}$/i.test(TEST_CONFIG.apiKey)) {
      log('red', '❌ Invalid Steam API key format');
      log('yellow', '   Steam API keys should be 32 hexadecimal characters');
      return false;
    }

    log('green', '✅ Prerequisites validated');
    log('blue', `📊 Testing with Steam ID: ${TEST_CONFIG.testSteamIds[0]}`);
    console.log();
    return true;
  }

  async runTest(test) {
    const startTime = Date.now();
    log('blue', `🔄 Testing: ${test.name}`);
    log('magenta', `   ${test.description}`);

    try {
      const url = new URL(test.endpoint, TEST_CONFIG.baseUrl);
      url.searchParams.append('key', TEST_CONFIG.apiKey);
      url.searchParams.append('format', 'json');
      
      // Add test-specific parameters
      Object.entries(test.params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TEST_CONFIG.timeout);

      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Steam-API-Test/1.0'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const duration = Date.now() - startTime;

      // Validate response
      if (test.validate(data)) {
        log('green', `✅ PASSED (${duration}ms)`);
        this.logResponseSummary(data, test.name);
        this.results.push({ test: test.name, status: 'passed', duration, data });
      } else {
        if (test.allowFailure) {
          log('yellow', `⚠️  EXPECTED FAILURE (${duration}ms) - Data might be private`);
          this.results.push({ test: test.name, status: 'expected_failure', duration, data });
        } else {
          log('red', `❌ FAILED (${duration}ms) - Invalid response format`);
          console.log('Response:', JSON.stringify(data, null, 2));
          this.results.push({ test: test.name, status: 'failed', duration, error: 'Invalid response format' });
        }
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (test.allowFailure && (error.message.includes('403') || error.message.includes('private'))) {
        log('yellow', `⚠️  EXPECTED FAILURE (${duration}ms) - ${error.message}`);
        this.results.push({ test: test.name, status: 'expected_failure', duration, error: error.message });
      } else {
        log('red', `❌ FAILED (${duration}ms) - ${error.message}`);
        this.results.push({ test: test.name, status: 'failed', duration, error: error.message });
      }
    }

    console.log();
  }

  logResponseSummary(data, testName) {
    try {
      switch (testName) {
        case 'Get Player Summaries':
          const player = data.response.players[0];
          log('cyan', `   Player: ${player.personaname} (${player.profileurl})`);
          break;
        
        case 'Get Owned Games':
          const gameCount = data.response.game_count || data.response.games?.length || 0;
          log('cyan', `   Games owned: ${gameCount}`);
          break;
        
        case 'Get Recently Played Games':
          const recentCount = data.response.total_count || data.response.games?.length || 0;
          log('cyan', `   Recently played: ${recentCount} games`);
          break;
        
        case 'Get Friend List':
          const friendCount = data.friendslist?.friends?.length || 0;
          log('cyan', `   Friends: ${friendCount}`);
          break;
        
        case 'Get Player Achievements (TF2)':
          const achievementCount = data.playerstats?.achievements?.length || 0;
          log('cyan', `   TF2 Achievements: ${achievementCount}`);
          break;
      }
    } catch (error) {
      // Ignore summary errors
    }
  }

  displayResults() {
    const totalTime = Date.now() - this.startTime;
    const passed = this.results.filter(r => r.status === 'passed').length;
    const failed = this.results.filter(r => r.status === 'failed').length;
    const expectedFailures = this.results.filter(r => r.status === 'expected_failure').length;
    const total = this.results.length;

    log('cyan', '📊 Test Results Summary');
    log('cyan', '=======================');
    log('green', `✅ Passed: ${passed}`);
    log('red', `❌ Failed: ${failed}`);
    log('yellow', `⚠️  Expected Failures: ${expectedFailures}`);
    log('blue', `📈 Total Time: ${totalTime}ms`);
    console.log();

    if (failed > 0) {
      log('red', '❌ Failed Tests:');
      this.results
        .filter(r => r.status === 'failed')
        .forEach(r => {
          log('red', `   • ${r.test}: ${r.error}`);
        });
      console.log();
    }

    if (passed > 0) {
      log('cyan', '🎯 Steam API Connectivity: WORKING');
      log('green', '🚀 Your Steam API integration is ready for MCP server testing!');
    } else {
      log('red', '💥 Steam API Connectivity: FAILED');
      log('yellow', '🔧 Fix the above issues before testing the MCP server');
    }

    // API rate limit info
    log('blue', '\n📋 API Usage Notes:');
    console.log('   • Steam Web API has rate limits (be mindful of request frequency)');
    console.log('   • Some data requires public profiles (privacy settings affect results)');
    console.log('   • Achievement data may be private even on public profiles');
    console.log('   • Friend lists are often private by default');

    return failed === 0;
  }
}

// Performance test
async function performanceTest() {
  log('cyan', '\n⚡ Performance Test');
  log('cyan', '==================');

  const testUrl = `${TEST_CONFIG.baseUrl}/ISteamUser/GetPlayerSummaries/v0002/?key=${TEST_CONFIG.apiKey}&steamids=${TEST_CONFIG.testSteamIds[0]}&format=json`;
  const times = [];

  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    try {
      const response = await fetch(testUrl);
      await response.json();
      const duration = Date.now() - start;
      times.push(duration);
      log('blue', `   Request ${i + 1}: ${duration}ms`);
    } catch (error) {
      log('red', `   Request ${i + 1}: Error - ${error.message}`);
    }
  }

  if (times.length > 0) {
    const avgTime = Math.round(times.reduce((a, b) => a + b) / times.length);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    
    log('cyan', `   Average: ${avgTime}ms | Min: ${minTime}ms | Max: ${maxTime}ms`);
  }
}

// Main execution
async function main() {
  const tester = new SteamAPITester();
  const success = await tester.runAllTests();
  
  if (success) {
    await performanceTest();
  }

  process.exit(success ? 0 : 1);
}

// Error handling
process.on('unhandledRejection', (error) => {
  log('red', `💥 Unhandled rejection: ${error.message}`);
  process.exit(1);
});

process.on('SIGINT', () => {
  log('yellow', '\n🛑 Test interrupted by user');
  process.exit(1);
});

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    log('red', `💥 Test failed: ${error.message}`);
    process.exit(1);
  });
}