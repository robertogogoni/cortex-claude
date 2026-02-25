#!/usr/bin/env node
/**
 * Tests for EpisodicMemoryAdapter v2 — Direct SQLite Access
 *
 * Validates that the adapter works WITHOUT mcpCaller by querying the
 * episodic memory SQLite database directly via better-sqlite3 + sqlite-vec.
 *
 * Requires: ~/.config/superpowers/conversation-index/db.sqlite to exist
 *
 * @version 1.0.0
 */

'use strict';

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

const DB_PATH = path.join(
  os.homedir(),
  '.config', 'superpowers', 'conversation-index', 'db.sqlite'
);

let passed = 0;
let failed = 0;
const errors = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    errors.push({ name, error: err });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

// =============================================================================
// TESTS
// =============================================================================

async function main() {
  console.log('\n━━━ EpisodicMemoryAdapter v2 — Direct SQLite Tests ━━━\n');

  // Check precondition
  if (!fs.existsSync(DB_PATH)) {
    console.log(`⚠ SKIPPED: Database not found at ${DB_PATH}`);
    console.log('  Install episodic-memory plugin and index conversations first.');
    process.exit(0);
  }

  const { EpisodicMemoryAdapter, DEFAULT_DB_PATH } = require('../adapters/episodic-memory-adapter.cjs');

  // -------------------------------------------------------------------------
  // Construction & Availability
  // -------------------------------------------------------------------------

  console.log('▸ Construction & Availability');

  await test('constructs without mcpCaller (no warning, no throw)', () => {
    const adapter = new EpisodicMemoryAdapter({ dbPath: DB_PATH });
    assert.strictEqual(adapter.name, 'episodic-memory');
    assert.strictEqual(adapter.priority, 0.9);
    assert.strictEqual(adapter.mcpCaller, null);
    adapter.close();
  });

  await test('DEFAULT_DB_PATH matches expected location', () => {
    assert.strictEqual(
      DEFAULT_DB_PATH,
      path.join(os.homedir(), '.config', 'superpowers', 'conversation-index', 'db.sqlite')
    );
  });

  await test('isAvailable() returns true with valid database', async () => {
    const adapter = new EpisodicMemoryAdapter({ dbPath: DB_PATH });
    const available = await adapter.isAvailable();
    assert.strictEqual(available, true, 'Should be available');
    adapter.close();
  });

  await test('isAvailable() returns false with invalid path', async () => {
    const adapter = new EpisodicMemoryAdapter({ dbPath: '/nonexistent/db.sqlite' });
    const available = await adapter.isAvailable();
    assert.strictEqual(available, false, 'Should not be available');
    adapter.close();
  });

  await test('getExchangeCount() returns > 0', () => {
    const adapter = new EpisodicMemoryAdapter({ dbPath: DB_PATH });
    const count = adapter.getExchangeCount();
    assert(count > 0, `Expected > 0 exchanges, got ${count}`);
    console.log(`    (${count} exchanges in database)`);
    adapter.close();
  });

  // -------------------------------------------------------------------------
  // Text Search
  // -------------------------------------------------------------------------

  console.log('\n▸ Text Search');

  await test('text search returns results for common term', async () => {
    const adapter = new EpisodicMemoryAdapter({
      dbPath: DB_PATH,
      searchMode: 'text',
    });

    const results = await adapter.query(
      { tags: ['claude'], intentConfidence: 0 },
      { limit: 5 }
    );

    assert(results.length > 0, `Expected results, got ${results.length}`);
    assert(results[0].content, 'Result should have content');
    assert(results[0]._source === 'episodic-memory', 'Source should be episodic-memory');
    adapter.close();
  });

  await test('text search results have all MemoryRecord fields', async () => {
    const adapter = new EpisodicMemoryAdapter({
      dbPath: DB_PATH,
      searchMode: 'text',
    });

    const results = await adapter.query(
      { tags: ['git'], intentConfidence: 0 },
      { limit: 1 }
    );

    assert(results.length > 0, 'Should have results');
    const r = results[0];

    // Check required MemoryRecord fields
    assert(r.id, 'Missing id');
    assert(r.type, 'Missing type');
    assert(r.content, 'Missing content');
    assert(r.summary, 'Missing summary');
    assert(Array.isArray(r.tags), 'tags should be array');
    assert(typeof r.extractionConfidence === 'number', 'extractionConfidence should be number');
    assert(typeof r.decayScore === 'number', 'decayScore should be number');
    assert(r._source === 'episodic-memory', '_source should be episodic-memory');
    assert(r.sourceTimestamp, 'Missing sourceTimestamp');

    adapter.close();
  });

  await test('text search returns empty for nonsense query', async () => {
    const adapter = new EpisodicMemoryAdapter({
      dbPath: DB_PATH,
      searchMode: 'text',
    });

    const results = await adapter.query(
      { tags: ['xyzzy_nonexistent_term_12345'], intentConfidence: 0 },
      { limit: 5 }
    );

    assert.strictEqual(results.length, 0, `Expected 0 results, got ${results.length}`);
    adapter.close();
  });

  // -------------------------------------------------------------------------
  // Vector Search
  // -------------------------------------------------------------------------

  console.log('\n▸ Vector Search');

  await test('vector search returns scored results', async () => {
    const adapter = new EpisodicMemoryAdapter({
      dbPath: DB_PATH,
      searchMode: 'vector',
    });

    const results = await adapter.query(
      { tags: ['debugging memory systems'], intentConfidence: 0 },
      { limit: 5 }
    );

    assert(results.length > 0, `Expected results, got ${results.length}`);

    // Vector results should have meaningful scores (not all 0.5)
    const hasVectorScores = results.some(r => r.extractionConfidence !== 0.5);
    assert(hasVectorScores, 'Vector results should have non-0.5 scores');

    // Scores should be between 0 and 1
    for (const r of results) {
      assert(
        r.extractionConfidence >= 0 && r.extractionConfidence <= 1,
        `Score out of range: ${r.extractionConfidence}`
      );
    }

    adapter.close();
  });

  await test('vector search results are ordered by relevance', async () => {
    const adapter = new EpisodicMemoryAdapter({
      dbPath: DB_PATH,
      searchMode: 'vector',
    });

    const results = await adapter.query(
      { tags: ['bash installer'], intentConfidence: 0 },
      { limit: 10 }
    );

    assert(results.length >= 2, 'Need at least 2 results to check ordering');

    // Scores should be in descending order (highest confidence first)
    for (let i = 0; i < results.length - 1; i++) {
      assert(
        results[i].extractionConfidence >= results[i + 1].extractionConfidence,
        `Results not ordered: [${i}]=${results[i].extractionConfidence} < [${i+1}]=${results[i+1].extractionConfidence}`
      );
    }

    adapter.close();
  });

  // -------------------------------------------------------------------------
  // Combined (both) Search
  // -------------------------------------------------------------------------

  console.log('\n▸ Combined Search (vector + text)');

  await test('combined search returns merged results', async () => {
    const adapter = new EpisodicMemoryAdapter({
      dbPath: DB_PATH,
      searchMode: 'both',
    });

    const results = await adapter.query(
      { tags: ['wayland'], intentConfidence: 0 },
      { limit: 10 }
    );

    assert(results.length > 0, `Expected results, got ${results.length}`);

    // Should have no duplicate IDs
    const ids = results.map(r => r.id);
    const uniqueIds = new Set(ids);
    assert.strictEqual(ids.length, uniqueIds.size, 'Should have no duplicate IDs');

    adapter.close();
  });

  await test('combined search finds more results than vector alone', async () => {
    const adapter = new EpisodicMemoryAdapter({ dbPath: DB_PATH });

    // Combined (default)
    const bothResults = await adapter.query(
      { tags: ['hyprland'], intentConfidence: 0 },
      { limit: 20 }
    );
    adapter.clearCache();

    // Vector only
    adapter.searchMode = 'vector';
    const vecResults = await adapter.query(
      { tags: ['hyprland'], intentConfidence: 0 },
      { limit: 20 }
    );

    // Combined should generally find >= vector-only results
    assert(
      bothResults.length >= vecResults.length,
      `Combined (${bothResults.length}) should find >= vector (${vecResults.length})`
    );

    adapter.close();
  });

  // -------------------------------------------------------------------------
  // Context Building & Fallbacks
  // -------------------------------------------------------------------------

  console.log('\n▸ Context Building & Fallbacks');

  await test('empty context falls back to recent', async () => {
    const adapter = new EpisodicMemoryAdapter({ dbPath: DB_PATH });

    const results = await adapter.query(
      { tags: [], intentConfidence: 0 },
      { limit: 5 }
    );

    assert(results.length > 0, `Expected recent results, got ${results.length}`);
    adapter.close();
  });

  await test('query with intent + tags builds compound query', async () => {
    const adapter = new EpisodicMemoryAdapter({ dbPath: DB_PATH });

    const results = await adapter.query(
      {
        intent: 'debugging',
        intentConfidence: 0.8,
        tags: ['linux', 'bash'],
        projectName: 'memory',
      },
      { limit: 5 }
    );

    assert(results.length > 0, `Expected results, got ${results.length}`);
    adapter.close();
  });

  // -------------------------------------------------------------------------
  // Caching
  // -------------------------------------------------------------------------

  console.log('\n▸ Caching');

  await test('second identical query uses cache', async () => {
    const adapter = new EpisodicMemoryAdapter({
      dbPath: DB_PATH,
      searchMode: 'text',
    });

    const query = { tags: ['node'], intentConfidence: 0 };
    const opts = { limit: 3 };

    const t1 = Date.now();
    await adapter.query(query, opts);
    const first = Date.now() - t1;

    const t2 = Date.now();
    await adapter.query(query, opts);
    const second = Date.now() - t2;

    // Cached query should be significantly faster (or at least not slower)
    assert(second <= first + 5, `Cached query (${second}ms) should be faster than first (${first}ms)`);

    adapter.close();
  });

  await test('clearCache() invalidates cache', async () => {
    const adapter = new EpisodicMemoryAdapter({
      dbPath: DB_PATH,
      searchMode: 'text',
    });

    await adapter.query({ tags: ['git'], intentConfidence: 0 }, { limit: 1 });
    adapter.clearCache();

    // After clearing, the internal cache map should be empty
    assert.strictEqual(adapter._cache.size, 0, 'Cache should be empty after clear');
    adapter.close();
  });

  // -------------------------------------------------------------------------
  // Read Operations
  // -------------------------------------------------------------------------

  console.log('\n▸ Read Operations');

  await test('read() returns content for valid archive path', async () => {
    const adapter = new EpisodicMemoryAdapter({
      dbPath: DB_PATH,
      searchMode: 'text',
    });

    // First find a result with an archive path
    const results = await adapter.query(
      { tags: ['claude'], intentConfidence: 0 },
      { limit: 1 }
    );

    if (results.length > 0 && results[0]._archivePath) {
      const archivePath = results[0]._archivePath;

      if (fs.existsSync(archivePath)) {
        const readResult = await adapter.read(archivePath, { endLine: 10 });
        assert(readResult.success, `Read should succeed: ${readResult.error}`);
        assert(readResult.content, 'Should have content');
        assert(readResult.content.length > 0, 'Content should not be empty');
      } else {
        console.log(`    (archive file not found, skipping read test)`);
      }
    } else {
      console.log(`    (no results with archive path, skipping)`);
    }

    adapter.close();
  });

  await test('read() returns error for nonexistent file', async () => {
    const adapter = new EpisodicMemoryAdapter({ dbPath: DB_PATH });
    const result = await adapter.read('/nonexistent/file.jsonl');
    assert.strictEqual(result.success, false);
    assert(result.error.includes('not found'), `Error should mention not found: ${result.error}`);
    adapter.close();
  });

  // -------------------------------------------------------------------------
  // QueryOptions Filtering
  // -------------------------------------------------------------------------

  console.log('\n▸ QueryOptions Filtering');

  await test('limit option restricts result count', async () => {
    const adapter = new EpisodicMemoryAdapter({
      dbPath: DB_PATH,
      searchMode: 'text',
    });

    const results = await adapter.query(
      { tags: ['claude'], intentConfidence: 0 },
      { limit: 3 }
    );

    assert(results.length <= 3, `Expected <= 3, got ${results.length}`);
    adapter.close();
  });

  await test('type filter restricts to specific memory types', async () => {
    const adapter = new EpisodicMemoryAdapter({
      dbPath: DB_PATH,
      searchMode: 'text',
    });

    const results = await adapter.query(
      { tags: ['error'], intentConfidence: 0 },
      { limit: 10, types: ['learning'] }
    );

    for (const r of results) {
      assert.strictEqual(r.type, 'learning', `Expected type=learning, got ${r.type}`);
    }

    adapter.close();
  });

  // -------------------------------------------------------------------------
  // Cleanup & Edge Cases
  // -------------------------------------------------------------------------

  console.log('\n▸ Cleanup & Edge Cases');

  await test('close() is idempotent', () => {
    const adapter = new EpisodicMemoryAdapter({ dbPath: DB_PATH });
    adapter.close();
    adapter.close();  // Should not throw
  });

  await test('query after close reopens database', async () => {
    const adapter = new EpisodicMemoryAdapter({
      dbPath: DB_PATH,
      searchMode: 'text',
    });

    // Open, close, then query again
    await adapter.isAvailable();
    adapter.close();

    const results = await adapter.query(
      { tags: ['node'], intentConfidence: 0 },
      { limit: 1 }
    );

    assert(results.length > 0, 'Should work after reopen');
    adapter.close();
  });

  await test('setMcpCaller() works for backward compat', () => {
    const adapter = new EpisodicMemoryAdapter({ dbPath: DB_PATH });
    adapter.setMcpCaller(() => {});
    assert.strictEqual(typeof adapter.mcpCaller, 'function');

    assert.throws(
      () => adapter.setMcpCaller('not a function'),
      /mcpCaller must be a function/
    );

    adapter.close();
  });

  // =========================================================================
  // RESULTS
  // =========================================================================

  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);

  if (errors.length > 0) {
    console.log('Failures:');
    for (const { name, error } of errors) {
      console.log(`  ✗ ${name}`);
      console.log(`    ${error.stack?.split('\n').slice(0, 3).join('\n    ')}`);
    }
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
