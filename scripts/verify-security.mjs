import fs from 'fs';
import path from 'path';
import assert from 'assert';

console.log('Running Security Verification Tests...');

const rootDir = process.cwd();

// Test 1: Content Security Policy in index.html
try {
  const indexPath = path.join(rootDir, 'index.html');
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  
  assert.ok(indexContent.includes('http-equiv="Content-Security-Policy"'), 'Content-Security-Policy meta tag is missing in index.html');
  assert.ok(indexContent.includes("connect-src 'self'"), 'CSP is missing self connection source');
  assert.ok(indexContent.includes("https://api.anthropic.com"), 'CSP is missing api.anthropic.com source');
  
  console.log('✓ Test 1 Passed: Content Security Policy present in index.html');
} catch (err) {
  console.error('✗ Test 1 Failed:', err.message);
  process.exit(1);
}

// Test 2: XSS Escape functions and integrations in src/main.js
try {
  const mainPath = path.join(rootDir, 'src', 'main.js');
  const mainContent = fs.readFileSync(mainPath, 'utf8');
  
  assert.ok(mainContent.includes('function escapeHtml'), 'escapeHtml helper is missing in src/main.js');
  assert.ok(mainContent.includes('escapeHtml(title)'), 'Toast title is not escaped against XSS in src/main.js');
  assert.ok(mainContent.includes('escapeHtml(message)'), 'Toast message is not escaped against XSS in src/main.js');
  assert.ok(mainContent.includes('escapeHtml(tx.merchant)'), 'Transaction merchant name is not escaped against XSS in src/main.js');
  assert.ok(mainContent.includes('escapeHtml(card.name)'), 'Card name is not escaped against XSS in src/main.js');
  
  console.log('✓ Test 2 Passed: DOM rendering variables escaped for XSS prevention in src/main.js');
} catch (err) {
  console.error('✗ Test 2 Failed:', err.message);
  process.exit(1);
}

// Test 3: Local firestore.rules checks
try {
  const rulesPath = path.join(rootDir, 'firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');
  
  assert.ok(rulesContent.includes('match /users/{userId}'), 'Firestore rules missing user document match block');
  assert.ok(rulesContent.includes('match /cards/{cardId}'), 'Firestore rules missing cards sub-collection match block');
  assert.ok(rulesContent.includes('match /transactions/{txId}'), 'Firestore rules missing transactions sub-collection match block');
  assert.ok(rulesContent.includes('request.auth.uid == userId'), 'Firestore rules do not enforce owner checks (request.auth.uid == userId)');
  
  console.log('✓ Test 3 Passed: local firestore.rules protects all cards and transactions sub-collections');
} catch (err) {
  console.error('✗ Test 3 Failed:', err.message);
  process.exit(1);
}

console.log('\nAll security verification tests completed successfully!');
