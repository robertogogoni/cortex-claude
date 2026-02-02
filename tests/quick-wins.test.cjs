/**
 * Tests for Quick Win Features
 *
 * Tests the features implemented from the feature gap analysis:
 * 1. Memory Scheduler
 * 2. Usage Tracking in Query Orchestrator
 * 3. Health Check Tool (tested via server.cjs inspection)
 *
 * @version 1.0.0
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// =============================================================================
// TEST SETUP
// =============================================================================

const TEST_BASE = path.join(__dirname, '.test-quick-wins');

function setup() {
  // Clean up any previous test data
  if (fs.existsSync(TEST_BASE)) {
    fs.rmSync(TEST_BASE, { recursive: true });
  }

  // Create test directories
  const dirs = [
    path.join(TEST_BASE, 'data/memories'),
    path.join(TEST_BASE, 'data/insights'),
    path.join(TEST_BASE, 'data/learnings'),
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Create test memory files with sample data
  const workingMemory = [
    {
      id: 'test-1',
      type: 'learning',
      content: 'Test memory 1',
      summary: 'Test summary 1',
      usageCount: 0,
      usageSuccessRate: 0.5,
      decayScore: 1.0,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days old
      status: 'active',
    },
    {
      id: 'test-2',
      type: 'pattern',
      content: 'Test memory 2',
      summary: 'Test summary 2',
      usageCount: 5,
      usageSuccessRate: 0.8,
      decayScore: 0.9,
      createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours old
      status: 'active',
    },
  ];

  const shortTermMemory = [
    {
      id: 'st-1',
      type: 'decision',
      content: 'Short term memory 1',
      summary: 'ST summary 1',
      usageCount: 10,
      usageSuccessRate: 0.9,
      decayScore: 0.5,
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days old
      status: 'active',
    },
  ];

  // Write test files
  fs.writeFileSync(
    path.join(TEST_BASE, 'data/memories/working.jsonl'),
    workingMemory.map(m => JSON.stringify(m)).join('\n')
  );

  fs.writeFileSync(
    path.join(TEST_BASE, 'data/memories/short-term.jsonl'),
    shortTermMemory.map(m => JSON.stringify(m)).join('\n')
  );

  fs.writeFileSync(
    path.join(TEST_BASE, 'data/memories/long-term.jsonl'),
    ''
  );
}

function cleanup() {
  if (fs.existsSync(TEST_BASE)) {
    fs.rmSync(TEST_BASE, { recursive: true });
  }
}

// =============================================================================
// MEMORY SCHEDULER TESTS
// =============================================================================

async function testMemoryScheduler() {
  console.log('\n=== Memory Scheduler Tests ===\n');

  const { MemoryScheduler, DEFAULT_OPTIONS } = require('../core/memory-scheduler.cjs');

  // Test 1: Constructor and default options
  console.log('Test 1: Constructor and defaults...');
  const scheduler = new MemoryScheduler({
    basePath: TEST_BASE,
    verbose: false,
  });

  assert.strictEqual(scheduler.promotionInterval, DEFAULT_OPTIONS.promotionInterval, 'Should use default promotion interval');
  assert.strictEqual(scheduler.isRunning(), false, 'Should not be running initially');
  console.log('  PASS: Constructor works correctly');

  // Test 2: Start and stop
  console.log('Test 2: Start and stop...');
  const startResult = await scheduler.start();
  assert.strictEqual(startResult.success, true, 'Should start successfully');
  assert.strictEqual(scheduler.isRunning(), true, 'Should be running after start');

  // Allow initial promotion to complete
  await new Promise(resolve => setTimeout(resolve, 100));

  const stopResult = scheduler.stop();
  assert.strictEqual(stopResult.success, true, 'Should stop successfully');
  assert.strictEqual(scheduler.isRunning(), false, 'Should not be running after stop');
  console.log('  PASS: Start/stop works correctly');

  // Test 3: Manual trigger
  console.log('Test 3: Manual promotion trigger...');
  const triggerResult = await scheduler.triggerPromotion({ dryRun: true });
  assert.strictEqual(triggerResult.success, true, 'Should trigger successfully');
  assert.ok(triggerResult.results, 'Should have results');
  assert.strictEqual(triggerResult.results.dryRun, true, 'Should be dry run');
  console.log('  PASS: Manual trigger works correctly');

  // Test 4: Stats tracking
  console.log('Test 4: Stats tracking...');
  const stats = scheduler.getStats();
  assert.ok(stats.startedAt, 'Should have startedAt');
  assert.strictEqual(typeof stats.promotionRuns, 'number', 'Should track promotion runs');
  assert.strictEqual(typeof stats.totalPromoted, 'number', 'Should track total promoted');
  console.log('  PASS: Stats tracking works correctly');

  // Test 5: Prevent double start
  console.log('Test 5: Prevent double start...');
  await scheduler.start();
  const doubleStartResult = await scheduler.start();
  assert.strictEqual(doubleStartResult.success, false, 'Should fail on double start');
  scheduler.stop();
  console.log('  PASS: Double start prevented');

  console.log('\n  All Memory Scheduler tests passed!\n');
}

// =============================================================================
// USAGE TRACKING TESTS (via Query Orchestrator)
// =============================================================================

async function testUsageTracking() {
  console.log('\n=== Usage Tracking Tests ===\n');

  // Test that the _trackUsage method exists in QueryOrchestrator
  console.log('Test 1: Method existence...');
  const { QueryOrchestrator } = require('../hooks/query-orchestrator.cjs');
  const orchestrator = new QueryOrchestrator({
    basePath: TEST_BASE,
  });

  assert.strictEqual(typeof orchestrator._trackUsage, 'function', '_trackUsage method should exist');
  console.log('  PASS: _trackUsage method exists');

  // Test that the method doesn't throw with empty input
  console.log('Test 2: Empty input handling...');
  await orchestrator._trackUsage([]);
  console.log('  PASS: Empty input handled without error');

  // Test that method handles missing adapter gracefully
  console.log('Test 3: Missing adapter handling...');
  await orchestrator._trackUsage([
    { id: 'test-1', _source: 'nonexistent-adapter' }
  ]);
  console.log('  PASS: Missing adapter handled gracefully');

  console.log('\n  All Usage Tracking tests passed!\n');
}

// =============================================================================
// HEALTH CHECK TESTS (File inspection)
// =============================================================================

async function testHealthCheck() {
  console.log('\n=== Health Check Tests ===\n');

  // Test that the health check tool was added to server.cjs
  console.log('Test 1: Tool definition exists...');
  const serverCode = fs.readFileSync(
    path.join(__dirname, '../cortex/server.cjs'),
    'utf-8'
  );

  assert.ok(serverCode.includes("name: 'cortex__health'"), 'Health check tool should be defined');
  assert.ok(serverCode.includes('getHealthStatus'), 'getHealthStatus function should exist');
  console.log('  PASS: Health check tool is defined');

  // Test that it's in TOOL_MODELS
  console.log('Test 2: Tool model registration...');
  assert.ok(serverCode.includes("'cortex__health': { model: 'Local'"), 'Health check should be registered in TOOL_MODELS');
  console.log('  PASS: Health check is registered');

  // Test that the handler case exists
  console.log('Test 3: Handler case exists...');
  assert.ok(serverCode.includes("case 'cortex__health':"), 'Health check case should exist in handler');
  assert.ok(serverCode.includes('getHealthStatus(validatedArgs.includeStats)'), 'Should call getHealthStatus');
  console.log('  PASS: Handler case exists');

  console.log('\n  All Health Check tests passed!\n');
}

// =============================================================================
// RUN ALL TESTS
// =============================================================================

async function runTests() {
  console.log('========================================');
  console.log('Quick Wins Feature Tests');
  console.log('========================================');

  setup();

  let passed = 0;
  let failed = 0;

  try {
    await testMemoryScheduler();
    passed++;
  } catch (error) {
    console.error('Memory Scheduler tests FAILED:', error.message);
    failed++;
  }

  try {
    await testUsageTracking();
    passed++;
  } catch (error) {
    console.error('Usage Tracking tests FAILED:', error.message);
    failed++;
  }

  try {
    await testHealthCheck();
    passed++;
  } catch (error) {
    console.error('Health Check tests FAILED:', error.message);
    failed++;
  }

  cleanup();

  console.log('========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  cleanup();
  process.exit(1);
});
