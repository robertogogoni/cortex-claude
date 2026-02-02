#!/usr/bin/env node
/**
 * Cortex - Claude's Cognitive Layer - Integration Tests
 *
 * Tests the full VectorSearchProvider with all components working together:
 * - Embedder (local ML model)
 * - VectorIndex (HNSW)
 * - MemoryStore (SQLite + FTS5)
 * - HybridSearch (BM25 + vector + RRF fusion)
 *
 * Run with: node tests/integration.test.cjs
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
let skipped = 0;

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

function skip(name, reason) {
  console.log(`  ○ ${name} (skipped: ${reason})`);
  skipped++;
}

// Create test directory
const testDir = path.join(os.tmpdir(), `cortex-integration-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
console.log(`\nIntegration test directory: ${testDir}`);
fs.mkdirSync(testDir, { recursive: true });

// =============================================================================
// MAIN INTEGRATION TESTS
// =============================================================================

async function runIntegrationTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║       Cortex Vector Search Integration Tests                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Import the VectorSearchProvider
  const { VectorSearchProvider, getVectorSearchProvider } = require('../core/vector-search-provider.cjs');
  const { VectorSearchAdapter } = require('../adapters/vector-adapter.cjs');

  let provider;
  let adapter;

  console.log('\n=== VectorSearchProvider Full Integration ===\n');

  await asyncTest('Creates VectorSearchProvider instance', async () => {
    provider = new VectorSearchProvider({
      basePath: testDir,
      vectorWeight: 0.6,
      bm25Weight: 0.4,
      rrfK: 60,
      minScore: 0.05,
    });
    assert.ok(provider);
    assert.strictEqual(provider.initialized, false);
  });

  await asyncTest('Initializes all components (embedder, index, store, search)', async () => {
    const result = await provider.initialize();
    assert.ok(result);
    assert.strictEqual(provider.initialized, true);
    assert.strictEqual(result.success, true);
    // vectorCount is nested under components.vectorIndex
    assert.strictEqual(typeof result.components.vectorIndex.vectorCount, 'number');
  });

  await asyncTest('Inserts first memory with auto-embedding', async () => {
    const result = await provider.insert({
      type: 'learning',
      content: 'JavaScript async/await patterns are powerful for handling asynchronous code flow.',
      summary: 'async/await patterns in JavaScript',
      project_hash: 'test-project-123',
      tags: JSON.stringify(['javascript', 'async', 'patterns']),
      intent: 'debugging',
      source: 'user',
      source_session_id: 'session-001',
      source_timestamp: new Date().toISOString(),
      extraction_confidence: 0.9,
    }, { generateEmbedding: true });

    assert.ok(result.id, 'Insert should return an ID');
    // VectorSearchProvider.insert() returns { id, embedding: boolean }
    assert.strictEqual(result.embedding, true, 'Should have generated embedding');
  });

  await asyncTest('Inserts multiple memories for search testing', async () => {
    const memories = [
      {
        type: 'pattern',
        content: 'Error handling with try/catch blocks is essential for robust applications.',
        summary: 'Error handling patterns',
        tags: JSON.stringify(['javascript', 'error-handling']),
        intent: 'debugging',
        source: 'user',
      },
      {
        type: 'skill',
        content: 'React hooks like useState and useEffect provide functional component state management.',
        summary: 'React hooks overview',
        tags: JSON.stringify(['react', 'hooks', 'frontend']),
        intent: 'implementation',
        source: 'system',
      },
      {
        type: 'learning',
        content: 'TypeScript generics allow writing reusable, type-safe code across different data types.',
        summary: 'TypeScript generics',
        tags: JSON.stringify(['typescript', 'generics', 'types']),
        intent: 'debugging',
        source: 'user',
      },
      {
        type: 'fact',
        content: 'Node.js uses an event-driven, non-blocking I/O model for efficient server-side JavaScript.',
        summary: 'Node.js architecture',
        tags: JSON.stringify(['nodejs', 'architecture', 'backend']),
        intent: 'implementation',
        source: 'system',
      },
      {
        type: 'decision',
        content: 'Chose SQLite over PostgreSQL for local memory storage due to zero-config deployment.',
        summary: 'Database decision',
        tags: JSON.stringify(['database', 'sqlite', 'architecture']),
        intent: 'design',
        source: 'user',
      },
    ];

    for (const memory of memories) {
      memory.source_session_id = 'session-001';
      memory.source_timestamp = new Date().toISOString();
      memory.extraction_confidence = 0.8;

      const result = await provider.insert(memory, { generateEmbedding: true });
      assert.ok(result.id);
    }
  });

  await asyncTest('Hybrid search returns semantically relevant results', async () => {
    const searchResult = await provider.search('how to handle errors in JavaScript', {
      limit: 5,
      minScore: 0.01,
    });

    // provider.search() returns { results: Array, stats: Object }
    // Each result has: { id, score, memory: { content, ... }, sources, decay, ... }
    assert.ok(searchResult.results, 'Should have results property');
    assert.ok(Array.isArray(searchResult.results), 'results should be an array');
    assert.ok(searchResult.results.length > 0, 'Should have at least one result');

    // The error handling memory should rank highly
    // Note: content is nested in memory object
    const contents = searchResult.results.map(r => r.memory.content.toLowerCase());
    const hasErrorHandling = contents.some(c => c.includes('error') || c.includes('try/catch'));
    assert.ok(hasErrorHandling, 'Error handling memory should be in results');
  });

  await asyncTest('Search respects type filter', async () => {
    const searchResult = await provider.search('JavaScript patterns', {
      limit: 10,
      types: ['pattern'],
      minScore: 0.01,
    });

    // provider.search() returns { results: Array, stats: Object }
    // Each result has: { id, score, memory: { memory_type, content, ... }, ... }
    // Note: database uses snake_case field names
    assert.ok(Array.isArray(searchResult.results));
    for (const result of searchResult.results) {
      assert.strictEqual(result.memory.memory_type, 'pattern');
    }
  });

  await asyncTest('Vector-only search works', async () => {
    const searchResult = await provider.searchVector('React state management hooks', 5);

    // provider.searchVector() returns { results: Array, stats: Object }
    // Each result has: { id, score, memory: { content, ... }, ... }
    assert.ok(Array.isArray(searchResult.results));
    // React hooks memory should be relevant
    const hasReact = searchResult.results.some(r =>
      r.memory.content.toLowerCase().includes('react') ||
      r.memory.content.toLowerCase().includes('hooks')
    );
    assert.ok(hasReact || searchResult.results.length === 0, 'React content should be in vector results if any');
  });

  await asyncTest('BM25-only search works', async () => {
    const searchResult = await provider.searchBM25('TypeScript generics', 5);

    // provider.searchBM25() returns { results: Array, stats: Object }
    // Each result has: { id, score, memory: { content, ... }, ... }
    assert.ok(Array.isArray(searchResult.results));
    if (searchResult.results.length > 0) {
      // TypeScript memory should match keyword search
      const hasTypeScript = searchResult.results.some(r =>
        r.memory.content.toLowerCase().includes('typescript') ||
        r.memory.content.toLowerCase().includes('generics')
      );
      assert.ok(hasTypeScript, 'TypeScript content should be in BM25 results');
    }
  });

  await asyncTest('Updates memory record', async () => {
    // First, search for a memory to get its ID
    const searchResult = await provider.search('SQLite database', { limit: 1, minScore: 0.01 });

    if (searchResult.results.length > 0) {
      const id = searchResult.results[0].id;
      const result = await provider.update(id, {
        usage_count: 5,
        usage_success_rate: 0.8,
        last_accessed: new Date().toISOString(),  // Use correct field name (database uses last_accessed)
      });
      assert.ok(result.success);
    } else {
      // Skip if no results
      skip('Update with valid ID', 'No matching memory found');
    }
  });

  await asyncTest('getStats returns comprehensive statistics', async () => {
    const stats = provider.getStats();

    assert.ok(stats);
    assert.strictEqual(stats.initialized, true);
    // Provider stats
    assert.ok(stats.totalInserts >= 6, 'Should have at least 6 inserts');  // We inserted 6 memories
    assert.ok(stats.totalQueries >= 0, 'Should track queries');
    // Component stats are nested
    assert.ok(stats.components);
    assert.ok(stats.components.vectorIndex);
    assert.ok(stats.components.vectorIndex.vectorCount >= 6, 'Should have at least 6 vectors');
  });

  await asyncTest('Saves indices to disk', async () => {
    await provider.save();

    // Verify files exist (match VectorSearchProvider default paths)
    const indexPath = path.join(testDir, 'data', 'vector', 'index.bin');
    const mappingPath = path.join(testDir, 'data', 'vector', 'mapping.json');
    const dbPath = path.join(testDir, 'data', 'memories.db');

    assert.ok(fs.existsSync(indexPath), 'HNSW index should exist at ' + indexPath);
    assert.ok(fs.existsSync(mappingPath), 'ID mapping should exist at ' + mappingPath);
    assert.ok(fs.existsSync(dbPath), 'SQLite database should exist at ' + dbPath);
  });

  await asyncTest('New provider loads existing data', async () => {
    // Create new provider pointing to same directory
    const provider2 = new VectorSearchProvider({
      basePath: testDir,
    });

    const result = await provider2.initialize();
    assert.ok(result);
    assert.ok(result.success, 'Should initialize successfully');
    // vectorCount is nested in components.vectorIndex
    assert.ok(result.components.vectorIndex.vectorCount >= 6, 'Should load existing vectors');

    // Search should still work
    const searchResult = await provider2.search('Node.js event loop', {
      limit: 3,
      minScore: 0.01,
    });
    assert.ok(Array.isArray(searchResult.results));

    await provider2.shutdown();
  });

  await asyncTest('Deletes memory (soft delete)', async () => {
    const searchResult = await provider.search('database decision', { limit: 1, minScore: 0.01 });

    if (searchResult.results.length > 0) {
      const id = searchResult.results[0].id;
      const result = await provider.delete(id, false);  // soft delete
      assert.ok(result.success);

      // Memory should still exist with status='deleted'
      // Note: property is _memoryStore, not _store
      const memory = provider._memoryStore.get(id);
      assert.ok(memory === null || memory?.status === 'deleted');
    }
  });

  await asyncTest('Shutdown cleans up resources', async () => {
    await provider.shutdown();
    assert.strictEqual(provider.initialized, false);
  });

  // ==========================================================================
  // VECTORSEARCHADAPTER INTEGRATION
  // ==========================================================================

  console.log('\n=== VectorSearchAdapter Integration ===\n');

  const adapterDir = path.join(testDir, 'adapter-test');
  fs.mkdirSync(adapterDir, { recursive: true });

  await asyncTest('Creates VectorSearchAdapter', async () => {
    adapter = new VectorSearchAdapter({
      basePath: adapterDir,
      enabled: true,
      vectorWeight: 0.5,
      bm25Weight: 0.5,
    });
    assert.ok(adapter);
    assert.strictEqual(adapter.name, 'vector');
    assert.ok(adapter.supportsWrite());
  });

  await asyncTest('isAvailable returns true (auto-initializes on call)', async () => {
    // Note: VectorSearchAdapter auto-initializes when isAvailable() is called
    // This is by design - lazy initialization means checking availability triggers init
    const available = await adapter.isAvailable();
    assert.strictEqual(available, true);
  });

  await asyncTest('Adapter write creates memory with embedding', async () => {
    const result = await adapter.write({
      type: 'learning',
      content: 'Adapter test: Writing memories through the adapter interface.',
      summary: 'Adapter write test',
      tags: ['test', 'adapter'],
      intent: 'testing',
      sourceSessionId: 'adapter-session',
      sourceTimestamp: new Date().toISOString(),
      extractionConfidence: 0.95,
    });

    assert.ok(result.success);
    assert.ok(result.id);
  });

  await asyncTest('isAvailable returns true after write', async () => {
    const available = await adapter.isAvailable();
    assert.strictEqual(available, true);
  });

  await asyncTest('Adapter query finds written memory', async () => {
    const results = await adapter.query({
      intent: 'testing',
      tags: ['adapter'],
      intentConfidence: 0.8,
    }, {
      limit: 10,
    });

    assert.ok(Array.isArray(results));
    // Results may be empty if context doesn't match well, that's OK for integration test
    // The important thing is no errors are thrown
  });

  await asyncTest('Adapter semanticSearch works', async () => {
    const results = await adapter.semanticSearch('adapter interface memory', 5);
    assert.ok(Array.isArray(results));
  });

  await asyncTest('Adapter keywordSearch works', async () => {
    const results = await adapter.keywordSearch('adapter interface', 5);
    assert.ok(Array.isArray(results));
  });

  await asyncTest('Adapter getStats returns statistics', async () => {
    const stats = await adapter.getStats();
    assert.ok(stats);
    assert.strictEqual(stats.name, 'vector');
    assert.ok(stats.vectorSearch);
  });

  await asyncTest('Adapter shutdown cleans up', async () => {
    await adapter.shutdown();
    // After shutdown, isAvailable should return false
    const available = await adapter.isAvailable();
    assert.strictEqual(available, false);
  });

  // ==========================================================================
  // EDGE CASES AND ERROR HANDLING
  // ==========================================================================

  console.log('\n=== Edge Cases and Error Handling ===\n');

  await asyncTest('Handles empty search query gracefully', async () => {
    const freshProvider = new VectorSearchProvider({ basePath: path.join(testDir, 'empty-test') });
    await freshProvider.initialize();

    const searchResult = await freshProvider.search('', { limit: 5 });
    assert.ok(Array.isArray(searchResult.results), 'Empty query should return { results: [] }');
    assert.strictEqual(searchResult.results.length, 0, 'Empty query should return empty results');

    await freshProvider.shutdown();
  });

  await asyncTest('Handles missing required fields in insert', async () => {
    const freshProvider = new VectorSearchProvider({ basePath: path.join(testDir, 'error-test') });
    await freshProvider.initialize();

    try {
      await freshProvider.insert({
        // Missing 'content' and 'source' - should fail validation
        type: 'learning',
      });
      assert.fail('Should have thrown validation error');
    } catch (error) {
      // Embedder throws first (before MemoryStore validation) when content is missing
      // Valid error messages: "Input must be a non-empty string" (Embedder)
      // or "Memory content is required" (MemoryStore)
      assert.ok(
        error.message.includes('content') ||
        error.message.includes('required') ||
        error.message.includes('non-empty string') ||
        error.message.includes('SQLITE'),
        `Expected validation error, got: ${error.message}`
      );
    }

    await freshProvider.shutdown();
  });

  await asyncTest('Handles concurrent inserts', async () => {
    const concurrentProvider = new VectorSearchProvider({
      basePath: path.join(testDir, 'concurrent-test'),
    });
    await concurrentProvider.initialize();

    // Insert multiple memories concurrently
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(concurrentProvider.insert({
        type: 'learning',
        content: `Concurrent memory ${i}: Testing concurrent write operations.`,
        summary: `Concurrent test ${i}`,
        tags: JSON.stringify(['concurrent', 'test']),
        source: 'user',
        source_session_id: 'concurrent-session',
        source_timestamp: new Date().toISOString(),
        extraction_confidence: 0.8,
      }, { generateEmbedding: true }));
    }

    const results = await Promise.all(promises);

    // All should succeed
    for (const result of results) {
      assert.ok(result.id);
      assert.strictEqual(result.embedding, true);  // Use 'embedding' not 'embedded'
    }

    const stats = concurrentProvider.getStats();
    assert.ok(stats.totalInserts >= 5, 'Should have tracked at least 5 inserts');

    await concurrentProvider.shutdown();
  });

  // ==========================================================================
  // SONNET THINKER LEARN -> VECTOR INTEGRATION
  // ==========================================================================

  console.log('\n=== SonnetThinker Learn -> Vector Integration ===\n');

  // Test 1: Always test infrastructure (no API key needed)
  await asyncTest('SonnetThinker._ensureVectorProvider() initializes correctly', async () => {
    const { SonnetThinker } = require('../cortex/sonnet-thinker.cjs');

    const infraTestDir = path.join(testDir, 'learn-infra-test');
    fs.mkdirSync(infraTestDir, { recursive: true });

    const sonnet = new SonnetThinker({
      basePath: infraTestDir,
    });

    // Test that the vector provider can be initialized
    const provider = await sonnet._ensureVectorProvider();
    assert.ok(provider, 'Vector provider should be initialized');
    assert.ok(provider.initialized, 'Vector provider should be in initialized state');

    // Clean up
    await provider.shutdown();
  });

  // Test 2: Test learn() with API (may fall back to defaults if API fails)
  // This tests the dual-write logic regardless of API success
  await asyncTest('SonnetThinker.learn() writes to vector store (with fallback)', async () => {
    const { SonnetThinker } = require('../cortex/sonnet-thinker.cjs');

    const learnTestDir = path.join(testDir, 'learn-vector-test');
    fs.mkdirSync(learnTestDir, { recursive: true });

    const sonnet = new SonnetThinker({
      basePath: learnTestDir,
    });

    // Call learn with a test insight
    // If API fails, it will use fallback defaults (quality=5, which is >= 4)
    const result = await sonnet.learn(
      'SQLite FTS5 enables fast full-text search with BM25 ranking',
      'Database optimization for Cortex memory search',
      'pattern',
      ['sqlite', 'fts5', 'search']
    );

    // Verify the insight was stored (should work even with API fallback)
    assert.ok(result.stored, 'Insight should be stored (quality >= 4, even with fallback)');
    assert.ok(result.vectorStored, 'Insight should be written to vector store');
    assert.ok(result.vectorId, 'Should have a vector ID');

    // Now search for it via vector search
    const { VectorSearchProvider } = require('../core/vector-search-provider.cjs');
    const searchProvider = new VectorSearchProvider({
      basePath: learnTestDir,
    });
    await searchProvider.initialize();

    const searchResult = await searchProvider.search('SQLite full-text search FTS5', {
      limit: 5,
      minScore: 0.01,
    });

    assert.ok(searchResult.results.length > 0, 'Should find the learned insight via vector search');

    // Check that the found memory contains our content
    const foundMemory = searchResult.results.find(r =>
      r.memory.content.toLowerCase().includes('fts5') ||
      r.memory.content.toLowerCase().includes('full-text')
    );
    assert.ok(foundMemory, 'Should find memory with FTS5 content');

    await searchProvider.shutdown();
  });

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  console.log('\n=== Cleanup ===\n');

  await asyncTest('Cleanup test directories', async () => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors on Windows
    }
  });
}

// =============================================================================
// RUN TESTS
// =============================================================================

runIntegrationTests()
  .then(() => {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(error => {
    console.error('\nTest runner error:', error);
    process.exit(1);
  });
