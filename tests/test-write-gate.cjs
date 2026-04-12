'use strict';
const assert = require('assert');

function testWriteGate() {
  const { WriteGate } = require('../src/core/write-gate.cjs');
  const gate = new WriteGate();

  // Test 1: Behavior-changing insight passes
  assert(gate.shouldPersist({
    content: 'Always validate JWT expiry before checking permissions',
    type: 'insight',
    confidence: 0.8,
  }), 'Behavior-changing insight should pass');

  // Test 2: Trivial observation fails
  assert(!gate.shouldPersist({
    content: 'Ran npm test',
    type: 'skill',
    confidence: 0.3,
  }), 'Trivial observation should not pass');

  // Test 3: Explicit "remember this" always passes
  assert(gate.shouldPersist({
    content: 'Remember: use UTC timestamps everywhere',
    type: 'general',
    confidence: 0.5,
    explicitRemember: true,
  }), 'Explicit remember request always passes');

  // Test 4: Decision with rationale passes
  assert(gate.shouldPersist({
    content: 'Chose PostgreSQL over MongoDB because we need ACID transactions for financial data',
    type: 'decision',
    confidence: 0.7,
  }), 'Decision with rationale passes');

  // Test 5: Low-confidence duplicate fails
  assert(!gate.shouldPersist({
    content: 'installed dependencies',
    type: 'skill',
    confidence: 0.2,
  }), 'Low-confidence generic action fails');

  // Test 6: Commitment passes
  assert(gate.shouldPersist({
    content: 'Promised to refactor the auth module by Friday',
    type: 'learning',
    confidence: 0.6,
  }), 'Commitment should pass');

  // Test 7: Stable fact passes
  assert(gate.shouldPersist({
    content: 'The API rate limit is 1000 requests per minute per user',
    type: 'learning',
    confidence: 0.7,
  }), 'Stable fact should pass');

  console.log('All write gate tests passed');
}

testWriteGate();
