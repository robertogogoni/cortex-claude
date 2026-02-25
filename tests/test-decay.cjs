'use strict';
const assert = require('assert');

function testConfidenceDecay() {
  const { calculateDecay, DECAY_HALF_LIVES, MINIMUM_CONFIDENCE_FLOORS } = require('../core/confidence-decay.cjs');

  // Test 1: Fresh memory has no decay
  const fresh = {
    type: 'learning',
    extractionConfidence: 0.8,
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
  };
  const freshDecay = calculateDecay(fresh);
  assert(freshDecay > 0.79, `Fresh memory should have minimal decay, got ${freshDecay}`);

  // Test 2: 30-day-old learning decays to ~50% (half-life = 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const oldLearning = {
    type: 'learning',
    extractionConfidence: 0.8,
    createdAt: thirtyDaysAgo,
    lastUsed: thirtyDaysAgo,
  };
  const oldDecay = calculateDecay(oldLearning);
  assert(oldDecay >= 0.35 && oldDecay <= 0.45, `30-day learning should decay to ~0.4, got ${oldDecay}`);

  // Test 3: Decisions decay slower (90-day half-life)
  const oldDecision = {
    type: 'decision',
    extractionConfidence: 0.8,
    createdAt: thirtyDaysAgo,
    lastUsed: thirtyDaysAgo,
  };
  const decisionDecay = calculateDecay(oldDecision);
  assert(decisionDecay > oldDecay, `Decisions should decay slower than learnings: ${decisionDecay} vs ${oldDecay}`);

  // Test 4: Minimum floor prevents total loss
  const veryOld = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const ancientMemory = {
    type: 'decision',
    extractionConfidence: 0.8,
    createdAt: veryOld,
    lastUsed: veryOld,
  };
  const ancientDecay = calculateDecay(ancientMemory);
  assert(ancientDecay >= MINIMUM_CONFIDENCE_FLOORS['decision'],
    `Ancient decision should hit floor of ${MINIMUM_CONFIDENCE_FLOORS['decision']}, got ${ancientDecay}`);

  // Test 5: Half-lives are defined for all types
  assert(DECAY_HALF_LIVES['decision'] === 90, 'Decision half-life is 90 days');
  assert(DECAY_HALF_LIVES['pattern'] === 60, 'Pattern half-life is 60 days');
  assert(DECAY_HALF_LIVES['skill'] === 45, 'Skill half-life is 45 days');
  assert(DECAY_HALF_LIVES['learning'] === 30, 'Learning half-life is 30 days');

  // Test 6: Confidence floors
  assert(MINIMUM_CONFIDENCE_FLOORS['decision'] === 0.3, 'Decision floor is 0.3');
  assert(MINIMUM_CONFIDENCE_FLOORS['learning'] === 0.05, 'Learning floor is 0.05');

  // Test 7: Recent usage resets decay
  const recentlyUsed = {
    type: 'learning',
    extractionConfidence: 0.8,
    createdAt: thirtyDaysAgo,
    lastUsed: new Date().toISOString(), // Used today!
  };
  const recentDecay = calculateDecay(recentlyUsed);
  assert(recentDecay > 0.79, `Recently used memory should have minimal decay, got ${recentDecay}`);

  console.log('All confidence decay tests passed');
}

testConfidenceDecay();
