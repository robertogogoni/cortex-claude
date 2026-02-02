#!/usr/bin/env node
/**
 * Cortex - Learn to Vector Integration Test
 *
 * Tests that cortex__learn tool writes to both JSONL and Vector storage.
 * This test focuses on the dual-write logic without requiring full API calls.
 *
 * Run with: node tests/learn-vector-integration.test.cjs
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// =============================================================================
// TEST UTILITIES
// =============================================================================

let passed = 0;
let failed = 0;

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    if (error.stack) {
      console.log(`    Stack: ${error.stack.split('\n').slice(1, 3).join('\n')}`);
    }
    failed++;
  }
}

// Create test directory
const testDir = path.join(os.tmpdir(), `cortex-learn-vector-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
console.log(`\nTest directory: ${testDir}`);
fs.mkdirSync(testDir, { recursive: true });

// =============================================================================
// TESTS
// =============================================================================

async function runTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║          Learn Tool -> Vector Integration Tests              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const { SonnetThinker } = require('../cortex/sonnet-thinker.cjs');
  const { getVectorSearchProvider } = require('../core/vector-search-provider.cjs');

  // Test 1: Verify vector provider lazy initialization
  await asyncTest('SonnetThinker has vector provider infrastructure', async () => {
    const sonnet = new SonnetThinker({
      basePath: path.join(testDir, 'test1'),
    });

    // Verify the provider reference exists (null until initialized)
    assert.strictEqual(sonnet._vectorProvider, null, 'Provider should be null initially');
    assert.strictEqual(sonnet._vectorProviderInitializing, null, 'No init in progress');
  });

  // Test 2: Verify _ensureVectorProvider initializes correctly
  await asyncTest('_ensureVectorProvider() lazy-initializes provider', async () => {
    const testPath = path.join(testDir, 'test2');
    fs.mkdirSync(testPath, { recursive: true });

    const sonnet = new SonnetThinker({
      basePath: testPath,
    });

    const provider = await sonnet._ensureVectorProvider();

    assert.ok(provider, 'Provider should be returned');
    assert.strictEqual(provider.initialized, true, 'Provider should be initialized');
    assert.strictEqual(sonnet._vectorProvider, provider, 'Provider should be cached');

    // Calling again should return same instance
    const provider2 = await sonnet._ensureVectorProvider();
    assert.strictEqual(provider2, provider, 'Should return same instance');

    await provider.shutdown();
  });

  // Test 3: Verify concurrent initialization is safe
  await asyncTest('_ensureVectorProvider() handles concurrent calls', async () => {
    const testPath = path.join(testDir, 'test3');
    fs.mkdirSync(testPath, { recursive: true });

    const sonnet = new SonnetThinker({
      basePath: testPath,
    });

    // Call multiple times concurrently
    const [p1, p2, p3] = await Promise.all([
      sonnet._ensureVectorProvider(),
      sonnet._ensureVectorProvider(),
      sonnet._ensureVectorProvider(),
    ]);

    assert.strictEqual(p1, p2, 'All calls should return same instance');
    assert.strictEqual(p2, p3, 'All calls should return same instance');
    assert.strictEqual(p1.initialized, true, 'Provider should be initialized');

    await p1.shutdown();
  });

  // Test 4: Test that learn() returns vector storage fields
  // Note: We need to use direct VectorSearchProvider, not singleton, for test isolation
  await asyncTest('learn() includes vectorStored and vectorId in response', async () => {
    const testPath = path.join(testDir, 'test4');
    fs.mkdirSync(testPath, { recursive: true });

    const { VectorSearchProvider } = require('../core/vector-search-provider.cjs');

    const sonnet = new SonnetThinker({
      basePath: testPath,
    });

    // Override _ensureVectorProvider to return a fresh provider (not singleton)
    let testProvider = null;
    sonnet._ensureVectorProvider = async () => {
      if (!testProvider) {
        testProvider = new VectorSearchProvider({
          basePath: testPath,
        });
        await testProvider.initialize();
      }
      return testProvider;
    };

    // Mock _callSonnet to avoid API call
    sonnet._callSonnet = async () => JSON.stringify({
      quality: 8,
      value: 'Test value',
      suggestedTags: ['test'],
      isDuplicate: false,
      priority: 'high',
      enhancedInsight: 'Enhanced test insight',
    });

    const result = await sonnet.learn(
      'Test insight about testing',
      'Test context',
      'pattern',
      ['testing']
    );

    // Check that the response includes vector fields
    assert.ok('stored' in result, 'Should have stored field');
    assert.ok('vectorStored' in result, 'Should have vectorStored field');
    assert.ok('vectorId' in result, 'Should have vectorId field');

    // With mocked quality=8, it should be stored
    assert.strictEqual(result.stored, true, 'Should be stored with quality 8');
    assert.strictEqual(result.vectorStored, true, 'Should be vector stored');
    assert.ok(result.vectorId, 'Should have a vector ID');

    // Cleanup
    if (testProvider) {
      await testProvider.shutdown();
    }
  });

  // Test 5: Test that vector search can find learned content
  await asyncTest('Learned insights are searchable via vector search', async () => {
    const testPath = path.join(testDir, 'test5');
    fs.mkdirSync(testPath, { recursive: true });

    const { VectorSearchProvider } = require('../core/vector-search-provider.cjs');

    const sonnet = new SonnetThinker({
      basePath: testPath,
    });

    // Override _ensureVectorProvider to return a fresh provider (not singleton)
    let testProvider = null;
    sonnet._ensureVectorProvider = async () => {
      if (!testProvider) {
        testProvider = new VectorSearchProvider({
          basePath: testPath,
        });
        await testProvider.initialize();
      }
      return testProvider;
    };

    // Mock _callSonnet
    sonnet._callSonnet = async () => JSON.stringify({
      quality: 9,
      value: 'Important insight about vector databases',
      suggestedTags: ['vectors', 'database'],
      isDuplicate: false,
      priority: 'high',
      enhancedInsight: 'Vector databases enable semantic search through embeddings',
    });

    await sonnet.learn(
      'Vector databases use embeddings for search',
      'Database technology',
      'skill',
      ['vectors']
    );

    // Search using the same provider
    const searchResult = await testProvider.search('embeddings semantic search', {
      limit: 5,
      minScore: 0.01,
    });

    assert.ok(searchResult.results.length > 0, 'Should find results');

    // Check that we found our learned insight
    const found = searchResult.results.some(r =>
      r.memory.content.toLowerCase().includes('vector') ||
      r.memory.content.toLowerCase().includes('embedding')
    );
    assert.ok(found, 'Should find the learned insight');

    await testProvider.shutdown();
  });

  // Test 6: Low quality insights should NOT be stored
  await asyncTest('Low quality insights are not stored in vector', async () => {
    const testPath = path.join(testDir, 'test6');
    fs.mkdirSync(testPath, { recursive: true });

    const sonnet = new SonnetThinker({
      basePath: testPath,
    });

    // Mock _callSonnet to return low quality
    sonnet._callSonnet = async () => JSON.stringify({
      quality: 2, // Below threshold of 4
      value: 'Low value',
      suggestedTags: [],
      isDuplicate: false,
      priority: 'low',
      enhancedInsight: 'Not worth storing',
    });

    const result = await sonnet.learn(
      'Low quality insight',
      'Test',
      'general',
      []
    );

    assert.strictEqual(result.stored, false, 'Should not be stored');
    assert.strictEqual(result.vectorStored, false, 'Should not be vector stored');
    assert.strictEqual(result.vectorId, null, 'Should not have vector ID');

    // No need to shutdown provider as it wasn't used
  });

  // Test 7: Duplicate insights should NOT be stored
  await asyncTest('Duplicate insights are not stored in vector', async () => {
    const testPath = path.join(testDir, 'test7');
    fs.mkdirSync(testPath, { recursive: true });

    const sonnet = new SonnetThinker({
      basePath: testPath,
    });

    // Mock _callSonnet to indicate duplicate
    sonnet._callSonnet = async () => JSON.stringify({
      quality: 8,
      value: 'Good quality but duplicate',
      suggestedTags: ['test'],
      isDuplicate: true, // Marked as duplicate
      priority: 'medium',
      enhancedInsight: 'Already known',
    });

    const result = await sonnet.learn(
      'Duplicate insight',
      'Test',
      'general',
      []
    );

    assert.strictEqual(result.stored, false, 'Should not be stored');
    assert.strictEqual(result.vectorStored, false, 'Should not be vector stored');
    assert.strictEqual(result.vectorId, null, 'Should not have vector ID');
  });

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  console.log('\n=== Cleanup ===\n');

  await asyncTest('Cleanup test directories', async () => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });
}

// =============================================================================
// RUN
// =============================================================================

runTests()
  .then(() => {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(error => {
    console.error('\nTest runner error:', error);
    process.exit(1);
  });
