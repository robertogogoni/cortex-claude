#!/usr/bin/env node
/**
 * Cortex - Claude's Cognitive Layer - Adapter Integration Tests
 *
 * Tests for the multi-source adapter system:
 * - BaseAdapter interface
 * - JSONLAdapter (local storage)
 * - EpisodicMemoryAdapter (MCP - mocked)
 * - KnowledgeGraphAdapter (MCP - mocked)
 * - ClaudeMdAdapter (file parsing)
 * - AdapterRegistry (coordination)
 *
 * @version 1.1.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// Test utilities
const TEST_DIR = path.join(os.tmpdir(), 'cmo-adapter-test-' + Date.now());

function setup() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'data', 'memories'), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'data', 'skills'), { recursive: true });
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
    if (error.stack) {
      console.log(`    Stack: ${error.stack.split('\n').slice(1, 3).join('\n    ')}`);
    }
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
    if (error.stack) {
      console.log(`    Stack: ${error.stack.split('\n').slice(1, 3).join('\n    ')}`);
    }
    return false;
  }
}

// =============================================================================
// IMPORT MODULES
// =============================================================================

let BaseAdapter, JSONLAdapter, EpisodicMemoryAdapter, KnowledgeGraphAdapter;
let ClaudeMdAdapter, AdapterRegistry, createDefaultRegistry;

try {
  ({ BaseAdapter } = require('../adapters/base-adapter.cjs'));
  ({ JSONLAdapter } = require('../adapters/jsonl-adapter.cjs'));
  ({ EpisodicMemoryAdapter } = require('../adapters/episodic-memory-adapter.cjs'));
  ({ KnowledgeGraphAdapter } = require('../adapters/knowledge-graph-adapter.cjs'));
  ({ ClaudeMdAdapter } = require('../adapters/claudemd-adapter.cjs'));
  ({ AdapterRegistry, createDefaultRegistry } = require('../adapters/index.cjs'));
} catch (error) {
  console.error('Failed to import adapter modules:', error.message);
  console.error(error.stack);
  process.exit(1);
}

// =============================================================================
// BASE ADAPTER TESTS
// =============================================================================

async function runBaseAdapterTests() {
  console.log('\n📋 BaseAdapter Tests');
  let passed = 0;
  let total = 0;

  // Test: BaseAdapter cannot be instantiated directly
  total++;
  if (test('BaseAdapter is abstract (cannot be instantiated)', () => {
    assert.throws(
      () => new BaseAdapter({ name: 'test' }),
      /BaseAdapter is abstract/
    );
  })) passed++;

  // Test: Subclass must implement query()
  total++;
  if (await testAsync('Subclass must implement query()', async () => {
    class TestAdapter extends BaseAdapter {
      constructor() {
        super({ name: 'test' });
      }
      // Missing query() implementation
    }
    const adapter = new TestAdapter();
    await assert.rejects(
      async () => adapter.query({}),
      /query\(\) must be implemented/
    );
  })) passed++;

  // Test: Default properties
  total++;
  if (test('BaseAdapter has correct default properties', () => {
    class TestAdapter extends BaseAdapter {
      constructor() {
        super({ name: 'test-adapter' });
      }
      async query() { return []; }
    }
    const adapter = new TestAdapter();
    assert.strictEqual(adapter.name, 'test-adapter');
    assert.strictEqual(adapter.enabled, true);
    assert.strictEqual(adapter.priority, 0.5);
    assert.strictEqual(adapter.timeout, 500);  // Default is 500ms
  })) passed++;

  // Test: Custom options
  total++;
  if (test('BaseAdapter accepts custom options', () => {
    class TestAdapter extends BaseAdapter {
      constructor() {
        super({
          name: 'custom',
          enabled: false,
          priority: 0.9,
          timeout: 10000,
        });
      }
      async query() { return []; }
    }
    const adapter = new TestAdapter();
    assert.strictEqual(adapter.enabled, false);
    assert.strictEqual(adapter.priority, 0.9);
    assert.strictEqual(adapter.timeout, 10000);
  })) passed++;

  // Test: getStats returns valid structure
  total++;
  if (await testAsync('getStats returns valid structure', async () => {
    class TestAdapter extends BaseAdapter {
      constructor() {
        super({ name: 'stats-test' });
      }
      async query() { return []; }
      async isAvailable() { return true; }
      normalize(data) { return data; }
    }
    const adapter = new TestAdapter();
    const stats = await adapter.getStats();
    assert.strictEqual(stats.name, 'stats-test');
    assert.strictEqual(typeof stats.available, 'boolean');
    assert.strictEqual(typeof stats.totalRecords, 'number');
  })) passed++;

  return { passed, total };
}

// =============================================================================
// JSONL ADAPTER TESTS
// =============================================================================

async function runJSONLAdapterTests() {
  console.log('\n📋 JSONLAdapter Tests');
  let passed = 0;
  let total = 0;

  // Create test data
  const testData = [
    { id: '1', type: 'learning', summary: 'Git rebase workflow', tags: ['git', 'workflow'] },
    { id: '2', type: 'pattern', summary: 'Error handling pattern', content: 'Use try-catch with specific error types', tags: ['error', 'pattern'] },
    { id: '3', type: 'skill', summary: 'Docker compose setup', tags: ['docker', 'devops'] },
    { id: '4', type: 'correction', summary: 'Fixed typo in function name', tags: ['fix'] },
  ];

  // Setup test files
  const longTermPath = path.join(TEST_DIR, 'data', 'memories', 'long-term.jsonl');
  fs.writeFileSync(longTermPath, testData.map(d => JSON.stringify(d)).join('\n') + '\n');

  // Test: Constructor
  total++;
  if (test('JSONLAdapter constructs with options', () => {
    const adapter = new JSONLAdapter({
      basePath: TEST_DIR,
      sources: [
        { name: 'long-term', path: 'data/memories/long-term.jsonl' },
      ],
    });
    assert.strictEqual(adapter.name, 'jsonl');
    assert.strictEqual(adapter.priority, 1.0);
  })) passed++;

  // Test: Query returns all records
  total++;
  if (await testAsync('Query returns all records when no filters', async () => {
    const adapter = new JSONLAdapter({
      basePath: TEST_DIR,
      sources: [{ name: 'long-term', path: 'data/memories/long-term.jsonl' }],
    });
    const results = await adapter.query({});
    assert.strictEqual(results.length, 4);
    assert.ok(results.every(r => r._source === 'jsonl:long-term'));
  })) passed++;

  // Test: Query filters by type
  total++;
  if (await testAsync('Query filters by type', async () => {
    const adapter = new JSONLAdapter({
      basePath: TEST_DIR,
      sources: [{ name: 'long-term', path: 'data/memories/long-term.jsonl' }],
    });
    const results = await adapter.query({}, { types: ['learning'] });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].type, 'learning');
  })) passed++;

  // Test: Query with context (tags passed but not filtered by adapter - registry/orchestrator handles context)
  total++;
  if (await testAsync('Query accepts context with tags', async () => {
    const adapter = new JSONLAdapter({
      basePath: TEST_DIR,
      sources: [{ name: 'long-term', path: 'data/memories/long-term.jsonl' }],
    });
    // Tags are used for relevance scoring in orchestrator, not filtering in adapter
    const results = await adapter.query({ tags: ['git'] });
    assert.ok(results.length >= 1, 'Should return results');
    assert.ok(results.every(r => r._source === 'jsonl:long-term'), 'All results should have correct source');
  })) passed++;

  // Test: Query respects limit
  total++;
  if (await testAsync('Query respects limit option', async () => {
    const adapter = new JSONLAdapter({
      basePath: TEST_DIR,
      sources: [{ name: 'long-term', path: 'data/memories/long-term.jsonl' }],
    });
    const results = await adapter.query({}, { limit: 2 });
    assert.strictEqual(results.length, 2);
  })) passed++;

  // Test: Multiple sources
  total++;
  if (await testAsync('Query combines multiple sources', async () => {
    // Create working memory
    const workingPath = path.join(TEST_DIR, 'data', 'memories', 'working.jsonl');
    fs.writeFileSync(workingPath, JSON.stringify({ id: 'w1', type: 'learning', summary: 'Recent learning' }) + '\n');

    const adapter = new JSONLAdapter({
      basePath: TEST_DIR,
      sources: [
        { name: 'working', path: 'data/memories/working.jsonl' },
        { name: 'long-term', path: 'data/memories/long-term.jsonl' },
      ],
    });
    const results = await adapter.query({});
    assert.strictEqual(results.length, 5);
    assert.ok(results.some(r => r._source === 'jsonl:working'));
    assert.ok(results.some(r => r._source === 'jsonl:long-term'));
  })) passed++;

  // Test: Empty file handling
  total++;
  if (await testAsync('Handles empty files gracefully', async () => {
    const emptyPath = path.join(TEST_DIR, 'data', 'memories', 'empty.jsonl');
    fs.writeFileSync(emptyPath, '');

    const adapter = new JSONLAdapter({
      basePath: TEST_DIR,
      sources: [{ name: 'empty', path: 'data/memories/empty.jsonl' }],
    });
    const results = await adapter.query({});
    assert.strictEqual(results.length, 0);
  })) passed++;

  // Test: Missing file handling
  total++;
  if (await testAsync('Handles missing files gracefully', async () => {
    const adapter = new JSONLAdapter({
      basePath: TEST_DIR,
      sources: [{ name: 'missing', path: 'data/memories/nonexistent.jsonl' }],
    });
    const results = await adapter.query({});
    assert.strictEqual(results.length, 0);
  })) passed++;

  // Test: Invalid JSON lines
  total++;
  if (await testAsync('Handles invalid JSON lines gracefully', async () => {
    const invalidPath = path.join(TEST_DIR, 'data', 'memories', 'invalid2.jsonl');
    fs.writeFileSync(invalidPath, '{"id":"v1","valid":true}\ninvalid json line\n{"id":"v2","also":"valid"}\n');

    const adapter = new JSONLAdapter({
      basePath: TEST_DIR,
      sources: [{ name: 'invalid2', path: 'data/memories/invalid2.jsonl' }],
    });
    const results = await adapter.query({});
    // Should skip invalid lines and return valid ones
    assert.ok(results.length >= 1, 'Should return at least one valid result');
    assert.ok(results.every(r => r._source === 'jsonl:invalid2'), 'All results should have correct source');
  })) passed++;

  // Test: getStats
  total++;
  if (await testAsync('getStats returns accurate counts', async () => {
    const adapter = new JSONLAdapter({
      basePath: TEST_DIR,
      sources: [{ name: 'long-term', path: 'data/memories/long-term.jsonl' }],
    });
    const stats = await adapter.getStats();
    assert.strictEqual(stats.name, 'jsonl');
    assert.strictEqual(stats.available, true);
    assert.strictEqual(stats.totalRecords, 4);
  })) passed++;

  return { passed, total };
}

// =============================================================================
// EPISODIC MEMORY ADAPTER TESTS
// =============================================================================

async function runEpisodicMemoryAdapterTests() {
  console.log('\n📋 EpisodicMemoryAdapter Tests');
  let passed = 0;
  let total = 0;

  // Mock MCP caller
  const mockMcpResults = [
    { title: 'Session 1', snippet: 'Discussed git workflow', date: '2026-01-20' },
    { title: 'Session 2', snippet: 'Fixed Docker build issue', date: '2026-01-21' },
  ];

  const mockMcpCaller = async (tool, params) => {
    if (tool === 'mcp__plugin_episodic-memory_episodic-memory__search') {
      return { results: mockMcpResults };
    }
    throw new Error('Unknown tool');
  };

  // Test: Constructor without mcpCaller
  total++;
  if (test('EpisodicMemoryAdapter constructs without mcpCaller', () => {
    const adapter = new EpisodicMemoryAdapter({});
    assert.strictEqual(adapter.name, 'episodic-memory');
    assert.strictEqual(adapter.priority, 0.9);
  })) passed++;

  // Test: Query fails without mcpCaller
  total++;
  if (await testAsync('Query throws error without mcpCaller', async () => {
    const adapter = new EpisodicMemoryAdapter({});
    await assert.rejects(
      async () => adapter.query({}),
      /requires mcpCaller/
    );
  })) passed++;

  // Test: Query with mcpCaller
  total++;
  if (await testAsync('Query returns results with mcpCaller', async () => {
    const adapter = new EpisodicMemoryAdapter({
      mcpCaller: mockMcpCaller,
    });
    const results = await adapter.query({ tags: ['git'] });
    assert.strictEqual(results.length, 2);
    assert.ok(results.every(r => r._source === 'episodic-memory'), 'All results should have episodic-memory source');
    // Type is inferred from content, not fixed as 'episodic'
    assert.ok(results.every(r => ['learning', 'pattern', 'skill', 'correction', 'preference'].includes(r.type)),
      'All results should have valid memory type');
  })) passed++;

  // Test: enabled flag is available (enforcement happens at registry level)
  total++;
  if (await testAsync('enabled flag is set correctly', async () => {
    const adapter = new EpisodicMemoryAdapter({
      enabled: false,
      mcpCaller: mockMcpCaller,
    });
    // The adapter stores the enabled flag - registry checks it before calling query
    assert.strictEqual(adapter.enabled, false, 'enabled should be false');
  })) passed++;

  // Test: Handles MCP errors gracefully
  total++;
  if (await testAsync('Handles MCP errors gracefully', async () => {
    const errorMcpCaller = async () => { throw new Error('MCP server unavailable'); };
    const adapter = new EpisodicMemoryAdapter({
      mcpCaller: errorMcpCaller,
    });
    await assert.rejects(
      async () => adapter.query({}),
      /MCP server unavailable/
    );
  })) passed++;

  // Test: setMcpCaller
  total++;
  if (await testAsync('setMcpCaller allows late binding', async () => {
    const adapter = new EpisodicMemoryAdapter({});
    adapter.mcpCaller = mockMcpCaller;
    const results = await adapter.query({});
    assert.strictEqual(results.length, 2);
  })) passed++;

  return { passed, total };
}

// =============================================================================
// KNOWLEDGE GRAPH ADAPTER TESTS
// =============================================================================

async function runKnowledgeGraphAdapterTests() {
  console.log('\n📋 KnowledgeGraphAdapter Tests');
  let passed = 0;
  let total = 0;

  // Mock MCP caller
  const mockEntities = [
    { name: 'React', entityType: 'technology', observations: ['Frontend framework', 'Component-based'] },
    { name: 'NextJS', entityType: 'framework', observations: ['Built on React', 'Server-side rendering'] },
  ];

  const mockMcpCaller = async (tool, params) => {
    if (tool === 'mcp__memory__search_nodes') {
      return { entities: mockEntities };
    }
    throw new Error('Unknown tool');
  };

  // Test: Constructor
  total++;
  if (test('KnowledgeGraphAdapter constructs correctly', () => {
    const adapter = new KnowledgeGraphAdapter({});
    assert.strictEqual(adapter.name, 'knowledge-graph');
    assert.strictEqual(adapter.priority, 0.8);
  })) passed++;

  // Test: Query without mcpCaller
  total++;
  if (await testAsync('Query throws error without mcpCaller', async () => {
    const adapter = new KnowledgeGraphAdapter({});
    await assert.rejects(
      async () => adapter.query({}),
      /requires mcpCaller/
    );
  })) passed++;

  // Test: Query with mcpCaller
  total++;
  if (await testAsync('Query returns formatted entities', async () => {
    const adapter = new KnowledgeGraphAdapter({
      mcpCaller: mockMcpCaller,
    });
    const results = await adapter.query({ tags: ['React'] });
    assert.strictEqual(results.length, 2);
    assert.ok(results.every(r => r._source === 'knowledge-graph'), 'All results should have knowledge-graph source');
    // Type is mapped from entityType, not fixed as 'entity'
    assert.ok(results.every(r => ['learning', 'pattern', 'skill', 'correction', 'preference'].includes(r.type)),
      'All results should have valid memory type');
  })) passed++;

  // Test: Entity formatting
  total++;
  if (await testAsync('Entities are formatted correctly', async () => {
    const adapter = new KnowledgeGraphAdapter({
      mcpCaller: mockMcpCaller,
    });
    const results = await adapter.query({});
    // Find the React entity by checking _entityName or content
    const reactEntity = results.find(r => r._entityName === 'React' || r.summary?.includes('Frontend'));
    assert.ok(reactEntity, 'Should find React entity');
    // Content comes from observations joined with newlines
    assert.ok(reactEntity.content.includes('Frontend framework'), 'Content should include observation');
    // Tags include entityType (lowercased)
    assert.ok(reactEntity.tags.includes('technology'), 'Tags should include entity type');
  })) passed++;

  return { passed, total };
}

// =============================================================================
// CLAUDE.MD ADAPTER TESTS
// =============================================================================

async function runClaudeMdAdapterTests() {
  console.log('\n📋 ClaudeMdAdapter Tests');
  let passed = 0;
  let total = 0;

  // Create test CLAUDE.md file
  const testClaudeMd = `# Test Project

## Quick Reference

- **API Key**: Store in environment variables
- **Database**: PostgreSQL

## Learnings

- Always use parameterized queries
- Implement retry logic for network calls

## Patterns

- Use repository pattern for data access layer
- Implement circuit breaker for external APIs

### Error Handling

\`\`\`javascript
try {
  await api.call();
} catch (error) {
  logger.error(error);
  throw new AppError(error.message);
}
\`\`\`

## Recent Fixes

- Fixed memory leak in worker process
- Resolved race condition in cache
`;

  const claudeMdPath = path.join(TEST_DIR, 'CLAUDE.md');
  fs.writeFileSync(claudeMdPath, testClaudeMd);

  // Test: Constructor
  total++;
  if (test('ClaudeMdAdapter constructs correctly', () => {
    const adapter = new ClaudeMdAdapter({
      paths: [claudeMdPath],
    });
    assert.strictEqual(adapter.name, 'claudemd');
    assert.strictEqual(adapter.priority, 0.85);
  })) passed++;

  // Test: Query parses sections
  total++;
  if (await testAsync('Query parses markdown sections', async () => {
    const adapter = new ClaudeMdAdapter({
      paths: [claudeMdPath],
    });
    const results = await adapter.query({});
    assert.ok(results.length > 0);
    assert.ok(results.every(r => r._source === 'claudemd'));
  })) passed++;

  // Test: Detects learning sections
  total++;
  if (await testAsync('Detects learning type from section headers', async () => {
    const adapter = new ClaudeMdAdapter({
      paths: [claudeMdPath],
    });
    const results = await adapter.query({});
    const learnings = results.filter(r => r.type === 'learning');
    assert.ok(learnings.length > 0);
  })) passed++;

  // Test: Detects pattern sections
  total++;
  if (await testAsync('Detects pattern type from section headers', async () => {
    const adapter = new ClaudeMdAdapter({
      paths: [claudeMdPath],
    });
    const results = await adapter.query({});
    const patterns = results.filter(r => r.type === 'pattern');
    assert.ok(patterns.length > 0);
  })) passed++;

  // Test: Handles missing files
  total++;
  if (await testAsync('Handles missing files gracefully', async () => {
    const adapter = new ClaudeMdAdapter({
      paths: ['/nonexistent/CLAUDE.md'],
    });
    const results = await adapter.query({});
    assert.strictEqual(results.length, 0);
  })) passed++;

  // Test: Multiple paths
  total++;
  if (await testAsync('Combines multiple CLAUDE.md files', async () => {
    const secondPath = path.join(TEST_DIR, 'project', 'CLAUDE.md');
    fs.mkdirSync(path.join(TEST_DIR, 'project'), { recursive: true });
    fs.writeFileSync(secondPath, '## Skills\n\n- Docker deployment\n');

    const adapter = new ClaudeMdAdapter({
      paths: [claudeMdPath, secondPath],
    });
    const results = await adapter.query({});
    assert.ok(results.length > 0);
  })) passed++;

  // Test: Cache works
  total++;
  if (await testAsync('Caching prevents redundant parsing', async () => {
    const adapter = new ClaudeMdAdapter({
      paths: [claudeMdPath],
      cacheTimeout: 60000,
    });

    // First query
    const results1 = await adapter.query({});

    // Modify file (but cache should still return old content)
    fs.appendFileSync(claudeMdPath, '\n## New Section\n');

    // Second query (should be cached)
    const results2 = await adapter.query({});

    assert.strictEqual(results1.length, results2.length);
  })) passed++;

  return { passed, total };
}

// =============================================================================
// ADAPTER REGISTRY TESTS
// =============================================================================

async function runAdapterRegistryTests() {
  console.log('\n📋 AdapterRegistry Tests');
  let passed = 0;
  let total = 0;

  // Test: Registry constructor
  total++;
  if (test('AdapterRegistry constructs correctly', () => {
    const registry = new AdapterRegistry();
    assert.ok(registry);
  })) passed++;

  // Test: Register adapter
  total++;
  if (test('Can register adapters', () => {
    const registry = new AdapterRegistry();
    const adapter = new JSONLAdapter({ basePath: TEST_DIR });
    registry.register(adapter);
    assert.strictEqual(registry.get('jsonl'), adapter);
  })) passed++;

  // Test: Rejects non-adapters
  total++;
  if (test('Rejects non-BaseAdapter objects', () => {
    const registry = new AdapterRegistry();
    assert.throws(
      () => registry.register({ name: 'fake' }),
      /must extend BaseAdapter/
    );
  })) passed++;

  // Test: getAll
  total++;
  if (test('getAll returns all registered adapters', () => {
    const registry = new AdapterRegistry();
    registry.register(new JSONLAdapter({ basePath: TEST_DIR }));
    registry.register(new ClaudeMdAdapter({ paths: [] }));
    const all = registry.getAll();
    assert.strictEqual(all.length, 2);
  })) passed++;

  // Test: getEnabled
  total++;
  if (test('getEnabled filters disabled adapters', () => {
    const registry = new AdapterRegistry();
    registry.register(new JSONLAdapter({ basePath: TEST_DIR }));
    registry.register(new ClaudeMdAdapter({ paths: [], enabled: false }));
    const enabled = registry.getEnabled();
    assert.strictEqual(enabled.length, 1);
    assert.strictEqual(enabled[0].name, 'jsonl');
  })) passed++;

  // Test: setEnabled
  total++;
  if (test('setEnabled toggles adapter state', () => {
    const registry = new AdapterRegistry();
    registry.register(new JSONLAdapter({ basePath: TEST_DIR }));
    registry.setEnabled('jsonl', false);
    assert.strictEqual(registry.get('jsonl').enabled, false);
    registry.setEnabled('jsonl', true);
    assert.strictEqual(registry.get('jsonl').enabled, true);
  })) passed++;

  // Test: Priority sorting
  total++;
  if (test('getEnabled sorts by priority (highest first)', () => {
    const registry = new AdapterRegistry();
    registry.register(new ClaudeMdAdapter({ paths: [] })); // priority 0.85
    registry.register(new JSONLAdapter({ basePath: TEST_DIR })); // priority 1.0
    const enabled = registry.getEnabled();
    assert.strictEqual(enabled[0].name, 'jsonl');
    assert.strictEqual(enabled[1].name, 'claudemd');
  })) passed++;

  // Test: queryAll
  total++;
  if (await testAsync('queryAll queries all enabled adapters', async () => {
    // Create test data
    const longTermPath = path.join(TEST_DIR, 'data', 'memories', 'long-term.jsonl');
    fs.writeFileSync(longTermPath, JSON.stringify({ id: '1', type: 'learning', summary: 'Test' }) + '\n');

    const claudeMdPath = path.join(TEST_DIR, 'CLAUDE.md');
    fs.writeFileSync(claudeMdPath, '## Learnings\n- Test learning\n');

    const registry = new AdapterRegistry();
    registry.register(new JSONLAdapter({
      basePath: TEST_DIR,
      sources: [{ name: 'long-term', path: 'data/memories/long-term.jsonl' }],
    }));
    registry.register(new ClaudeMdAdapter({ paths: [claudeMdPath] }));

    const { results, stats } = await registry.queryAll({});
    assert.ok(results.length >= 2);
    assert.ok(stats.jsonl);
    assert.ok(stats.claudemd);
  })) passed++;

  // Test: queryAll graceful degradation
  total++;
  if (await testAsync('queryAll continues when adapter fails', async () => {
    const registry = new AdapterRegistry({ verbose: false });

    // Working adapter
    registry.register(new JSONLAdapter({
      basePath: TEST_DIR,
      sources: [{ name: 'long-term', path: 'data/memories/long-term.jsonl' }],
    }));

    // Failing adapter (no mcpCaller)
    registry.register(new EpisodicMemoryAdapter({ enabled: true }));

    const { results, stats } = await registry.queryAll({});

    // JSONL should succeed, Episodic should fail
    assert.ok(results.length >= 1);
    assert.strictEqual(stats.jsonl.available, true);
    assert.strictEqual(stats['episodic-memory'].available, false);
  })) passed++;

  // Test: setMcpCaller propagates
  total++;
  if (test('setMcpCaller propagates to all adapters', () => {
    const mockCaller = async () => ({ results: [] });
    const registry = new AdapterRegistry();
    registry.register(new EpisodicMemoryAdapter({}));
    registry.register(new KnowledgeGraphAdapter({}));
    registry.setMcpCaller(mockCaller);

    const episodic = registry.get('episodic-memory');
    const kg = registry.get('knowledge-graph');
    assert.strictEqual(episodic.mcpCaller, mockCaller);
    assert.strictEqual(kg.mcpCaller, mockCaller);
  })) passed++;

  return { passed, total };
}

// =============================================================================
// FACTORY TESTS
// =============================================================================

async function runFactoryTests() {
  console.log('\n📋 createDefaultRegistry Factory Tests');
  let passed = 0;
  let total = 0;

  // Test: Creates registry with all adapters
  total++;
  if (test('Creates registry with all 5 adapters', () => {
    const registry = createDefaultRegistry({
      basePath: TEST_DIR,
      verbose: false,
    });
    const all = registry.getAll();
    assert.strictEqual(all.length, 5);
    assert.ok(registry.get('jsonl'));
    assert.ok(registry.get('episodic-memory'));
    assert.ok(registry.get('knowledge-graph'));
    assert.ok(registry.get('claudemd'));
    assert.ok(registry.get('gemini'));
  })) passed++;

  // Test: Custom adapter config
  total++;
  if (test('Accepts custom adapter configuration', () => {
    const registry = createDefaultRegistry({
      basePath: TEST_DIR,
      verbose: false,
      adapters: {
        episodicMemory: { enabled: false },
        knowledgeGraph: { enabled: false },
      },
    });
    assert.strictEqual(registry.get('episodic-memory').enabled, false);
    assert.strictEqual(registry.get('knowledge-graph').enabled, false);
    assert.strictEqual(registry.get('jsonl').enabled, true);
    assert.strictEqual(registry.get('claudemd').enabled, true);
  })) passed++;

  // Test: MCP caller injection
  total++;
  if (test('Injects mcpCaller to MCP adapters', () => {
    const mockCaller = async () => ({});
    const registry = createDefaultRegistry({
      basePath: TEST_DIR,
      mcpCaller: mockCaller,
      verbose: false,
    });
    assert.strictEqual(registry.get('episodic-memory').mcpCaller, mockCaller);
    assert.strictEqual(registry.get('knowledge-graph').mcpCaller, mockCaller);
  })) passed++;

  return { passed, total };
}

// =============================================================================
// RUN ALL TESTS
// =============================================================================

async function runAllTests() {
  console.log('═'.repeat(60));
  console.log('🧪 Cortex Adapter Integration Tests');
  console.log('═'.repeat(60));

  setup();

  let totalPassed = 0;
  let totalTests = 0;

  try {
    // Run test suites (all async now)
    const baseResults = await runBaseAdapterTests();
    totalPassed += baseResults.passed;
    totalTests += baseResults.total;

    const jsonlResults = await runJSONLAdapterTests();
    totalPassed += jsonlResults.passed;
    totalTests += jsonlResults.total;

    const episodicResults = await runEpisodicMemoryAdapterTests();
    totalPassed += episodicResults.passed;
    totalTests += episodicResults.total;

    const kgResults = await runKnowledgeGraphAdapterTests();
    totalPassed += kgResults.passed;
    totalTests += kgResults.total;

    const claudeMdResults = await runClaudeMdAdapterTests();
    totalPassed += claudeMdResults.passed;
    totalTests += claudeMdResults.total;

    const registryResults = await runAdapterRegistryTests();
    totalPassed += registryResults.passed;
    totalTests += registryResults.total;

    const factoryResults = await runFactoryTests();
    totalPassed += factoryResults.passed;
    totalTests += factoryResults.total;

  } finally {
    cleanup();
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log(`📊 Results: ${totalPassed}/${totalTests} tests passed`);

  if (totalPassed === totalTests) {
    console.log('✅ All tests passed!');
  } else {
    console.log(`❌ ${totalTests - totalPassed} tests failed`);
    process.exit(1);
  }
}

// Run
runAllTests().catch(error => {
  console.error('Test runner failed:', error.message);
  cleanup();
  process.exit(1);
});
