#!/usr/bin/env node
/**
 * Cortex - Claude's Cognitive Layer - WarpSQLiteAdapter Tests
 *
 * TDD tests for WarpSQLiteAdapter - reads Warp Terminal AI history.
 * Following the test patterns from test-sqlite-store.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const Database = require('better-sqlite3');

// Test utilities
const TEST_DIR = path.join(os.tmpdir(), 'warp-adapter-test-' + Date.now());

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
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    if (error.stack) {
      console.log(`    ${error.stack.split('\n').slice(1, 3).join('\n    ')}`);
    }
    return false;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    if (error.stack) {
      console.log(`    ${error.stack.split('\n').slice(1, 3).join('\n    ')}`);
    }
    return false;
  }
}

// =============================================================================
// MOCK DATABASE HELPER
// =============================================================================

/**
 * Create a mock Warp SQLite database with test data
 * @param {string} dbPath - Path to create database
 * @param {Object} [options] - Options for mock data
 * @returns {string} Path to created database
 */
function createMockWarpDatabase(dbPath, options = {}) {
  const db = new Database(dbPath);

  // Create ai_queries table (Warp schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS "ai_queries" (
      id INTEGER PRIMARY KEY NOT NULL,
      exchange_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      start_ts DATETIME NOT NULL,
      input TEXT NOT NULL,
      working_directory TEXT,
      output_status TEXT NOT NULL,
      model_id TEXT NOT NULL DEFAULT '',
      planning_model_id TEXT NOT NULL DEFAULT '',
      coding_model_id TEXT NOT NULL DEFAULT ''
    )
  `);

  // Create ai_agent_conversations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS "ai_agent_conversations" (
      id INTEGER PRIMARY KEY NOT NULL,
      conversation_id TEXT NOT NULL,
      conversation_data TEXT NOT NULL,
      last_modified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert mock ai_queries if requested
  if (options.queries !== false) {
    const queries = options.queries || [
      {
        exchange_id: 'ex-001',
        conversation_id: 'conv-001',
        start_ts: '2024-01-15T10:30:00Z',
        input: JSON.stringify({
          query: 'How do I fix this TypeScript error?',
          context: 'Working on a React project',
          attachments: [],
        }),
        working_directory: '/home/user/projects/react-app',
        output_status: 'success',
        model_id: 'gpt-4',
      },
      {
        exchange_id: 'ex-002',
        conversation_id: 'conv-001',
        start_ts: '2024-01-15T10:35:00Z',
        input: JSON.stringify({
          query: 'Now help me write tests for this component',
          context: 'Jest and React Testing Library',
          attachments: [],
        }),
        working_directory: '/home/user/projects/react-app',
        output_status: 'success',
        model_id: 'gpt-4',
      },
      {
        exchange_id: 'ex-003',
        conversation_id: 'conv-002',
        start_ts: '2024-01-16T14:00:00Z',
        input: JSON.stringify({
          query: 'How to configure Docker for production?',
          context: 'Deploying Node.js app',
          attachments: [],
        }),
        working_directory: '/home/user/projects/api-server',
        output_status: 'success',
        model_id: 'claude-3-sonnet',
      },
      {
        exchange_id: 'ex-004',
        conversation_id: 'conv-003',
        start_ts: '2024-01-17T09:00:00Z',
        input: JSON.stringify({
          query: 'Git rebase vs merge best practices?',
          context: 'Team workflow discussion',
          attachments: [],
        }),
        working_directory: '/home/user/projects/monorepo',
        output_status: 'error',
        model_id: 'gpt-4',
      },
    ];

    const insert = db.prepare(`
      INSERT INTO ai_queries
      (exchange_id, conversation_id, start_ts, input, working_directory, output_status, model_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const q of queries) {
      insert.run(
        q.exchange_id,
        q.conversation_id,
        q.start_ts,
        q.input,
        q.working_directory,
        q.output_status,
        q.model_id
      );
    }
  }

  // Insert mock agent conversations if requested
  if (options.agents !== false) {
    const agents = options.agents || [
      {
        conversation_id: 'agent-001',
        conversation_data: JSON.stringify({
          messages: [
            { role: 'user', content: 'Help me debug this Python script' },
            { role: 'assistant', content: 'Let me analyze the error...' },
            { role: 'user', content: 'It crashes on line 42' },
            { role: 'assistant', content: 'I see the issue - null pointer' },
          ],
          metadata: { model: 'gpt-4', duration: 120 },
        }),
        last_modified_at: '2024-01-15T11:00:00Z',
      },
      {
        conversation_id: 'agent-002',
        conversation_data: JSON.stringify({
          messages: [
            { role: 'user', content: 'Write a Kubernetes deployment manifest' },
            { role: 'assistant', content: 'Here is the manifest...' },
          ],
          metadata: { model: 'claude-3-sonnet', duration: 60 },
        }),
        last_modified_at: '2024-01-16T15:30:00Z',
      },
    ];

    const insertAgent = db.prepare(`
      INSERT INTO ai_agent_conversations
      (conversation_id, conversation_data, last_modified_at)
      VALUES (?, ?, ?)
    `);

    for (const a of agents) {
      insertAgent.run(a.conversation_id, a.conversation_data, a.last_modified_at);
    }
  }

  db.close();
  return dbPath;
}

// =============================================================================
// IMPORT MODULES
// =============================================================================

let WarpSQLiteAdapter;

try {
  const warpAdapter = require('../adapters/warp-sqlite-adapter.cjs');
  WarpSQLiteAdapter = warpAdapter.WarpSQLiteAdapter;
} catch (error) {
  console.error('Failed to import WarpSQLiteAdapter:', error.message);
  console.error('Run tests after implementing warp-sqlite-adapter.cjs');
  process.exit(1);
}

// =============================================================================
// CONSTRUCTOR TESTS
// =============================================================================

function testConstructor() {
  console.log('\n\ud83c\udfd7\ufe0f  Testing: Constructor and Configuration');
  let passed = 0;
  let total = 0;

  total++;
  passed += test('constructor sets correct name', () => {
    const adapter = new WarpSQLiteAdapter();
    assert(adapter.name === 'warp-sqlite', `Expected 'warp-sqlite', got '${adapter.name}'`);
  });

  total++;
  passed += test('constructor sets correct priority (0.75)', () => {
    const adapter = new WarpSQLiteAdapter();
    assert(adapter.priority === 0.75, `Expected 0.75, got ${adapter.priority}`);
  });

  total++;
  passed += test('constructor sets correct timeout (500ms)', () => {
    const adapter = new WarpSQLiteAdapter();
    assert(adapter.timeout === 500, `Expected 500, got ${adapter.timeout}`);
  });

  total++;
  passed += test('constructor accepts custom database paths', () => {
    const customPaths = ['/custom/path/warp.sqlite'];
    const adapter = new WarpSQLiteAdapter({ databasePaths: customPaths });
    assert(
      JSON.stringify(adapter.databasePaths) === JSON.stringify(customPaths),
      'Should accept custom paths'
    );
  });

  total++;
  passed += test('constructor uses default paths when none provided', () => {
    const adapter = new WarpSQLiteAdapter();
    assert(Array.isArray(adapter.databasePaths), 'Should have array of paths');
    assert(adapter.databasePaths.length >= 2, 'Should have at least 2 default paths');
    assert(
      adapter.databasePaths.some(p => p.includes('warp-terminal')),
      'Should include warp-terminal path'
    );
  });

  total++;
  passed += test('supportsWrite() returns false', () => {
    const adapter = new WarpSQLiteAdapter();
    assert(adapter.supportsWrite() === false, 'Should not support writes');
  });

  return { passed, total };
}

// =============================================================================
// IS AVAILABLE TESTS
// =============================================================================

async function testIsAvailable() {
  console.log('\n\ud83d\udd0d Testing: isAvailable()');
  let passed = 0;
  let total = 0;

  total++;
  passed += await testAsync('returns false when no databases exist', async () => {
    const adapter = new WarpSQLiteAdapter({
      databasePaths: ['/nonexistent/path/warp.sqlite'],
    });
    const available = await adapter.isAvailable();
    assert(available === false, 'Should be unavailable with no databases');
  });

  total++;
  passed += await testAsync('returns true when at least one database exists', async () => {
    const dbPath = path.join(TEST_DIR, 'warp.sqlite');
    createMockWarpDatabase(dbPath);

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath],
    });
    const available = await adapter.isAvailable();
    assert(available === true, 'Should be available with existing database');
  });

  total++;
  passed += await testAsync('returns true when any database in list exists', async () => {
    const dbPath = path.join(TEST_DIR, 'warp2.sqlite');
    createMockWarpDatabase(dbPath);

    const adapter = new WarpSQLiteAdapter({
      databasePaths: ['/nonexistent/warp.sqlite', dbPath],
    });
    const available = await adapter.isAvailable();
    assert(available === true, 'Should be available if any path exists');
  });

  return { passed, total };
}

// =============================================================================
// GET TOTAL COUNTS TESTS
// =============================================================================

async function testGetTotalCounts() {
  console.log('\n\ud83d\udcca Testing: getTotalCounts()');
  let passed = 0;
  let total = 0;

  total++;
  passed += await testAsync('returns correct counts for single database', async () => {
    const dbPath = path.join(TEST_DIR, 'counts-single.sqlite');
    createMockWarpDatabase(dbPath);

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath],
    });
    const counts = await adapter.getTotalCounts();

    assert(typeof counts === 'object', 'Should return object');
    assert(counts.queries === 4, `Expected 4 queries, got ${counts.queries}`);
    assert(counts.agents === 2, `Expected 2 agents, got ${counts.agents}`);
    assert(counts.total === 6, `Expected 6 total, got ${counts.total}`);
  });

  total++;
  passed += await testAsync('returns counts from multiple databases', async () => {
    const dbPath1 = path.join(TEST_DIR, 'counts-multi1.sqlite');
    const dbPath2 = path.join(TEST_DIR, 'counts-multi2.sqlite');
    createMockWarpDatabase(dbPath1);
    createMockWarpDatabase(dbPath2);

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath1, dbPath2],
    });
    const counts = await adapter.getTotalCounts();

    assert(counts.queries === 8, `Expected 8 queries from 2 DBs, got ${counts.queries}`);
    assert(counts.agents === 4, `Expected 4 agents from 2 DBs, got ${counts.agents}`);
    assert(counts.total === 12, `Expected 12 total, got ${counts.total}`);
  });

  total++;
  passed += await testAsync('byDatabase contains per-database breakdown', async () => {
    const dbPath = path.join(TEST_DIR, 'counts-breakdown.sqlite');
    createMockWarpDatabase(dbPath);

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath],
    });
    const counts = await adapter.getTotalCounts();

    assert(typeof counts.byDatabase === 'object', 'Should have byDatabase');
    assert(Object.keys(counts.byDatabase).length === 1, 'Should have 1 database entry');

    const dbCounts = counts.byDatabase[dbPath];
    assert(dbCounts.queries === 4, 'Per-DB query count should be 4');
    assert(dbCounts.agents === 2, 'Per-DB agent count should be 2');
  });

  total++;
  passed += await testAsync('returns zeros for empty database', async () => {
    const dbPath = path.join(TEST_DIR, 'counts-empty.sqlite');
    createMockWarpDatabase(dbPath, { queries: [], agents: [] });

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath],
    });
    const counts = await adapter.getTotalCounts();

    assert(counts.queries === 0, 'Should have 0 queries');
    assert(counts.agents === 0, 'Should have 0 agents');
    assert(counts.total === 0, 'Should have 0 total');
  });

  return { passed, total };
}

// =============================================================================
// NORMALIZE TESTS
// =============================================================================

function testNormalize() {
  console.log('\n\ud83d\udd04 Testing: normalize()');
  let passed = 0;
  let total = 0;

  const adapter = new WarpSQLiteAdapter();

  total++;
  passed += test('normalizes ai_query row to MemoryRecord', () => {
    const raw = {
      _type: 'query',
      id: 1,
      exchange_id: 'ex-001',
      conversation_id: 'conv-001',
      start_ts: '2024-01-15T10:30:00Z',
      input: JSON.stringify({
        query: 'How do I fix this TypeScript error?',
        context: 'React project',
      }),
      working_directory: '/home/user/project',
      output_status: 'success',
      model_id: 'gpt-4',
      _database: '/path/to/warp.sqlite',
    };

    const record = adapter.normalize(raw);

    assert(record.id, 'Should have id');
    assert(record.type, 'Should have type');
    assert(record.content.includes('TypeScript'), 'Content should include query');
    assert(record.summary.length <= 100, 'Summary should be <= 100 chars');
    assert(record.sourceTimestamp === '2024-01-15T10:30:00Z', 'Should preserve timestamp');
    assert(record._source === 'warp-sqlite', 'Should set _source');
    assert(record._sourcePriority === 0.75, 'Should set _sourcePriority');
  });

  total++;
  passed += test('normalizes agent_conversation row to MemoryRecord', () => {
    const raw = {
      _type: 'agent',
      id: 1,
      conversation_id: 'agent-001',
      conversation_data: JSON.stringify({
        messages: [
          { role: 'user', content: 'Help me debug' },
          { role: 'assistant', content: 'Sure, let me look' },
        ],
      }),
      last_modified_at: '2024-01-15T11:00:00Z',
      _database: '/path/to/warp.sqlite',
    };

    const record = adapter.normalize(raw);

    assert(record.id, 'Should have id');
    assert(record.content.includes('debug'), 'Content should include conversation');
    assert(record.sourceTimestamp === '2024-01-15T11:00:00Z', 'Should use last_modified_at');
  });

  total++;
  passed += test('extracts tags from content', () => {
    const raw = {
      _type: 'query',
      id: 1,
      exchange_id: 'ex-001',
      start_ts: '2024-01-15T10:30:00Z',
      input: JSON.stringify({
        query: 'TypeScript error with Docker and git hooks',
      }),
      output_status: 'success',
      _database: '/path/to/warp.sqlite',
    };

    const record = adapter.normalize(raw);

    assert(Array.isArray(record.tags), 'Should have tags array');
    assert(record.tags.includes('typescript'), 'Should extract typescript tag');
    assert(record.tags.includes('docker'), 'Should extract docker tag');
    assert(record.tags.includes('git'), 'Should extract git tag');
  });

  total++;
  passed += test('infers memory type from content', () => {
    const debugRaw = {
      _type: 'query',
      id: 1,
      exchange_id: 'ex-001',
      start_ts: '2024-01-15T10:30:00Z',
      input: JSON.stringify({ query: 'How to fix this error?' }),
      output_status: 'success',
      _database: '/path/to/warp.sqlite',
    };

    const record = adapter.normalize(debugRaw);
    // Error-related queries typically become 'learning' or 'correction'
    assert(['learning', 'correction', 'skill'].includes(record.type),
      `Type should be learning/correction/skill, got ${record.type}`);
  });

  total++;
  passed += test('handles malformed JSON gracefully', () => {
    const raw = {
      _type: 'query',
      id: 1,
      exchange_id: 'ex-001',
      start_ts: '2024-01-15T10:30:00Z',
      input: 'not valid json',
      output_status: 'success',
      _database: '/path/to/warp.sqlite',
    };

    const record = adapter.normalize(raw);

    assert(record !== null, 'Should not return null');
    assert(record.content === 'not valid json', 'Should use raw input as content');
  });

  total++;
  passed += test('calculates decay score from timestamp', () => {
    const recentRaw = {
      _type: 'query',
      id: 1,
      exchange_id: 'ex-001',
      start_ts: new Date().toISOString(),
      input: JSON.stringify({ query: 'Recent query' }),
      output_status: 'success',
      _database: '/path/to/warp.sqlite',
    };

    const oldRaw = {
      _type: 'query',
      id: 2,
      exchange_id: 'ex-002',
      start_ts: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days ago
      input: JSON.stringify({ query: 'Old query' }),
      output_status: 'success',
      _database: '/path/to/warp.sqlite',
    };

    const recent = adapter.normalize(recentRaw);
    const old = adapter.normalize(oldRaw);

    assert(recent.decayScore > old.decayScore, 'Recent should have higher decay score');
    assert(recent.decayScore > 0.8, 'Recent decay should be > 0.8');
  });

  total++;
  passed += test('returns null for null input', () => {
    const record = adapter.normalize(null);
    assert(record === null, 'Should return null for null input');
  });

  total++;
  passed += test('handles Warp array format with Query event', () => {
    const raw = {
      _type: 'query',
      id: 1,
      exchange_id: 'ex-001',
      start_ts: '2024-01-15T10:30:00Z',
      input: JSON.stringify([
        {
          Query: {
            text: 'How do I fix this TypeScript error?',
            context: [{ Directory: { pwd: '/home/user/project' } }],
          },
        },
      ]),
      output_status: 'success',
      _database: '/path/to/warp.sqlite',
    };

    const record = adapter.normalize(raw);
    assert(record.content.includes('How do I fix this TypeScript error?'),
      'Should extract Query.text from array format');
    assert(record.tags.includes('typescript'), 'Should extract typescript tag');
  });

  total++;
  passed += test('handles Warp array format with ActionResult command output', () => {
    const raw = {
      _type: 'query',
      id: 1,
      exchange_id: 'ex-001',
      start_ts: '2024-01-15T10:30:00Z',
      input: JSON.stringify([
        {
          ActionResult: {
            id: 'action-001',
            result: {
              RequestCommandOutput: {
                result: {
                  Success: {
                    command: 'git status',
                    output: 'On branch main',
                    exit_code: 0,
                  },
                },
              },
            },
          },
        },
      ]),
      output_status: 'success',
      _database: '/path/to/warp.sqlite',
    };

    const record = adapter.normalize(raw);
    assert(record.content.includes('git status'), 'Should extract command from ActionResult');
    assert(record.content.includes('On branch main'), 'Should extract output from ActionResult');
    assert(record.tags.includes('git'), 'Should extract git tag');
  });

  return { passed, total };
}

// =============================================================================
// QUERY TESTS
// =============================================================================

async function testQuery() {
  console.log('\n\ud83d\udd0e Testing: query()');
  let passed = 0;
  let total = 0;

  total++;
  passed += await testAsync('returns all records without filters', async () => {
    const dbPath = path.join(TEST_DIR, 'query-all.sqlite');
    createMockWarpDatabase(dbPath);

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath],
    });

    const context = { tags: [] };
    const results = await adapter.query(context);

    assert(Array.isArray(results), 'Should return array');
    assert(results.length === 6, `Expected 6 records (4 queries + 2 agents), got ${results.length}`);
  });

  total++;
  passed += await testAsync('respects limit option', async () => {
    const dbPath = path.join(TEST_DIR, 'query-limit.sqlite');
    createMockWarpDatabase(dbPath);

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath],
    });

    const context = { tags: [] };
    const results = await adapter.query(context, { limit: 3 });

    assert(results.length === 3, `Expected 3 records with limit, got ${results.length}`);
  });

  total++;
  passed += await testAsync('filters by working_directory when projectHash provided', async () => {
    const dbPath = path.join(TEST_DIR, 'query-project.sqlite');
    createMockWarpDatabase(dbPath);

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath],
    });

    // Filter by react-app project
    const context = { projectHash: null };
    const results = await adapter.query(context, {
      projectHash: '/home/user/projects/react-app',
    });

    // Should get queries from react-app (2) plus global records
    // Agent conversations don't have working_directory so they're global
    assert(results.length >= 2, `Expected at least 2 records for react-app, got ${results.length}`);

    // Verify all query records are from correct directory
    const queryRecords = results.filter(r => r.id.includes('query'));
    for (const r of queryRecords) {
      assert(
        r.projectHash === null || r.projectHash === '/home/user/projects/react-app',
        `Record should be global or from react-app: ${r.projectHash}`
      );
    }
  });

  total++;
  passed += await testAsync('filters by memory types', async () => {
    const dbPath = path.join(TEST_DIR, 'query-types.sqlite');
    createMockWarpDatabase(dbPath);

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath],
    });

    const context = { tags: [] };
    const results = await adapter.query(context, { types: ['learning'] });

    assert(results.every(r => r.type === 'learning'), 'All should be learning type');
  });

  total++;
  passed += await testAsync('filters by minConfidence', async () => {
    const dbPath = path.join(TEST_DIR, 'query-confidence.sqlite');
    createMockWarpDatabase(dbPath);

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath],
    });

    const context = { tags: [] };
    const results = await adapter.query(context, { minConfidence: 0.6 });

    assert(
      results.every(r => r.extractionConfidence >= 0.6),
      'All should meet confidence threshold'
    );
  });

  total++;
  passed += await testAsync('aggregates results from multiple databases', async () => {
    const dbPath1 = path.join(TEST_DIR, 'query-multi1.sqlite');
    const dbPath2 = path.join(TEST_DIR, 'query-multi2.sqlite');

    createMockWarpDatabase(dbPath1, {
      queries: [
        {
          exchange_id: 'db1-ex-001',
          conversation_id: 'conv-001',
          start_ts: '2024-01-15T10:30:00Z',
          input: JSON.stringify({ query: 'Database 1 query' }),
          working_directory: '/home/user/project1',
          output_status: 'success',
          model_id: 'gpt-4',
        },
      ],
      agents: [],
    });

    createMockWarpDatabase(dbPath2, {
      queries: [
        {
          exchange_id: 'db2-ex-001',
          conversation_id: 'conv-001',
          start_ts: '2024-01-15T11:30:00Z',
          input: JSON.stringify({ query: 'Database 2 query' }),
          working_directory: '/home/user/project2',
          output_status: 'success',
          model_id: 'claude-3',
        },
      ],
      agents: [],
    });

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath1, dbPath2],
    });

    const context = { tags: [] };
    const results = await adapter.query(context);

    assert(results.length === 2, `Expected 2 records from 2 DBs, got ${results.length}`);
    assert(
      results.some(r => r.content.includes('Database 1')),
      'Should include DB1 query'
    );
    assert(
      results.some(r => r.content.includes('Database 2')),
      'Should include DB2 query'
    );
  });

  total++;
  passed += await testAsync('returns empty array for non-existent database', async () => {
    const adapter = new WarpSQLiteAdapter({
      databasePaths: ['/nonexistent/warp.sqlite'],
    });

    const context = { tags: [] };
    const results = await adapter.query(context);

    assert(Array.isArray(results), 'Should return array');
    assert(results.length === 0, 'Should be empty');
  });

  total++;
  passed += await testAsync('all results have required MemoryRecord fields', async () => {
    const dbPath = path.join(TEST_DIR, 'query-fields.sqlite');
    createMockWarpDatabase(dbPath);

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath],
    });

    const context = { tags: [] };
    const results = await adapter.query(context);

    const requiredFields = [
      'id', 'version', 'type', 'content', 'summary', 'tags',
      'intent', 'sourceSessionId', 'sourceTimestamp', 'extractionConfidence',
      'usageCount', 'usageSuccessRate', 'decayScore', 'status',
      'createdAt', 'updatedAt', '_source', '_sourcePriority',
    ];

    for (const record of results) {
      for (const field of requiredFields) {
        assert(
          field in record,
          `Record missing required field '${field}'`
        );
      }
    }
  });

  return { passed, total };
}

// =============================================================================
// EDGE CASES TESTS
// =============================================================================

async function testEdgeCases() {
  console.log('\n\u26a0\ufe0f  Testing: Edge Cases');
  let passed = 0;
  let total = 0;

  total++;
  passed += await testAsync('handles database with only queries', async () => {
    const dbPath = path.join(TEST_DIR, 'edge-queries-only.sqlite');
    createMockWarpDatabase(dbPath, { agents: [] });

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath],
    });

    const counts = await adapter.getTotalCounts();
    assert(counts.queries === 4, 'Should have 4 queries');
    assert(counts.agents === 0, 'Should have 0 agents');
  });

  total++;
  passed += await testAsync('handles database with only agents', async () => {
    const dbPath = path.join(TEST_DIR, 'edge-agents-only.sqlite');
    createMockWarpDatabase(dbPath, { queries: [] });

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath],
    });

    const counts = await adapter.getTotalCounts();
    assert(counts.queries === 0, 'Should have 0 queries');
    assert(counts.agents === 2, 'Should have 2 agents');
  });

  total++;
  passed += await testAsync('handles empty input JSON', async () => {
    const dbPath = path.join(TEST_DIR, 'edge-empty-input.sqlite');
    createMockWarpDatabase(dbPath, {
      queries: [
        {
          exchange_id: 'ex-empty',
          conversation_id: 'conv-001',
          start_ts: '2024-01-15T10:30:00Z',
          input: JSON.stringify({}),
          working_directory: '/home/user/project',
          output_status: 'success',
          model_id: 'gpt-4',
        },
      ],
      agents: [],
    });

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath],
    });

    const context = { tags: [] };
    const results = await adapter.query(context);

    assert(results.length === 1, 'Should handle empty input');
  });

  total++;
  passed += await testAsync('handles special characters in query content', async () => {
    const dbPath = path.join(TEST_DIR, 'edge-special.sqlite');
    const specialContent = "How to handle 'quotes', \"double quotes\", and emoji \ud83d\ude80?";

    createMockWarpDatabase(dbPath, {
      queries: [
        {
          exchange_id: 'ex-special',
          conversation_id: 'conv-001',
          start_ts: '2024-01-15T10:30:00Z',
          input: JSON.stringify({ query: specialContent }),
          working_directory: '/home/user/project',
          output_status: 'success',
          model_id: 'gpt-4',
        },
      ],
      agents: [],
    });

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath],
    });

    const context = { tags: [] };
    const results = await adapter.query(context);

    assert(results[0].content.includes('quotes'), 'Should preserve special chars');
    assert(results[0].content.includes('\ud83d\ude80'), 'Should preserve emoji');
  });

  total++;
  passed += await testAsync('handles very long query content', async () => {
    const dbPath = path.join(TEST_DIR, 'edge-long.sqlite');
    const longContent = 'x'.repeat(10000);

    createMockWarpDatabase(dbPath, {
      queries: [
        {
          exchange_id: 'ex-long',
          conversation_id: 'conv-001',
          start_ts: '2024-01-15T10:30:00Z',
          input: JSON.stringify({ query: longContent }),
          working_directory: '/home/user/project',
          output_status: 'success',
          model_id: 'gpt-4',
        },
      ],
      agents: [],
    });

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath],
    });

    const context = { tags: [] };
    const results = await adapter.query(context);

    assert(results[0].content.length === 10000, 'Should preserve long content');
    assert(results[0].summary.length <= 100, 'Summary should be truncated');
  });

  total++;
  passed += await testAsync('write() returns error', async () => {
    const adapter = new WarpSQLiteAdapter();
    const result = await adapter.write({ id: 'test' });
    assert(result.success === false, 'Write should fail');
    assert(result.error, 'Should have error message');
  });

  total++;
  passed += await testAsync('update() returns error', async () => {
    const adapter = new WarpSQLiteAdapter();
    const result = await adapter.update('test', {});
    assert(result.success === false, 'Update should fail');
    assert(result.error, 'Should have error message');
  });

  total++;
  passed += await testAsync('delete() returns error', async () => {
    const adapter = new WarpSQLiteAdapter();
    const result = await adapter.delete('test');
    assert(result.success === false, 'Delete should fail');
    assert(result.error, 'Should have error message');
  });

  return { passed, total };
}

// =============================================================================
// STATS TESTS
// =============================================================================

async function testStats() {
  console.log('\n\ud83d\udcca Testing: getStats()');
  let passed = 0;
  let total = 0;

  total++;
  passed += await testAsync('returns correct stats structure', async () => {
    const dbPath = path.join(TEST_DIR, 'stats-test.sqlite');
    createMockWarpDatabase(dbPath);

    const adapter = new WarpSQLiteAdapter({
      databasePaths: [dbPath],
    });

    // Run a query to populate stats
    await adapter.query({ tags: [] });

    const stats = await adapter.getStats();

    assert(typeof stats === 'object', 'Should return object');
    assert(stats.name === 'warp-sqlite', 'Should have correct name');
    assert(stats.supportsWrite === false, 'Should report no write support');
    assert(typeof stats.available === 'boolean', 'Should have available');
    assert(typeof stats.totalRecords === 'number', 'Should have totalRecords');
  });

  return { passed, total };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('\u2551   WarpSQLiteAdapter Tests              \u2551');
  console.log('\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d');

  setup();

  let totalPassed = 0;
  let totalTests = 0;

  try {
    // Run all test groups
    const groups = [
      testConstructor,
      testIsAvailable,
      testGetTotalCounts,
      testNormalize,
      testQuery,
      testEdgeCases,
      testStats,
    ];

    for (const group of groups) {
      const result = await group();
      totalPassed += result.passed;
      totalTests += result.total;
    }
  } finally {
    cleanup();
  }

  console.log('\n' + '\u2550'.repeat(42));
  console.log(`Results: ${totalPassed}/${totalTests} tests passed`);

  if (totalPassed === totalTests) {
    console.log('\u2705 All tests passed!');
    process.exit(0);
  } else {
    console.log(`\u274c ${totalTests - totalPassed} test(s) failed`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Test runner failed:', error);
  cleanup();
  process.exit(1);
});
