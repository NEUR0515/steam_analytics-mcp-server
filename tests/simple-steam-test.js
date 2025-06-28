#!/usr/bin/env node

/**
 * Simple Steam API Test
 * Minimal test to isolate the hanging issue
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);
config({ path: join(projectRoot, '.env') });

console.log('🔧 Simple Steam API Test');
console.log('========================');
console.log('Steam API Key:', process.env.STEAM_API_KEY ? 'Present' : 'Missing');
console.log('Steam API Key Length:', process.env.STEAM_API_KEY?.length);
console.log('');

async function testSteamAPI() {
  const apiKey = process.env.STEAM_API_KEY;
  const testSteamId = '76561197960435530';
  
  console.log('🚀 Testing Steam API...');
  
  const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${testSteamId}&format=json`;
  
  try {
    console.log('📡 Making API request...');
    
    // Use fetch with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log('⏰ Request timed out after 10 seconds');
      controller.abort();
    }, 10000);
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Steam-Test/1.0'
      }
    });
    
    clearTimeout(timeoutId);
    
    console.log('📊 Response status:', response.status);
    console.log('📊 Response ok:', response.ok);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    console.log('✅ API Response received');
    console.log('📄 Response keys:', Object.keys(data));
    
    if (data.response?.players?.length > 0) {
      const player = data.response.players[0];
      console.log('👤 Player found:', player.personaname);
      console.log('🔗 Profile URL:', player.profileurl);
      console.log('✅ Steam API test PASSED');
    } else {
      console.log('❌ No player data found');
    }
    
  } catch (error) {
    console.log('❌ Steam API test FAILED');
    console.error('Error:', error.message);
    
    if (error.name === 'AbortError') {
      console.log('💡 The request was aborted due to timeout');
    } else if (error.code === 'ENOTFOUND') {
      console.log('💡 DNS resolution failed - check your internet connection');
    } else if (error.code === 'ECONNREFUSED') {
      console.log('💡 Connection refused - check firewall settings');
    }
  }
}

// Test if fetch is available
console.log('🔍 Checking fetch availability...');
if (typeof fetch === 'undefined') {
  console.log('❌ fetch is not available in this Node.js version');
  console.log('💡 You need Node.js 18+ or install node-fetch');
  process.exit(1);
} else {
  console.log('✅ fetch is available');
}

console.log('');

// Run the test
testSteamAPI()
  .then(() => {
    console.log('');
    console.log('🏁 Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.log('');
    console.log('💥 Test failed:', error.message);
    process.exit(1);
  });

// Safety timeout
setTimeout(() => {
  console.log('');
  console.log('⏰ Overall test timeout after 30 seconds');
  process.exit(1);
}, 30000);