// Test script for Baileys integration
import fs from 'node:fs';
import path from 'node:path';

console.log('Testing WaBridge Baileys Integration...');

// Import config with proper relative path from scripts directory
import { config, DATA_DIR, ROOT } from '../server/config.js';

// Test 1: Check if data directory exists
console.log('\n1. Checking data directory...');
const dataDir = DATA_DIR;
console.log(`Data directory: ${dataDir}`);

if (!dataDir) {
  console.log('⚠ DATA_DIR is undefined, checking if data directory exists locally...');
  const localDataDir = path.join(ROOT, 'data');
  if (fs.existsSync(localDataDir)) {
    console.log('✓ Local data directory exists');
  } else {
    console.log('✗ Data directory does not exist');
    process.exit(1);
  }
}

if (fs.existsSync(dataDir)) {
  console.log('✓ Data directory exists');
} else {
  console.log('✗ Data directory does not exist');
  process.exit(1);
}

// Test 2: Check if sessions directory exists
console.log('\n2. Checking sessions directory...');
let sessionsDir;
if (dataDir) {
  sessionsDir = path.join(dataDir, 'sessions');
} else {
  const localDataDir = './data';
  sessionsDir = path.join(localDataDir, 'sessions');
}
console.log(`Sessions directory: ${sessionsDir}`);

if (fs.existsSync(sessionsDir)) {
  console.log('✓ Sessions directory exists');
} else {
  console.log('✗ Sessions directory does not exist');
}

// Test 3: Check package.json for dependencies
console.log('\n3. Checking package.json for Baileys dependencies...');
const packageJsonPath = path.join(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const requiredDeps = ['@whiskeysockets/baileys', 'qrcode', '@hapi/boom', 'pino'];
const missingDeps = [];

for (const dep of requiredDeps) {
  if (packageJson.dependencies && packageJson.dependencies[dep]) {
    console.log(`✓ ${dep} is in dependencies`);
  } else if (packageJson.devDependencies && packageJson.devDependencies[dep]) {
    console.log(`✓ ${dep} is in devDependencies`);
  } else {
    missingDeps.push(dep);
    console.log(`✗ ${dep} is missing`);
  }
}

if (missingDeps.length > 0) {
  console.log(`\nMissing dependencies: ${missingDeps.join(', ')}`);
  process.exit(1);
}

// Test 4: Check critical files
console.log('\n4. Checking critical files...');
const criticalFiles = [
  './server/index.js',
  './server/config.js',
  './server/db.js',
  './server/services/baileys.js',
  './server/services/openwa.js',
  './server/routes/numbers.js',
  './server/services/messaging.js',
  './server/services/meta.js',
  './server/services/automation.js',
  './server/services/outbound.js',
  './server/services/events.js',
];

const missingFiles = [];
for (const file of criticalFiles) {
  if (fs.existsSync(file)) {
    console.log(`✓ ${file} exists`);
  } else {
    missingFiles.push(file);
    console.log(`✗ ${file} is missing`);
  }
}

if (missingFiles.length > 0) {
  console.log(`\nMissing critical files: ${missingFiles.join(', ')}`);
  process.exit(1);
}

// Test 5: Check environment variables
console.log('\n5. Checking environment variables...');
const envVars = ['PORT', 'HOST', 'DATA_DIR', 'OPENWA_URL'];
for (const varName of envVars) {
  if (process.env[varName]) {
    console.log(`✓ ${varName} is set`);
  } else {
    console.log(`⚠ ${varName} is not set (will use defaults)`);
  }
}

console.log('\n6. Testing Baileys engine initialization...');
try {
  // This will test if Baileys can be imported
  const { makeWASocket, useMultiFileAuthState } = await import('@whiskeysockets/baileys');
  console.log('✓ Baileys can be imported successfully');
} catch (error) {
  console.log(`✗ Failed to import Baileys: ${error.message}`);
  process.exit(1);
}

console.log('\n✅ All tests passed! Baileys integration is ready.');
console.log('\nTo start the embedded Baileys engine:');
console.log('  1. Set USE_EXTERNAL_OPENWA=false in environment (or remove it)');
console.log('  2. Run: npm start');
console.log('  3. Navigate to /numbers in your browser to add a WhatsApp number');