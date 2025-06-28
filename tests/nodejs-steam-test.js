#!/usr/bin/env node

/**
 * Steam API Test using Node.js built-in modules
 * Alternative test using https module instead of fetch
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import https from 'https';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);
config({ path: join(projectRoot, '.env') });

console.log('🔧 Node.js Built-in Steam API Test');
console.log('===================================');
console.log('Steam API Key:', process.env.STEAM_API_KEY ? 'Present' : 'Missing');
console.log('');

function testSteamAPIWithHttps() {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.STEAM_API_KEY;
    const testSteamId = '76561197960435530';
    
    console.log('🚀 Testing Steam API with Node.js https module...');
    
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${testSteamId}&format=json`;
    
    console.log('📡 Making HTTPS request...');
    
    const request = https.get(url, {
      headers: {
        'User-Agent': 'Steam-Test-Nodejs/1.0'
      },
      timeout: 10000
    }, (response) => {
      console.log('📊 Response status:', response.statusCode);
      console.log('📊 Response headers received');
      
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
        console.log('📦 Received chunk, total length:', data.length);
      });
      
      response.on('end', () => {
        console.log('✅ Response completed, total length:', data.length);
        
        try {
          const jsonData = JSON.parse(data);
          
          if (jsonData.response?.players?.length > 0) {
            const player = jsonData.response.players[0];
            console.log('👤 Player found:', player.personaname);
            console.log('🔗 Profile URL:', player.profileurl);
            console.log('✅ Steam API test PASSED');
            resolve(true);
          } else {
            console.log('❌ No player data found');
            resolve(false);
          }
        } catch (parseError) {
          console.log('❌ JSON parse error:', parseError.message);
          console.log('Raw response:', data.substring(0, 200));
          reject(parseError);
        }
      });
    });
    
    request.on('error', (error) => {
      console.log('❌ Request error:', error.message);
      console.log('Error code:', error.code);
      reject(error);
    });
    
    request.on('timeout', () => {
      console.log('⏰ Request timed out');
      request.destroy();
      reject(new Error('Request timeout'));
    });
    
    // Additional safety timeout
    const safetyTimeout = setTimeout(() => {
      console.log('⏰ Safety timeout reached');
      request.destroy();
      reject(new Error('Safety timeout'));
    }, 15000);
    
    request.on('close', () => {
      clearTimeout(safetyTimeout);
    });
  });
}

// Run the test
console.log('Node.js version:', process.version);
console.log('');

testSteamAPIWithHttps()
  .then((success) => {
    console.log('');
    console.log('🏁 Test completed, success:', success);
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.log('');
    console.log('💥 Test failed:', error.message);
    console.log('Stack:', error.stack);
    process.exit(1);
  });

// Global safety timeout
setTimeout(() => {
  console.log('');
  console.log('⏰ Global timeout after 30 seconds');
  process.exit(1);
}, 30000);