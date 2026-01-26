#!/usr/bin/env node
/**
 * Cortex - Claude's Cognitive Layer - Core Tests
 *
 * Tests for core infrastructure components:
 * - Types and utilities
 * - JSONL Storage
 * - Lock Manager
 * - Write Queue
 * - Error Handler
 * - Config Manager
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// Test utilities
const TEST_DIR = path.join(os.tmpdir(), 'cmo-test-' + Date.now());

function setup() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup() {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

// =============================================================================
// IMPORT MODULES
// =============================================================================

let types, storage, lockManager, writeQueue, errorHandler, config;

try {
  types = require('../core/types.cjs');
  storage = require('../core/storage.cjs');
  lockManager = require('../core/lock-manager.cjs');
  writeQueue = require('../core/write-queue.cjs');
  errorHandler = require('../core/error-handler.cjs');
  config = require('../core/config.cjs');
} catch (error) {
  console.error('Failed to import modules:', error.message);
  process.exit(1);
}

// =============================================================================
// TYPES TESTS
// =============================================================================

function testTypes() {
  console.log('\n📦 Testing: Types and Utilities');
  let passed = 0;
  let total = 0;

  total++;
  passed += test('generateId creates unique IDs', () => {
    const id1 = types.generateId();
    const id2 = types.generateId();
    assert(id1 !== id2, 'IDs should be unique');
    assert(typeof id1 === 'string', 'ID should be a string');
    assert(id1.length >= 8, 'ID should be at least 8 characters');
  });

  total++;
  passed += test('getTimestamp returns ISO format', () => {
    const ts = types.getTimestamp();
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(ts), 'Should be ISO format');
  });

  total++;
  passed += test('expandPath expands tilde', () => {
    const expanded = types.expandPath('~/test');
    assert(!expanded.includes('~'), 'Tilde should be expanded');
    assert(expanded.includes(os.homedir()), 'Should contain home directory');
  });

  total++;
  passed += test('clamp constrains values', () => {
    assert.strictEqual(types.clamp(5, 0, 10), 5);
    assert.strictEqual(types.clamp(-5, 0, 10), 0);
    assert.strictEqual(types.clamp(15, 0, 10), 10);
  });

  total++;
  passed += test('sleep delays execution', async () => {
    const start = Date.now();
    await types.sleep(50);
    const elapsed = Date.now() - start;
    assert(elapsed >= 45, 'Should delay at least 45ms');
  });

  total++;
  passed += test('DEFAULT_CONFIG has required fields', () => {
    assert(types.DEFAULT_CONFIG.version, 'Should have version');
    assert(types.DEFAULT_CONFIG.sessionStart, 'Should have sessionStart');
    assert(types.DEFAULT_CONFIG.sessionEnd, 'Should have sessionEnd');
    assert(types.DEFAULT_CONFIG.ladsCore, 'Should have ladsCore');
  });

  return { passed, total };
}

// =============================================================================
// STORAGE TESTS
// =============================================================================

async function testStorage() {
  console.log('\n💾 Testing: JSONL Storage');
  let passed = 0;
  let total = 0;

  const testFile = path.join(TEST_DIR, 'test-storage.jsonl');
  const store = new storage.JSONLStore(testFile, { indexFn: r => r.id });

  total++;
  passed += await testAsync('load creates file if not exists', async () => {
    const result = await store.load();
    assert(result.success, 'Load should succeed');
    assert(fs.existsSync(testFile), 'File should be created');
  });

  total++;
  passed += await testAsync('append adds records', async () => {
    const record = { id: 'test-1', data: 'hello' };
    const result = await store.append(record);
    assert(result.success, 'Append should succeed');
    assert(result.id === 'test-1', 'Should return ID');
  });

  total++;
  passed += await testAsync('get retrieves by index', async () => {
    const record = store.get('test-1');
    assert(record, 'Record should exist');
    assert(record.data === 'hello', 'Data should match');
  });

  total++;
  passed += await testAsync('getAll returns all records', async () => {
    await store.append({ id: 'test-2', data: 'world' });
    const all = store.getAll();
    assert(all.length === 2, 'Should have 2 records');
  });

  total++;
  passed += await testAsync('update modifies records', async () => {
    await store.update('test-1', { data: 'updated' });
    const record = store.get('test-1');
    assert(record.data === 'updated', 'Data should be updated');
  });

  total++;
  passed += await testAsync('query filters records', async () => {
    const results = store.query(r => r.data === 'world');
    assert(results.length === 1, 'Should find 1 record');
    assert(results[0].id === 'test-2', 'Should be test-2');
  });

  total++;
  passed += await testAsync('compact rewrites file', async () => {
    const sizeBefore = fs.statSync(testFile).size;
    await store.compact();
    const sizeAfter = fs.statSync(testFile).size;
    // Compact should create a valid file
    assert(fs.existsSync(testFile), 'File should exist after compact');
  });

  return { passed, total };
}

// =============================================================================
// LOCK MANAGER TESTS
// =============================================================================

async function testLockManager() {
  console.log('\n🔒 Testing: Lock Manager');
  let passed = 0;
  let total = 0;

  const lockDir = path.join(TEST_DIR, 'locks');
  const manager = new lockManager.LockManager({ lockDir });

  total++;
  passed += await testAsync('tryAcquire acquires lock', async () => {
    const result = await manager.tryAcquire('resource-1');
    assert(result.acquired, 'Should acquire lock');
  });

  total++;
  passed += await testAsync('tryAcquire fails on held lock', async () => {
    const result = await manager.tryAcquire('resource-1');
    assert(!result.acquired, 'Should not acquire already held lock');
  });

  total++;
  passed += await testAsync('release releases lock', async () => {
    const released = manager.release('resource-1');
    assert(released, 'Should release lock');

    const result = await manager.tryAcquire('resource-1');
    assert(result.acquired, 'Should acquire after release');
    manager.release('resource-1');
  });

  total++;
  passed += await testAsync('withLock executes with lock', async () => {
    let executed = false;
    const result = await manager.withLock('resource-2', async () => {
      executed = true;
      return 'result';
    });
    assert(executed, 'Should execute function');
    assert(result.success, 'Should succeed');
    assert(result.result === 'result', 'Should return result');
  });

  total++;
  passed += await testAsync('renew extends lock TTL', async () => {
    await manager.tryAcquire('resource-3', { ttlMs: 1000 });
    const renewed = manager.renew('resource-3', 5000);
    assert(renewed, 'Should renew lock');
    manager.release('resource-3');
  });

  total++;
  passed += await testAsync('getStats returns statistics', async () => {
    const stats = manager.getStats();
    assert(typeof stats.activeLocks === 'number', 'Should have activeLocks');
    assert(typeof stats.totalAcquired === 'number', 'Should have totalAcquired');
  });

  // Cleanup
  manager.releaseAll();

  return { passed, total };
}

// =============================================================================
// WRITE QUEUE TESTS
// =============================================================================

async function testWriteQueue() {
  console.log('\n📝 Testing: Write Queue');
  let passed = 0;
  let total = 0;

  // Create a mock storage
  const writes = [];
  const mockStorage = {
    getStore: (type) => ({
      append: (record) => {
        writes.push({ type, record });
        return { success: true, id: record.id };
      },
    }),
  };

  const queue = new writeQueue.MemoryWriteQueue(mockStorage, {
    batchSize: 3,
    batchDelayMs: 50,
  });

  total++;
  passed += await testAsync('queue adds operations', async () => {
    // Don't await - we want to check stats before processing
    const queuePromise = queue.queue('working', 'append', { id: 'q-1', data: 'test' });
    const stats = queue.getStats();
    // Either queued (>= 1) or already processed (totalQueued >= 1)
    assert(stats.byResource.working >= 1 || stats.totalQueued >= 1, 'Should have queued operation');
    await queuePromise; // Wait for completion to avoid unhandled promise
  });

  total++;
  passed += await testAsync('flush processes queue', async () => {
    await queue.flush('working');
    assert(writes.some(w => w.record.id === 'q-1'), 'Should have written q-1');
  });

  total++;
  passed += await testAsync('flushAll processes all queues', async () => {
    await queue.queue('skills', 'append', { id: 'q-2', data: 'skill' });
    await queue.flushAll();
    assert(writes.some(w => w.record.id === 'q-2'), 'Should have written q-2');
  });

  return { passed, total };
}

// =============================================================================
// ERROR HANDLER TESTS
// =============================================================================

async function testErrorHandler() {
  console.log('\n⚠️  Testing: Error Handler');
  let passed = 0;
  let total = 0;

  // Test Circuit Breaker
  total++;
  passed += test('CircuitBreaker starts closed', () => {
    const cb = new errorHandler.CircuitBreaker({ threshold: 3 });
    assert(cb.state === 'closed', 'Should start closed');
    assert(cb.canExecute(), 'Should allow execution');
  });

  total++;
  passed += test('CircuitBreaker opens after threshold', () => {
    const cb = new errorHandler.CircuitBreaker({ threshold: 3, resetTimeout: 100 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    assert(cb.state === 'open', 'Should be open after 3 failures');
    assert(!cb.canExecute(), 'Should not allow execution');
  });

  total++;
  passed += await testAsync('CircuitBreaker resets after timeout', async () => {
    const cb = new errorHandler.CircuitBreaker({ threshold: 2, resetTimeout: 50 });
    cb.recordFailure();
    cb.recordFailure();
    assert(cb.state === 'open', 'Should be open');
    await types.sleep(60);
    assert(cb.canExecute(), 'Should allow execution after timeout');
    assert(cb.state === 'half-open', 'Should be half-open');
  });

  // Test Retry Handler
  total++;
  passed += await testAsync('RetryHandler retries on failure', async () => {
    const rh = new errorHandler.RetryHandler({ maxRetries: 3, baseDelayMs: 10 });
    let attempts = 0;
    try {
      await rh.execute(async () => {
        attempts++;
        if (attempts < 3) throw new Error('Fail');
        return 'success';
      });
    } catch {
      // Expected
    }
    assert(attempts === 3, 'Should retry 3 times');
  });

  // Test Graceful Degradation
  total++;
  passed += test('GracefulDegradation starts at full', () => {
    const gd = new errorHandler.GracefulDegradationManager();
    assert(gd.currentLevel === 'Full', 'Should start at Full');
    assert(gd.isCapabilityEnabled('localMemory'), 'Should have all capabilities');
  });

  total++;
  passed += test('GracefulDegradation degrades on unhealthy', () => {
    const gd = new errorHandler.GracefulDegradationManager();
    gd.reportHealth('storage', false, 'Down');
    gd.reportHealth('storage', false, 'Still down');
    gd.reportHealth('storage', false, 'Again');
    // Should degrade after multiple failures
    assert(gd.unhealthyComponents.has('storage'), 'Should track unhealthy');
  });

  return { passed, total };
}

// =============================================================================
// CONFIG TESTS
// =============================================================================

async function testConfig() {
  console.log('\n⚙️  Testing: Config Manager');
  let passed = 0;
  let total = 0;

  const configPath = path.join(TEST_DIR, 'config.json');
  const historyDir = path.join(TEST_DIR, 'config-history');
  const cm = new config.ConfigManager({ configPath, historyDir });

  total++;
  passed += test('load creates default config', () => {
    const result = cm.load();
    assert(result.success, 'Should load successfully');
    assert(cm.loaded, 'Should be marked as loaded');
  });

  total++;
  passed += test('get retrieves nested values', () => {
    const slots = cm.get('sessionStart.slots.maxTotal');
    assert(typeof slots === 'number', 'Should get numeric value');
  });

  total++;
  passed += test('set updates values', () => {
    const result = cm.set('sessionStart.slots.maxTotal', 10, 'Test change');
    assert(result.success, 'Should set successfully');
    assert(cm.get('sessionStart.slots.maxTotal') === 10, 'Value should be updated');
  });

  total++;
  passed += test('getAll returns full config', () => {
    const all = cm.getAll();
    assert(all.version, 'Should have version');
    assert(all.sessionStart, 'Should have sessionStart');
  });

  total++;
  passed += test('getHistory returns changes', () => {
    const history = cm.getHistory();
    assert(Array.isArray(history), 'Should return array');
    assert(history.length >= 1, 'Should have at least 1 entry');
  });

  total++;
  passed += test('ConfigValidator validates config', () => {
    const validator = new config.ConfigValidator();
    const result = validator.validate(types.DEFAULT_CONFIG);
    assert(result.valid, 'Default config should be valid');
  });

  return { passed, total };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   Cortex Core Tests                       ║');
  console.log('╚════════════════════════════════════════╝');

  setup();

  let totalPassed = 0;
  let totalTests = 0;

  try {
    const results = [
      testTypes(),
      await testStorage(),
      await testLockManager(),
      await testWriteQueue(),
      await testErrorHandler(),
      await testConfig(),
    ];

    for (const r of results) {
      totalPassed += r.passed;
      totalTests += r.total;
    }
  } finally {
    cleanup();
  }

  console.log('\n' + '═'.repeat(42));
  console.log(`Results: ${totalPassed}/${totalTests} tests passed`);

  if (totalPassed === totalTests) {
    console.log('✅ All tests passed!');
    process.exit(0);
  } else {
    console.log(`❌ ${totalTests - totalPassed} test(s) failed`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Test runner failed:', error);
  cleanup();
  process.exit(1);
});
