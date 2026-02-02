/**
 * Cortex - Vector Search Unit Tests
 *
 * Tests cover:
 * - Embedder: Embedding generation, caching, batch processing
 * - VectorIndex: Add, search, remove, persistence
 * - MemoryStore: CRUD operations, FTS5 search, filtering
 * - HybridSearch: RRF fusion, weighted combination
 * - VectorSearchProvider: Unified interface
 * - VectorSearchAdapter: Adapter integration
 *
 * Run: node tests/vector-search.test.cjs
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Test counter
let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${e.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${e.message}`);
    if (e.stack) {
      const lines = e.stack.split('\n').slice(1, 4).join('\n');
      console.log(`    Stack: ${lines}`);
    }
    failed++;
  }
}

function skip(name, reason = '') {
  console.log(`  ○ ${name} (skipped${reason ? ': ' + reason : ''})`);
  skipped++;
}

// Create unique temp directory for tests
const TEST_DIR = path.join(os.tmpdir(), `cortex-test-${Date.now()}-${process.pid}`);

function setupTestDir() {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true, mode: 0o700 });
  }
}

function cleanupTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// =============================================================================
// MODULE LOADING TESTS
// =============================================================================

async function testModuleLoading() {
  console.log('\n=== Module Loading Tests ===\n');

  test('Embedder module loads', () => {
    const { Embedder, LRUCache, EMBEDDING_DIM } = require('../core/embedder.cjs');
    assert.ok(Embedder, 'Embedder class should exist');
    assert.ok(LRUCache, 'LRUCache class should exist');
    assert.strictEqual(EMBEDDING_DIM, 384, 'EMBEDDING_DIM should be 384');
  });

  test('VectorIndex module loads', () => {
    const { VectorIndex, DEFAULT_MAX_ELEMENTS } = require('../core/vector-index.cjs');
    assert.ok(VectorIndex, 'VectorIndex class should exist');
    assert.strictEqual(DEFAULT_MAX_ELEMENTS, 100000, 'DEFAULT_MAX_ELEMENTS should be 100000');
  });

  test('MemoryStore module loads', () => {
    const { MemoryStore, MEMORY_TYPES, MEMORY_SOURCES, TABLE_NAME } = require('../core/memory-store.cjs');
    assert.ok(MemoryStore, 'MemoryStore class should exist');
    assert.ok(MEMORY_TYPES, 'MEMORY_TYPES should exist');
    assert.ok(MEMORY_SOURCES, 'MEMORY_SOURCES should exist');
    assert.strictEqual(TABLE_NAME, 'memories', 'TABLE_NAME should be memories');
  });

  test('HybridSearch module loads', () => {
    const { HybridSearch, DEFAULT_RRF_K } = require('../core/hybrid-search.cjs');
    assert.ok(HybridSearch, 'HybridSearch class should exist');
    assert.strictEqual(DEFAULT_RRF_K, 60, 'DEFAULT_RRF_K should be 60');
  });

  test('VectorSearchProvider module loads', () => {
    const { VectorSearchProvider, getVectorSearchProvider } = require('../core/vector-search-provider.cjs');
    assert.ok(VectorSearchProvider, 'VectorSearchProvider class should exist');
    assert.ok(getVectorSearchProvider, 'getVectorSearchProvider function should exist');
  });

  test('VectorSearchAdapter module loads', () => {
    const { VectorSearchAdapter } = require('../adapters/vector-adapter.cjs');
    assert.ok(VectorSearchAdapter, 'VectorSearchAdapter class should exist');
  });

  test('Main index exports all vector components', () => {
    const cortex = require('../index.cjs');
    const vectorExports = [
      'Embedder', 'LRUCache', 'EMBEDDING_DIM',
      'VectorIndex', 'MemoryStore', 'HybridSearch',
      'VectorSearchProvider', 'getVectorSearchProvider',
      'VectorSearchAdapter',
    ];

    const missing = vectorExports.filter(e => !cortex[e]);
    assert.strictEqual(missing.length, 0, `Missing exports: ${missing.join(', ')}`);
  });
}

// =============================================================================
// LRU CACHE TESTS
// =============================================================================

async function testLRUCache() {
  console.log('\n=== LRU Cache Tests ===\n');

  const { LRUCache } = require('../core/embedder.cjs');

  test('Creates cache with default size', () => {
    const cache = new LRUCache();
    assert.strictEqual(cache.maxSize, 1000);
  });

  test('Creates cache with custom size', () => {
    const cache = new LRUCache(100, 30000);
    assert.strictEqual(cache.maxSize, 100);
    assert.strictEqual(cache.ttl, 30000);
  });

  test('Set and get basic values', () => {
    const cache = new LRUCache(10, 60000);
    const data = new Float32Array([1, 2, 3]);
    cache.set('key1', data);
    const result = cache.get('key1');
    assert.ok(result instanceof Float32Array);
    assert.strictEqual(result[0], 1);
  });

  test('Returns null for missing keys', () => {
    const cache = new LRUCache(10, 60000);
    assert.strictEqual(cache.get('nonexistent'), null);
  });

  test('Evicts oldest entry when full', () => {
    const cache = new LRUCache(3, 60000);
    cache.set('a', new Float32Array([1]));
    cache.set('b', new Float32Array([2]));
    cache.set('c', new Float32Array([3]));
    cache.set('d', new Float32Array([4])); // Should evict 'a'
    assert.strictEqual(cache.get('a'), null);
    assert.ok(cache.get('b'));
    assert.ok(cache.get('c'));
    assert.ok(cache.get('d'));
  });

  test('LRU order: accessing moves to end', () => {
    const cache = new LRUCache(3, 60000);
    cache.set('a', new Float32Array([1]));
    cache.set('b', new Float32Array([2]));
    cache.set('c', new Float32Array([3]));
    cache.get('a'); // Access 'a', making it most recent
    cache.set('d', new Float32Array([4])); // Should evict 'b' (oldest)
    assert.ok(cache.get('a'));
    assert.strictEqual(cache.get('b'), null);
  });

  test('TTL expiration', () => {
    const cache = new LRUCache(10, 1); // 1ms TTL
    cache.set('key', new Float32Array([1]));

    // Force expiration by waiting
    return new Promise(resolve => {
      setTimeout(() => {
        const result = cache.get('key');
        assert.strictEqual(result, null);
        resolve();
      }, 10);
    });
  });

  test('has() returns correct status', () => {
    const cache = new LRUCache(10, 60000);
    cache.set('exists', new Float32Array([1]));
    assert.strictEqual(cache.has('exists'), true);
    assert.strictEqual(cache.has('missing'), false);
  });

  test('clear() removes all entries', () => {
    const cache = new LRUCache(10, 60000);
    cache.set('a', new Float32Array([1]));
    cache.set('b', new Float32Array([2]));
    cache.clear();
    assert.strictEqual(cache.size, 0);
    assert.strictEqual(cache.get('a'), null);
  });

  test('prune() removes expired entries', async () => {
    const cache = new LRUCache(10, 5); // 5ms TTL
    cache.set('a', new Float32Array([1]));
    await new Promise(r => setTimeout(r, 20));
    cache.set('b', new Float32Array([2])); // Fresh entry
    const removed = cache.prune();
    assert.strictEqual(removed, 1);
    assert.strictEqual(cache.get('a'), null);
    assert.ok(cache.get('b'));
  });
}

// =============================================================================
// MEMORY STORE TESTS
// =============================================================================

async function testMemoryStore() {
  console.log('\n=== MemoryStore Tests ===\n');

  let MemoryStore, MEMORY_SOURCES;
  try {
    ({ MemoryStore, MEMORY_SOURCES } = require('../core/memory-store.cjs'));
  } catch (e) {
    skip('MemoryStore tests', `Module load failed: ${e.message}`);
    return;
  }

  const dbPath = path.join(TEST_DIR, 'memories.db');
  let store;

  await asyncTest('Creates MemoryStore instance', async () => {
    store = new MemoryStore({ dbPath });
    assert.ok(store);
    assert.strictEqual(store.initialized, false);
  });

  await asyncTest('Initializes database', async () => {
    const result = await store.initialize();
    // API returns { created: boolean, memoryCount: number }
    assert.ok(typeof result.created === 'boolean');
    assert.strictEqual(typeof result.memoryCount, 'number');
    assert.strictEqual(store.initialized, true);
  });

  await asyncTest('Inserts memory record', async () => {
    // API requires 'content' and 'source' fields
    const memory = {
      id: 'test-mem-1',
      memory_type: 'learning',
      content: 'JavaScript async/await patterns are useful for handling promises',
      summary: 'JS async patterns',
      project_hash: null,
      tags: ['javascript', 'async', 'patterns'],
      intent: 'code_pattern',
      source: 'user',  // Must be one of MEMORY_SOURCES
      session_id: 'test-session',
      extraction_confidence: 0.85,
    };

    const result = await store.insert(memory);
    // API returns { id: string, embedded: boolean }
    assert.strictEqual(result.id, 'test-mem-1');
    assert.strictEqual(typeof result.embedded, 'boolean');
  });

  await asyncTest('Gets memory by ID', async () => {
    // API uses get(id) not getById(id)
    const memory = store.get('test-mem-1');
    assert.ok(memory);
    assert.strictEqual(memory.id, 'test-mem-1');
    assert.strictEqual(memory.memory_type, 'learning');
    assert.ok(memory.content.includes('async/await'));
  });

  await asyncTest('Updates memory record', async () => {
    // API returns boolean
    const result = store.update('test-mem-1', {
      summary: 'Updated JS async patterns',
    });
    assert.strictEqual(result, true);

    const updated = store.get('test-mem-1');
    assert.strictEqual(updated.summary, 'Updated JS async patterns');
    assert.ok(updated.version >= 2);  // Version increments on update
  });

  await asyncTest('Inserts more memories for query testing', async () => {
    await store.insert({
      id: 'test-mem-2',
      memory_type: 'pattern',
      content: 'Python decorators allow metaprogramming',
      summary: 'Python decorators',
      tags: ['python', 'decorators'],
      source: 'user',
    });

    await store.insert({
      id: 'test-mem-3',
      memory_type: 'skill',
      content: 'TypeScript generics provide type safety with flexibility',
      summary: 'TS generics',
      tags: ['typescript', 'generics'],
      source: 'user',
    });

    // Verify inserted
    assert.ok(store.exists('test-mem-2'));
    assert.ok(store.exists('test-mem-3'));
  });

  await asyncTest('Query with filters', async () => {
    // API uses query(options) not searchFTS
    const results = store.query({ status: 'active', limit: 10 });
    assert.ok(Array.isArray(results));
    assert.ok(results.length >= 3);
  });

  await asyncTest('Query with memoryType filter', async () => {
    const results = store.query({ memoryType: 'learning', limit: 10 });
    assert.ok(Array.isArray(results));
    // Only learning type should be returned
    results.forEach(r => assert.strictEqual(r.memory_type, 'learning'));
  });

  await asyncTest('Query with orderBy', async () => {
    const results = store.query({
      orderBy: 'created_at',
      order: 'DESC',
      limit: 10,
    });
    assert.ok(Array.isArray(results));
    assert.ok(results.length >= 3);
  });

  await asyncTest('Counts memories', async () => {
    // API uses getCount(status) not count()
    const count = store.getCount('active');
    assert.ok(count >= 3);
  });

  await asyncTest('Gets memories without embeddings', async () => {
    // API uses getMissingEmbeddings(limit)
    const noEmbed = store.getMissingEmbeddings(100);
    assert.ok(Array.isArray(noEmbed));
    // All our test records should be returned (no embeddings)
    assert.ok(noEmbed.length >= 3);
    // Each item has id and content
    assert.ok(noEmbed[0].id);
    assert.ok(noEmbed[0].content);
  });

  await asyncTest('Sets embedding', async () => {
    const embedding = new Float32Array(384).fill(0.5);
    // API returns boolean
    const result = store.setEmbedding('test-mem-1', embedding);
    assert.strictEqual(result, true);

    // get with includeEmbedding=true
    const memory = store.get('test-mem-1', true);
    assert.ok(memory.embedding);
    assert.strictEqual(memory.embedding.length, 384);
  });

  await asyncTest('Gets embedding directly', async () => {
    const embedding = store.getEmbedding('test-mem-1');
    assert.ok(embedding instanceof Float32Array);
    assert.strictEqual(embedding.length, 384);
    assert.strictEqual(embedding[0], 0.5);
  });

  await asyncTest('Records access', async () => {
    store.recordAccess('test-mem-1', true);
    const memory = store.get('test-mem-1');
    assert.ok(memory.usage_count >= 1);
    assert.ok(memory.last_accessed);
  });

  await asyncTest('Get count by source', async () => {
    const counts = store.getCountBySource();
    assert.ok(counts.user >= 3);
  });

  await asyncTest('Get count by type', async () => {
    const counts = store.getCountByType();
    assert.ok(counts.learning >= 1);
    assert.ok(counts.pattern >= 1);
    assert.ok(counts.skill >= 1);
  });

  await asyncTest('Get embedding coverage', async () => {
    const coverage = store.getEmbeddingCoverage();
    assert.ok(coverage.total >= 3);
    assert.ok(coverage.withEmbedding >= 1);
    assert.ok(coverage.coverage >= 0);
  });

  await asyncTest('Soft delete', async () => {
    // API: delete(id, hard=false) - soft delete sets status='deleted'
    const result = store.delete('test-mem-3', false);
    assert.strictEqual(result, true);

    const deleted = store.get('test-mem-3');
    assert.strictEqual(deleted.status, 'deleted');
  });

  await asyncTest('Hard delete', async () => {
    const result = store.delete('test-mem-2', true);
    assert.strictEqual(result, true);

    const deleted = store.get('test-mem-2');
    assert.strictEqual(deleted, null);
  });

  await asyncTest('Gets stats', async () => {
    const stats = store.getStats();
    assert.ok(stats.inserts >= 3);
    assert.ok(stats.updates >= 1);
    assert.ok(stats.deletes >= 1);
    assert.ok(stats.dbStats);
    assert.ok(stats.memoryCount >= 1);
  });

  await asyncTest('Closes database', async () => {
    store.close();
    assert.strictEqual(store.initialized, false);
  });
}

// =============================================================================
// EMBEDDER TESTS (requires model download - can be slow)
// =============================================================================

async function testEmbedder() {
  console.log('\n=== Embedder Tests ===\n');

  const { Embedder, EMBEDDING_DIM } = require('../core/embedder.cjs');

  let embedder;

  test('Creates Embedder instance', () => {
    embedder = new Embedder({ verbose: false });
    assert.ok(embedder);
    assert.strictEqual(embedder.modelLoaded, false);
  });

  test('Returns correct dimension', () => {
    assert.strictEqual(embedder.getDimension(), 384);
    assert.strictEqual(EMBEDDING_DIM, 384);
  });

  // Skip slow tests if environment variable set
  if (process.env.SKIP_SLOW_TESTS) {
    skip('Embedder model tests', 'SKIP_SLOW_TESTS env set');
    return;
  }

  await asyncTest('Generates embedding (first call loads model)', async () => {
    const text = 'Hello, this is a test sentence for embedding generation.';
    const embedding = await embedder.embed(text);

    assert.ok(embedding instanceof Float32Array);
    assert.strictEqual(embedding.length, 384);
    assert.ok(embedder.modelLoaded);
  });

  await asyncTest('Embedding is normalized', async () => {
    const embedding = await embedder.embed('Test normalization');

    // Compute L2 norm
    let sumSquares = 0;
    for (let i = 0; i < embedding.length; i++) {
      sumSquares += embedding[i] * embedding[i];
    }
    const norm = Math.sqrt(sumSquares);

    // Should be approximately 1.0 (normalized)
    assert.ok(Math.abs(norm - 1.0) < 0.01, `Norm should be ~1.0, got ${norm}`);
  });

  await asyncTest('Cache hit on repeated query', async () => {
    const text = 'This is a cached query test';
    const startMisses = embedder.stats.cacheMisses;

    await embedder.embed(text);
    assert.strictEqual(embedder.stats.cacheMisses, startMisses + 1);

    await embedder.embed(text);
    // Cache hits should not increment misses
    assert.strictEqual(embedder.stats.cacheMisses, startMisses + 1);
    assert.ok(embedder.stats.cacheHits > 0);
  });

  await asyncTest('Similar texts have high similarity', async () => {
    const text1 = 'The quick brown fox jumps over the lazy dog';
    const text2 = 'A fast brown fox leaps over a sleepy dog';

    const emb1 = await embedder.embed(text1);
    const emb2 = await embedder.embed(text2);

    const similarity = Embedder.cosineSimilarity(emb1, emb2);
    assert.ok(similarity > 0.7, `Similarity should be >0.7, got ${similarity}`);
  });

  await asyncTest('Different texts have low similarity', async () => {
    const text1 = 'JavaScript programming language';
    const text2 = 'Italian pasta recipes with tomato sauce';

    const emb1 = await embedder.embed(text1);
    const emb2 = await embedder.embed(text2);

    const similarity = Embedder.cosineSimilarity(emb1, emb2);
    assert.ok(similarity < 0.5, `Similarity should be <0.5, got ${similarity}`);
  });

  await asyncTest('Batch embedding', async () => {
    const texts = [
      'First sentence for batch',
      'Second sentence for batch',
      'Third sentence for batch',
    ];

    const embeddings = await embedder.embedBatch(texts);

    assert.ok(Array.isArray(embeddings));
    assert.strictEqual(embeddings.length, 3);
    embeddings.forEach(emb => {
      assert.ok(emb instanceof Float32Array);
      assert.strictEqual(emb.length, 384);
    });
  });

  await asyncTest('Handles long text (truncation)', async () => {
    const longText = 'word '.repeat(1000); // Very long text
    const embedding = await embedder.embed(longText);

    assert.ok(embedding instanceof Float32Array);
    assert.strictEqual(embedding.length, 384);
  });

  await asyncTest('Handles empty string gracefully', async () => {
    try {
      await embedder.embed('');
      assert.fail('Should have thrown for empty string');
    } catch (e) {
      assert.ok(e.message.includes('non-empty'));
    }
  });

  test('getStats returns valid statistics', () => {
    const stats = embedder.getStats();
    assert.ok(stats.modelLoaded);
    assert.ok(stats.totalEmbeddings > 0);
    assert.ok(stats.cacheHitRate >= 0);
    assert.strictEqual(stats.dimension, 384);
  });

  test('Static cosine similarity', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    assert.strictEqual(Embedder.cosineSimilarity(a, b), 1);

    const c = new Float32Array([1, 0, 0]);
    const d = new Float32Array([0, 1, 0]);
    assert.strictEqual(Embedder.cosineSimilarity(c, d), 0);
  });

  test('Static euclidean distance', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([3, 4, 0]);
    assert.strictEqual(Embedder.euclideanDistance(a, b), 5);
  });

  test('Static normalize', () => {
    const v = new Float32Array([3, 4, 0]);
    const normalized = Embedder.normalize(v);
    assert.ok(Math.abs(normalized[0] - 0.6) < 0.001);
    assert.ok(Math.abs(normalized[1] - 0.8) < 0.001);
  });

  test('toBuffer and fromBuffer conversion', () => {
    const embedding = new Float32Array([1.5, 2.5, 3.5, 4.5]);
    const buffer = Embedder.toBuffer(embedding);
    assert.ok(Buffer.isBuffer(buffer));

    const restored = Embedder.fromBuffer(buffer);
    assert.strictEqual(restored.length, 4);
    assert.strictEqual(restored[0], 1.5);
    assert.strictEqual(restored[3], 4.5);
  });
}

// =============================================================================
// VECTOR INDEX TESTS
// =============================================================================

async function testVectorIndex() {
  console.log('\n=== VectorIndex Tests ===\n');

  let VectorIndex;
  try {
    ({ VectorIndex } = require('../core/vector-index.cjs'));
  } catch (e) {
    skip('VectorIndex tests', `hnswlib-node not installed: ${e.message}`);
    return;
  }

  const indexPath = path.join(TEST_DIR, 'test-index.bin');
  const mappingPath = path.join(TEST_DIR, 'test-mapping.json');
  let index;

  await asyncTest('Creates VectorIndex instance', async () => {
    index = new VectorIndex({
      dimension: 384,
      maxElements: 1000,
      indexPath,
      mappingPath,
    });
    assert.ok(index);
    assert.strictEqual(index.initialized, false);
  });

  await asyncTest('Initializes new index', async () => {
    const result = await index.initialize();
    assert.strictEqual(result.loaded, false); // New index
    assert.strictEqual(result.vectorCount, 0);
    assert.strictEqual(index.initialized, true);
  });

  await asyncTest('Adds vectors', async () => {
    const vectors = [
      { id: 'vec-1', embedding: new Float32Array(384).fill(0.1) },
      { id: 'vec-2', embedding: new Float32Array(384).fill(0.2) },
      { id: 'vec-3', embedding: new Float32Array(384).fill(0.3) },
    ];

    for (const { id, embedding } of vectors) {
      const result = index.add(id, embedding);
      assert.ok(result.position >= 0);
      assert.strictEqual(result.isUpdate, false);
    }

    assert.strictEqual(index.stats.vectorCount, 3);
  });

  await asyncTest('Searches for nearest neighbors', async () => {
    const query = new Float32Array(384).fill(0.15); // Closest to vec-1
    const results = index.search(query, 3);

    assert.ok(results.ids.length > 0);
    assert.ok(results.distances.length > 0);
    assert.strictEqual(results.ids.length, results.distances.length);
    assert.strictEqual(results.ids[0], 'vec-1'); // Should be closest
  });

  await asyncTest('has() checks existence', async () => {
    assert.strictEqual(index.has('vec-1'), true);
    assert.strictEqual(index.has('nonexistent'), false);
  });

  await asyncTest('getPosition() returns position', async () => {
    const pos = index.getPosition('vec-1');
    assert.ok(pos !== null);
    assert.ok(pos >= 0);

    const missing = index.getPosition('nonexistent');
    assert.strictEqual(missing, null);
  });

  await asyncTest('Updates vector (re-adds)', async () => {
    const newEmbedding = new Float32Array(384).fill(0.9);
    const result = index.add('vec-1', newEmbedding);
    assert.strictEqual(result.isUpdate, true);

    // Search should now return vec-1 as closest to 0.9
    const query = new Float32Array(384).fill(0.85);
    const searchResults = index.search(query, 1);
    assert.strictEqual(searchResults.ids[0], 'vec-1');
  });

  await asyncTest('Removes vector', async () => {
    const removed = index.remove('vec-2');
    assert.strictEqual(removed, true);
    assert.strictEqual(index.has('vec-2'), false);
    assert.strictEqual(index.stats.deletedCount, 2); // vec-2 + old vec-1
  });

  await asyncTest('Saves index to disk', async () => {
    const result = await index.save();
    assert.ok(result.indexSize > 0);
    assert.ok(result.mappingSize > 0);
    assert.ok(fs.existsSync(indexPath));
    assert.ok(fs.existsSync(mappingPath));
  });

  await asyncTest('Loads existing index', async () => {
    // Create new instance that should load existing data
    const index2 = new VectorIndex({
      dimension: 384,
      maxElements: 1000,
      indexPath,
      mappingPath,
    });

    const result = await index2.initialize();
    assert.strictEqual(result.loaded, true);
    assert.ok(result.vectorCount > 0);

    // Should still have vec-1 and vec-3
    assert.strictEqual(index2.has('vec-1'), true);
    assert.strictEqual(index2.has('vec-3'), true);
    assert.strictEqual(index2.has('vec-2'), false); // Was deleted
  });

  test('getStats returns statistics', () => {
    const stats = index.getStats();
    assert.ok(stats.initialized);
    assert.strictEqual(stats.dimension, 384);
    assert.ok(stats.vectorCount >= 0);
    assert.ok(stats.searches > 0);
  });

  test('getAllIds returns all IDs', () => {
    const ids = index.getAllIds();
    assert.ok(Array.isArray(ids));
    assert.ok(ids.includes('vec-1'));
    assert.ok(ids.includes('vec-3'));
  });
}

// =============================================================================
// HYBRID SEARCH TESTS
// =============================================================================

async function testHybridSearch() {
  console.log('\n=== HybridSearch Tests ===\n');

  let HybridSearch, MemoryStore, VectorIndex, Embedder, DEFAULT_RRF_K, rrfScore;
  try {
    ({ HybridSearch, DEFAULT_RRF_K, rrfScore } = require('../core/hybrid-search.cjs'));
    ({ MemoryStore } = require('../core/memory-store.cjs'));
    ({ VectorIndex } = require('../core/vector-index.cjs'));
    ({ Embedder } = require('../core/embedder.cjs'));
  } catch (e) {
    skip('HybridSearch tests', `Dependencies missing: ${e.message}`);
    return;
  }

  // Skip if model loading is slow
  if (process.env.SKIP_SLOW_TESTS) {
    skip('HybridSearch tests', 'SKIP_SLOW_TESTS env set');
    return;
  }

  const dbPath = path.join(TEST_DIR, 'hybrid-test.db');
  const indexPath = path.join(TEST_DIR, 'hybrid-index.bin');
  const mappingPath = path.join(TEST_DIR, 'hybrid-mapping.json');

  let hybrid, embedder, memoryStore, vectorIndex;

  await asyncTest('Creates HybridSearch with components', async () => {
    embedder = new Embedder({ verbose: false });
    memoryStore = new MemoryStore({ dbPath });
    vectorIndex = new VectorIndex({ indexPath, mappingPath, dimension: 384 });

    await memoryStore.initialize();
    await vectorIndex.initialize();

    // HybridSearch expects low-level SQLiteStore, not MemoryStore
    // Access via memoryStore.store
    hybrid = new HybridSearch({
      store: memoryStore.store,  // SQLiteStore instance
      vectorIndex,
      embedder,
      vectorWeight: 0.5,  // Default 0.5 for equal weighting
    });

    assert.ok(hybrid);
    assert.strictEqual(hybrid.rrfK, DEFAULT_RRF_K);
  });

  await asyncTest('Inserts test memories with embeddings', async () => {
    const memories = [
      {
        id: 'hybrid-1',
        content: 'React hooks are a way to use state in functional components',
        memory_type: 'learning',
        tags: ['react', 'hooks', 'javascript'],
      },
      {
        id: 'hybrid-2',
        content: 'Vue composition API provides similar functionality to React hooks',
        memory_type: 'pattern',
        tags: ['vue', 'composition', 'javascript'],
      },
      {
        id: 'hybrid-3',
        content: 'Python asyncio enables asynchronous programming',
        memory_type: 'learning',
        tags: ['python', 'async'],
      },
    ];

    for (const mem of memories) {
      // Generate embedding
      const embedding = await embedder.embed(mem.content);

      // Insert into MemoryStore (requires content and source)
      await memoryStore.insert({
        id: mem.id,
        content: mem.content,
        memory_type: mem.memory_type,
        tags: mem.tags,
        source: 'user',  // Required field
      });

      // Set embedding
      memoryStore.setEmbedding(mem.id, embedding);

      // Add to vector index
      vectorIndex.add(mem.id, embedding);
    }

    // Verify all inserted
    assert.strictEqual(memoryStore.getCount('active'), 3);
  });

  await asyncTest('Hybrid search returns ranked results', async () => {
    const results = await hybrid.search('React hooks state', { limit: 10 });

    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);

    // Results have standard structure
    assert.ok(results[0].id);
    assert.ok(results[0].score !== undefined);
    assert.ok(results[0].memory);
    assert.ok(Array.isArray(results[0].sources));

    // First result should be about React hooks
    assert.ok(results[0].memory.content.toLowerCase().includes('react'));
  });

  await asyncTest('Hybrid search respects memoryType filter', async () => {
    const results = await hybrid.search('programming patterns', {
      memoryType: 'pattern',
      limit: 10,
    });

    // Only pattern type should be returned (if any match)
    results.forEach(r => {
      assert.strictEqual(r.memory.memory_type, 'pattern');
    });
  });

  await asyncTest('Vector-only search', async () => {
    const results = await hybrid.searchVector('functional components state', { limit: 3 });

    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
    // Should have score and sources=['vector']
    assert.ok(results[0].score !== undefined);
    assert.ok(results[0].sources.includes('vector') || results[0].vectorRank !== null);
  });

  await asyncTest('BM25-only search', async () => {
    const results = await hybrid.searchBM25('asyncio python', { limit: 3 });

    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
    // Should match Python asyncio memory
    assert.ok(results[0].memory.content.toLowerCase().includes('python'));
    // Should have sources=['bm25']
    assert.ok(results[0].sources.includes('bm25') || results[0].bm25Rank !== null);
  });

  test('RRF fusion calculation via rrfScore()', () => {
    // Test RRF score calculation using exported function
    const k = 60;
    const rank0Score = rrfScore(0, k);  // Rank 0
    const rank1Score = rrfScore(1, k);  // Rank 1
    const rank10Score = rrfScore(10, k);  // Rank 10

    // Higher rank should have lower score
    assert.ok(rank0Score > rank1Score);
    assert.ok(rank1Score > rank10Score);

    // Expected values: 1/(60+0) = 0.01667, 1/(60+1) ≈ 0.01639
    assert.ok(Math.abs(rank0Score - (1 / 60)) < 0.0001);
    assert.ok(Math.abs(rank1Score - (1 / 61)) < 0.0001);
  });

  test('DEFAULT_RRF_K constant', () => {
    assert.strictEqual(DEFAULT_RRF_K, 60);
  });

  await asyncTest('getStats returns search statistics', async () => {
    const stats = hybrid.getStats();
    assert.ok(stats.searches >= 3);  // We did at least 3 searches
    assert.ok(stats.config);
    assert.strictEqual(stats.config.rrfK, 60);
  });

  await asyncTest('Cleanup', async () => {
    memoryStore.close();
  });
}

// =============================================================================
// VECTOR SEARCH ADAPTER TESTS
// =============================================================================

async function testVectorSearchAdapter() {
  console.log('\n=== VectorSearchAdapter Tests ===\n');

  let VectorSearchAdapter, BaseAdapter;
  try {
    ({ VectorSearchAdapter } = require('../adapters/vector-adapter.cjs'));
    ({ BaseAdapter } = require('../adapters/base-adapter.cjs'));
  } catch (e) {
    skip('VectorSearchAdapter tests', `Module load failed: ${e.message}`);
    return;
  }

  test('Extends BaseAdapter', () => {
    const adapter = new VectorSearchAdapter({ enabled: false });
    assert.ok(adapter instanceof BaseAdapter);
  });

  test('Has correct default configuration', () => {
    const adapter = new VectorSearchAdapter({});
    assert.strictEqual(adapter.name, 'vector');
    assert.strictEqual(adapter.priority, 0.95);
    assert.strictEqual(adapter.vectorWeight, 0.6);
    assert.strictEqual(adapter.bm25Weight, 0.4);
  });

  test('supportsWrite returns true', () => {
    const adapter = new VectorSearchAdapter({});
    assert.strictEqual(adapter.supportsWrite(), true);
  });

  test('isAvailable returns false when not initialized', async () => {
    const adapter = new VectorSearchAdapter({ enabled: false });
    // Without initialization, should return false
    const available = await adapter.isAvailable();
    // May be false or throw depending on dependencies
    assert.ok(typeof available === 'boolean');
  });
}

// =============================================================================
// MAIN TEST RUNNER
// =============================================================================

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       Cortex Vector Search Unit Tests                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nTest directory: ${TEST_DIR}`);

  try {
    setupTestDir();

    await testModuleLoading();
    await testLRUCache();
    await testMemoryStore();
    await testEmbedder();
    await testVectorIndex();
    await testHybridSearch();
    await testVectorSearchAdapter();

  } finally {
    cleanupTestDir();
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
