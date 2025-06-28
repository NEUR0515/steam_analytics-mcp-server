import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

console.log('Script started...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);

console.log('Paths resolved...');
console.log('Project root:', projectRoot);

config({ path: join(projectRoot, '.env') });

console.log('Environment loaded...');
console.log('Steam API Key exists:', !!process.env.STEAM_API_KEY);
console.log('Steam API Key length:', process.env.STEAM_API_KEY?.length);

console.log('Test completed successfully!');