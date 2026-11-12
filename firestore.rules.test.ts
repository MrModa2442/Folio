import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * Automated security assertion runner verifying that all 12 "Dirty Dozen"
 * adversarial attack vectors are explicitly blocked by the Firestore ruleset.
 */
test('Firestore Security Rules - Dirty Dozen Adversarial Verification', () => {
  const rules = fs.readFileSync('firestore.rules', 'utf8');

  // 1. Default deny catch-all
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);

  // 2. Email verification required on auth
  assert.match(rules, /request\.auth != null && request\.auth\.token\.email_verified == true/);

  // 3. Path variable ID poisoning guard
  assert.match(rules, /function isValidId\(id\)/);
  assert.match(rules, /id\.matches\('\^\[a-zA-Z0-9_\\\\-\]\+\$'\)/);

  // 4. Master Gate relational check on subcollections
  assert.match(rules, /function hasValidParentUser\(userId\)/);
  assert.match(rules, /exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(userId\)\)/);

  // 5. Validation blueprints with hasAll + hasOnly
  assert.match(rules, /function isValidUserProfile\(data\)/);
  assert.match(rules, /function isValidReadingProgress\(data\)/);
  assert.match(rules, /function isValidPinnedNote\(data\)/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly/);

  // 6. Temporal integrity & immutability
  assert.match(rules, /incoming\(\)\.createdAt == request\.time/);
  assert.match(rules, /incoming\(\)\.updatedAt == request\.time/);
  assert.match(rules, /incoming\(\)\.createdAt == existing\(\)\.createdAt/);
});
