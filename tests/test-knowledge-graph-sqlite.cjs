#!/usr/bin/env node
/**
 * Tests for KnowledgeGraphAdapter v2 — Direct File Access
 *
 * Validates that the adapter works WITHOUT mcpCaller by reading the
 * knowledge graph JSONL file directly from the npx cache.
 *
 * @version 1.0.0
 */

'use strict';

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

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
  console.log('\n━━━ KnowledgeGraphAdapter v2 — Direct File Access Tests ━━━\n');

  const { KnowledgeGraphAdapter } = require('../src/adapters/knowledge-graph-adapter.cjs');

  // -------------------------------------------------------------------------
  // Construction & Discovery
  // -------------------------------------------------------------------------

  console.log('▸ Construction & Discovery');

  await test('constructs without mcpCaller (no throw)', () => {
    const adapter = new KnowledgeGraphAdapter();
    assert.strictEqual(adapter.name, 'knowledge-graph');
    assert.strictEqual(adapter.priority, 0.8);
    assert.strictEqual(adapter.mcpCaller, null);
  });

  await test('auto-discovers memory file in npx cache', async () => {
    const adapter = new KnowledgeGraphAdapter();
    const available = await adapter.isAvailable();
    if (available) {
      console.log(`    (file found at: ${adapter._resolvedPath})`);
    } else {
      console.log(`    (no memory file found — server-memory may not be installed)`);
    }
    // Don't assert — server-memory may not be installed
  });

  await test('accepts explicit filePath config', () => {
    // Create a temp JSONL file
    const tmpPath = path.join(os.tmpdir(), 'cortex-kg-test.jsonl');
    fs.writeFileSync(tmpPath, JSON.stringify({
      type: 'entity',
      name: 'TestEntity',
      entityType: 'testing',
      observations: ['This is a test entity for unit tests'],
    }) + '\n');

    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    assert.strictEqual(adapter._explicitPath, tmpPath);

    // Cleanup
    fs.unlinkSync(tmpPath);
  });

  // -------------------------------------------------------------------------
  // Tests with temp data (works even without server-memory installed)
  // -------------------------------------------------------------------------

  // Create test fixture
  const tmpPath = path.join(os.tmpdir(), 'cortex-kg-test-fixture.jsonl');

  function createFixture() {
    const lines = [
      JSON.stringify({ type: 'entity', name: 'Cortex Vector Search', entityType: 'feature', observations: ['Uses HNSW index', 'BM25 + vector RRF fusion', 'all-MiniLM-L6-v2 embeddings'] }),
      JSON.stringify({ type: 'entity', name: 'Sed Ordering Bug', entityType: 'learning', observations: ['Order matters in sed transformations', 'Generic patterns before specific causes failures'] }),
      JSON.stringify({ type: 'entity', name: 'Wayland Cedilla Fix', entityType: 'project', observations: ['Public GitHub repo', 'Bash installer', '3-layer fix for ç', 'MIT license'] }),
      JSON.stringify({ type: 'entity', name: 'User Preferences', entityType: 'preference', observations: ['Prefers dark theme', 'Uses Arch Linux', 'Hyprland WM'] }),
      JSON.stringify({ type: 'entity', name: 'Git Workflow', entityType: 'pattern', observations: ['Always create feature branches', 'Use conventional commits', 'Squash merge to main'] }),
      JSON.stringify({ type: 'relation', from: 'Cortex Vector Search', to: 'Cortex', relationType: 'part_of' }),
      JSON.stringify({ type: 'relation', from: 'Wayland Cedilla Fix', to: 'Sed Ordering Bug', relationType: 'uses_learning' }),
    ];
    fs.writeFileSync(tmpPath, lines.join('\n') + '\n');
  }

  function cleanupFixture() {
    try { fs.unlinkSync(tmpPath); } catch {}
  }

  console.log('\n▸ Query — Text Search');

  createFixture();

  await test('query returns results for matching tags', async () => {
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    const results = await adapter.query(
      { tags: ['vector', 'search'], intentConfidence: 0 },
      { limit: 5 }
    );
    assert(results.length > 0, `Expected results, got ${results.length}`);
    assert(results[0].content.includes('HNSW'), 'Top result should be Cortex Vector Search');
  });

  await test('query results have correct MemoryRecord fields', async () => {
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    const results = await adapter.query(
      { tags: ['cedilla'], intentConfidence: 0 },
      { limit: 1 }
    );
    assert(results.length > 0, 'Should have results');
    const r = results[0];
    assert(r.id.startsWith('kg:'), `ID should start with kg:, got ${r.id}`);
    assert(r.type, 'Missing type');
    assert(r.content, 'Missing content');
    assert(Array.isArray(r.tags), 'tags should be array');
    assert(r._source === 'knowledge-graph', `_source should be knowledge-graph, got ${r._source}`);
    assert(r._entityName, 'Missing _entityName');
    assert(r._entityType, 'Missing _entityType');
  });

  await test('query matches entity name', async () => {
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    const results = await adapter.query(
      { tags: ['git', 'workflow'], intentConfidence: 0 },
      { limit: 5 }
    );
    const gitResult = results.find(r => r._entityName === 'Git Workflow');
    assert(gitResult, 'Should find Git Workflow entity');
  });

  await test('query matches observation content', async () => {
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    const results = await adapter.query(
      { tags: ['hyprland'], intentConfidence: 0 },
      { limit: 5 }
    );
    assert(results.length > 0, 'Should find entity with Hyprland in observations');
  });

  await test('query returns empty for no matches', async () => {
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    const results = await adapter.query(
      { tags: ['xyzzy_nonexistent_12345'], intentConfidence: 0 },
      { limit: 5 }
    );
    assert.strictEqual(results.length, 0, `Expected 0, got ${results.length}`);
  });

  await test('empty tags returns all entities', async () => {
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    const results = await adapter.query(
      { tags: [], intentConfidence: 0 },
      { limit: 50 }
    );
    assert.strictEqual(results.length, 5, `Expected 5 entities, got ${results.length}`);
  });

  // -------------------------------------------------------------------------
  // Entity type mapping
  // -------------------------------------------------------------------------

  console.log('\n▸ Entity Type Mapping');

  await test('maps entity types to memory types correctly', async () => {
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    const results = await adapter.query(
      { tags: [], intentConfidence: 0 },
      { limit: 50 }
    );

    const typeMap = {};
    for (const r of results) {
      typeMap[r._entityType] = r.type;
    }

    assert.strictEqual(typeMap['feature'], 'skill', `feature should map to skill, got ${typeMap['feature']}`);
    assert.strictEqual(typeMap['learning'], 'learning', `learning should map to learning`);
    assert.strictEqual(typeMap['project'], 'learning', `project should map to learning`);
    assert.strictEqual(typeMap['preference'], 'preference', `preference should map to preference`);
    assert.strictEqual(typeMap['pattern'], 'pattern', `pattern should map to pattern`);
  });

  // -------------------------------------------------------------------------
  // getByNames
  // -------------------------------------------------------------------------

  console.log('\n▸ getByNames');

  await test('getByNames returns matching entities', async () => {
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    const results = await adapter.getByNames(['Cortex Vector Search', 'Git Workflow']);
    assert.strictEqual(results.length, 2, `Expected 2, got ${results.length}`);
  });

  await test('getByNames is case-insensitive', async () => {
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    const results = await adapter.getByNames(['cortex vector search']);
    assert.strictEqual(results.length, 1, 'Should find by lowercase name');
  });

  await test('getByNames returns empty for unknown names', async () => {
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    const results = await adapter.getByNames(['NonExistentEntity']);
    assert.strictEqual(results.length, 0);
  });

  // -------------------------------------------------------------------------
  // readFullGraph
  // -------------------------------------------------------------------------

  console.log('\n▸ readFullGraph');

  await test('readFullGraph returns entities and relations', async () => {
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    const graph = await adapter.readFullGraph();
    assert.strictEqual(graph.entities.length, 5, `Expected 5 entities, got ${graph.entities.length}`);
    assert.strictEqual(graph.relations.length, 2, `Expected 2 relations, got ${graph.relations.length}`);
  });

  await test('getRelationsFor returns related entities', () => {
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    const rels = adapter.getRelationsFor('Cortex Vector Search');
    assert.strictEqual(rels.length, 1, `Expected 1 relation, got ${rels.length}`);
    assert.strictEqual(rels[0].relationType, 'part_of');
  });

  // -------------------------------------------------------------------------
  // Write Operations
  // -------------------------------------------------------------------------

  console.log('\n▸ Write Operations');

  await test('createEntities adds new entities', async () => {
    createFixture();  // Reset
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });

    const result = await adapter.createEntities([
      { name: 'New Entity', entityType: 'test', observations: ['Created by test'] },
    ]);

    assert(result.success, `Should succeed: ${result.error}`);

    const graph = await adapter.readFullGraph();
    assert.strictEqual(graph.entities.length, 6, `Expected 6, got ${graph.entities.length}`);
  });

  await test('delete removes entity and its relations', async () => {
    createFixture();
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });

    const result = await adapter.delete('kg:Wayland Cedilla Fix');
    assert(result.success, `Should succeed: ${result.error}`);

    const graph = await adapter.readFullGraph();
    assert.strictEqual(graph.entities.length, 4, `Expected 4 entities, got ${graph.entities.length}`);
    // The relation from Wayland Cedilla Fix should also be gone
    assert.strictEqual(graph.relations.length, 1, `Expected 1 relation, got ${graph.relations.length}`);
  });

  await test('update adds observations to existing entity', async () => {
    createFixture();
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });

    const result = await adapter.update('kg:Git Workflow', {
      content: 'New observation added by test',
    });

    assert(result.success, `Should succeed: ${result.error}`);

    const entities = await adapter.getByNames(['Git Workflow']);
    assert(entities.length > 0, 'Should find entity');
    assert(
      entities[0].content.includes('New observation added by test'),
      'Should contain new observation'
    );
  });

  // -------------------------------------------------------------------------
  // Caching
  // -------------------------------------------------------------------------

  console.log('\n▸ Caching');

  await test('second identical query uses cache', async () => {
    createFixture();
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    const query = { tags: ['vector'], intentConfidence: 0 };
    const opts = { limit: 5 };

    await adapter.query(query, opts);
    const t = Date.now();
    await adapter.query(query, opts);
    const cached = Date.now() - t;

    assert(cached < 10, `Cached query should be fast (${cached}ms)`);
  });

  await test('clearCache invalidates cache', async () => {
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    await adapter.query({ tags: ['test'], intentConfidence: 0 }, { limit: 1 });
    adapter.clearCache();
    assert.strictEqual(adapter._cache.size, 0);
  });

  // -------------------------------------------------------------------------
  // Edge Cases
  // -------------------------------------------------------------------------

  console.log('\n▸ Edge Cases');

  await test('handles nonexistent file gracefully', async () => {
    const adapter = new KnowledgeGraphAdapter({ filePath: '/nonexistent.jsonl' });
    const available = await adapter.isAvailable();
    assert.strictEqual(available, false);

    const results = await adapter.query(
      { tags: ['test'], intentConfidence: 0 },
      { limit: 5 }
    );
    assert.strictEqual(results.length, 0);
  });

  await test('handles empty file gracefully', async () => {
    fs.writeFileSync(tmpPath, '');
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    const results = await adapter.query(
      { tags: ['test'], intentConfidence: 0 },
      { limit: 5 }
    );
    assert.strictEqual(results.length, 0);
  });

  await test('handles malformed JSONL gracefully', async () => {
    fs.writeFileSync(tmpPath, 'not json\n{"type":"entity","name":"Valid","entityType":"test","observations":["ok"]}\nbroken\n');
    const adapter = new KnowledgeGraphAdapter({ filePath: tmpPath });
    const graph = await adapter.readFullGraph();
    assert.strictEqual(graph.entities.length, 1, 'Should skip malformed lines');
  });

  await test('setMcpCaller works for backward compat', () => {
    const adapter = new KnowledgeGraphAdapter();
    adapter.setMcpCaller(() => {});
    assert.strictEqual(typeof adapter.mcpCaller, 'function');

    assert.throws(
      () => adapter.setMcpCaller('not a function'),
      /mcpCaller must be a function/
    );
  });

  // =========================================================================
  // CLEANUP & RESULTS
  // =========================================================================

  cleanupFixture();

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
