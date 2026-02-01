# Cortex Adapter Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand Cortex memory system with SQLite support, Warp Terminal integration, Gemini task history, and episodic memory annotations.

**Architecture:** Create a SQLiteStore base class (analogous to JSONLStore), then build WarpSQLiteAdapter and GeminiAdapter on top. Add an EpisodicAnnotationsLayer to enable write operations on read-only archives without corrupting originals.

**Tech Stack:** Node.js (CommonJS), better-sqlite3, existing BaseAdapter pattern, TDD with existing test harness

---

## Task 1: Create SQLiteStore Base Class

**Files:**
- Create: `~/.claude/memory/core/sqlite-store.cjs`
- Test: `~/.claude/memory/tests/test-sqlite-store.cjs`

**Purpose:** Provide reusable SQLite operations analogous to JSONLStore, with connection pooling, prepared statements, and atomic transactions.

---

### Step 1.1: Write the failing test for SQLiteStore constructor

```javascript
// tests/test-sqlite-store.cjs
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    testsPassed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    testsFailed++;
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    testsPassed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    testsFailed++;
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(`${message}: expected truthy value`);
  }
}

function assertFalse(value, message) {
  if (value) {
    throw new Error(`${message}: expected falsy value`);
  }
}

// Create temp directory for tests
const tempDir = path.join(os.tmpdir(), `sqlite-store-test-${Date.now()}`);
fs.mkdirSync(tempDir, { recursive: true });

// Import module under test
const { SQLiteStore } = require('../core/sqlite-store.cjs');

// =============================================================================
// CONSTRUCTOR TESTS
// =============================================================================

test('SQLiteStore constructor creates database file', () => {
  const dbPath = path.join(tempDir, 'test-constructor.db');
  const store = new SQLiteStore(dbPath);

  assertTrue(fs.existsSync(dbPath), 'Database file should exist');
  store.close();
});

test('SQLiteStore constructor accepts options', () => {
  const dbPath = path.join(tempDir, 'test-options.db');
  const store = new SQLiteStore(dbPath, { readonly: false, timeout: 5000 });

  assertTrue(store.isOpen(), 'Store should be open');
  store.close();
});

test('SQLiteStore constructor with readonly on non-existent throws', () => {
  const dbPath = path.join(tempDir, 'non-existent.db');
  let threw = false;

  try {
    new SQLiteStore(dbPath, { readonly: true });
  } catch (e) {
    threw = true;
  }

  assertTrue(threw, 'Should throw for readonly on non-existent file');
});

// Cleanup
process.on('exit', () => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
  process.exitCode = testsFailed > 0 ? 1 : 0;
});
```

**Run:** `node ~/.claude/memory/tests/test-sqlite-store.cjs`
**Expected:** FAIL with "Cannot find module '../core/sqlite-store.cjs'"

---

### Step 1.2: Write minimal SQLiteStore to pass constructor tests

```javascript
// core/sqlite-store.cjs
/**
 * Cortex - Claude's Cognitive Layer - SQLite Store
 *
 * Base class for SQLite-based storage, analogous to JSONLStore.
 * Provides connection management, prepared statements, and transactions.
 *
 * @version 1.0.0
 * @see Design: ../docs/design/memory-orchestrator.md
 */

'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

/**
 * SQLite storage with connection pooling and atomic transactions
 */
class SQLiteStore {
  /**
   * @param {string} dbPath - Path to SQLite database file
   * @param {Object} [options]
   * @param {boolean} [options.readonly=false] - Open in read-only mode
   * @param {number} [options.timeout=5000] - Busy timeout in ms
   * @param {boolean} [options.wal=true] - Enable WAL mode for better concurrency
   */
  constructor(dbPath, options = {}) {
    this.dbPath = path.resolve(dbPath);
    this.options = {
      readonly: options.readonly || false,
      timeout: options.timeout || 5000,
      wal: options.wal !== false,
    };

    // Ensure directory exists for new databases
    if (!this.options.readonly) {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Open database
    this.db = new Database(this.dbPath, {
      readonly: this.options.readonly,
      timeout: this.options.timeout,
    });

    // Enable WAL mode for better concurrent access
    if (this.options.wal && !this.options.readonly) {
      this.db.pragma('journal_mode = WAL');
    }

    // Prepared statement cache
    this._statements = new Map();
  }

  /**
   * Check if database connection is open
   * @returns {boolean}
   */
  isOpen() {
    return this.db && this.db.open;
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      // Clear prepared statements
      this._statements.clear();
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = { SQLiteStore };
```

**Run:** `node ~/.claude/memory/tests/test-sqlite-store.cjs`
**Expected:** PASS (3 tests)

---

### Step 1.3: Write failing tests for query operations

Add to `test-sqlite-store.cjs`:

```javascript
// =============================================================================
// QUERY TESTS
// =============================================================================

test('SQLiteStore.exec runs SQL statements', () => {
  const dbPath = path.join(tempDir, 'test-exec.db');
  const store = new SQLiteStore(dbPath);

  store.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);

  // Verify table exists
  const tables = store.query("SELECT name FROM sqlite_master WHERE type='table' AND name='test'");
  assertEqual(tables.length, 1, 'Table should exist');

  store.close();
});

test('SQLiteStore.query returns rows', () => {
  const dbPath = path.join(tempDir, 'test-query.db');
  const store = new SQLiteStore(dbPath);

  store.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)`);
  store.exec(`INSERT INTO items (value) VALUES ('one'), ('two'), ('three')`);

  const rows = store.query('SELECT * FROM items ORDER BY id');
  assertEqual(rows.length, 3, 'Should return 3 rows');
  assertEqual(rows[0].value, 'one', 'First row value');
  assertEqual(rows[2].value, 'three', 'Third row value');

  store.close();
});

test('SQLiteStore.query with parameters', () => {
  const dbPath = path.join(tempDir, 'test-query-params.db');
  const store = new SQLiteStore(dbPath);

  store.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)`);
  store.exec(`INSERT INTO items (value) VALUES ('alpha'), ('beta'), ('gamma')`);

  const rows = store.query('SELECT * FROM items WHERE value = ?', ['beta']);
  assertEqual(rows.length, 1, 'Should return 1 row');
  assertEqual(rows[0].value, 'beta', 'Row value should match');

  store.close();
});

test('SQLiteStore.queryOne returns single row or null', () => {
  const dbPath = path.join(tempDir, 'test-query-one.db');
  const store = new SQLiteStore(dbPath);

  store.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)`);
  store.exec(`INSERT INTO items (value) VALUES ('only')`);

  const row = store.queryOne('SELECT * FROM items WHERE id = ?', [1]);
  assertEqual(row.value, 'only', 'Should return the row');

  const missing = store.queryOne('SELECT * FROM items WHERE id = ?', [999]);
  assertEqual(missing, null, 'Should return null for missing');

  store.close();
});
```

**Run:** `node ~/.claude/memory/tests/test-sqlite-store.cjs`
**Expected:** FAIL with "store.exec is not a function"

---

### Step 1.4: Implement query methods

Add to `SQLiteStore` class in `sqlite-store.cjs`:

```javascript
  /**
   * Execute SQL statement(s) without returning results
   * @param {string} sql - SQL statement(s) to execute
   */
  exec(sql) {
    this.db.exec(sql);
  }

  /**
   * Query and return all matching rows
   * @param {string} sql - SQL query
   * @param {Array} [params=[]] - Query parameters
   * @returns {Array<Object>} Array of row objects
   */
  query(sql, params = []) {
    const stmt = this._getStatement(sql);
    return stmt.all(...params);
  }

  /**
   * Query and return first matching row or null
   * @param {string} sql - SQL query
   * @param {Array} [params=[]] - Query parameters
   * @returns {Object|null} Row object or null
   */
  queryOne(sql, params = []) {
    const stmt = this._getStatement(sql);
    return stmt.get(...params) || null;
  }

  /**
   * Get or create a prepared statement (cached)
   * @private
   * @param {string} sql
   * @returns {Database.Statement}
   */
  _getStatement(sql) {
    if (!this._statements.has(sql)) {
      this._statements.set(sql, this.db.prepare(sql));
    }
    return this._statements.get(sql);
  }
```

**Run:** `node ~/.claude/memory/tests/test-sqlite-store.cjs`
**Expected:** PASS (7 tests)

---

### Step 1.5: Write failing tests for write operations

Add to `test-sqlite-store.cjs`:

```javascript
// =============================================================================
// WRITE TESTS
// =============================================================================

test('SQLiteStore.run executes INSERT and returns info', () => {
  const dbPath = path.join(tempDir, 'test-run.db');
  const store = new SQLiteStore(dbPath);

  store.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)`);

  const info = store.run('INSERT INTO items (value) VALUES (?)', ['test']);
  assertEqual(info.changes, 1, 'Should report 1 change');
  assertTrue(info.lastInsertRowid > 0, 'Should have lastInsertRowid');

  store.close();
});

test('SQLiteStore.run executes UPDATE', () => {
  const dbPath = path.join(tempDir, 'test-update.db');
  const store = new SQLiteStore(dbPath);

  store.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)`);
  store.run('INSERT INTO items (value) VALUES (?)', ['original']);

  const info = store.run('UPDATE items SET value = ? WHERE id = ?', ['modified', 1]);
  assertEqual(info.changes, 1, 'Should report 1 change');

  const row = store.queryOne('SELECT value FROM items WHERE id = 1');
  assertEqual(row.value, 'modified', 'Value should be updated');

  store.close();
});

test('SQLiteStore.run executes DELETE', () => {
  const dbPath = path.join(tempDir, 'test-delete.db');
  const store = new SQLiteStore(dbPath);

  store.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)`);
  store.run('INSERT INTO items (value) VALUES (?), (?)', ['one', 'two']);

  const info = store.run('DELETE FROM items WHERE value = ?', ['one']);
  assertEqual(info.changes, 1, 'Should report 1 deletion');

  const remaining = store.query('SELECT * FROM items');
  assertEqual(remaining.length, 1, 'Should have 1 row remaining');

  store.close();
});
```

**Run:** `node ~/.claude/memory/tests/test-sqlite-store.cjs`
**Expected:** FAIL with "store.run is not a function"

---

### Step 1.6: Implement write methods

Add to `SQLiteStore` class:

```javascript
  /**
   * Execute INSERT/UPDATE/DELETE and return result info
   * @param {string} sql - SQL statement
   * @param {Array} [params=[]] - Statement parameters
   * @returns {{changes: number, lastInsertRowid: number}}
   */
  run(sql, params = []) {
    const stmt = this._getStatement(sql);
    return stmt.run(...params);
  }
```

**Run:** `node ~/.claude/memory/tests/test-sqlite-store.cjs`
**Expected:** PASS (10 tests)

---

### Step 1.7: Write failing tests for transactions

Add to `test-sqlite-store.cjs`:

```javascript
// =============================================================================
// TRANSACTION TESTS
// =============================================================================

test('SQLiteStore.transaction commits on success', () => {
  const dbPath = path.join(tempDir, 'test-tx-commit.db');
  const store = new SQLiteStore(dbPath);

  store.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)`);

  store.transaction(() => {
    store.run('INSERT INTO items (value) VALUES (?)', ['one']);
    store.run('INSERT INTO items (value) VALUES (?)', ['two']);
  });

  const rows = store.query('SELECT * FROM items');
  assertEqual(rows.length, 2, 'Both inserts should be committed');

  store.close();
});

test('SQLiteStore.transaction rolls back on error', () => {
  const dbPath = path.join(tempDir, 'test-tx-rollback.db');
  const store = new SQLiteStore(dbPath);

  store.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)`);

  let threw = false;
  try {
    store.transaction(() => {
      store.run('INSERT INTO items (value) VALUES (?)', ['valid']);
      store.run('INSERT INTO items (value) VALUES (?)', [null]); // NOT NULL violation
    });
  } catch (e) {
    threw = true;
  }

  assertTrue(threw, 'Should throw on constraint violation');

  const rows = store.query('SELECT * FROM items');
  assertEqual(rows.length, 0, 'Transaction should have rolled back');

  store.close();
});

test('SQLiteStore.transaction returns value', () => {
  const dbPath = path.join(tempDir, 'test-tx-return.db');
  const store = new SQLiteStore(dbPath);

  store.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)`);

  const result = store.transaction(() => {
    store.run('INSERT INTO items (value) VALUES (?)', ['test']);
    return store.queryOne('SELECT * FROM items WHERE id = 1');
  });

  assertEqual(result.value, 'test', 'Should return transaction result');

  store.close();
});
```

**Run:** `node ~/.claude/memory/tests/test-sqlite-store.cjs`
**Expected:** FAIL with "store.transaction is not a function"

---

### Step 1.8: Implement transaction method

Add to `SQLiteStore` class:

```javascript
  /**
   * Execute function within a transaction
   * Automatically commits on success, rolls back on error
   * @template T
   * @param {() => T} fn - Function to execute
   * @returns {T} Result of fn
   */
  transaction(fn) {
    // Create transaction wrapper if not exists
    if (!this._transaction) {
      this._transaction = this.db.transaction((callback) => callback());
    }
    return this._transaction(fn);
  }
```

**Run:** `node ~/.claude/memory/tests/test-sqlite-store.cjs`
**Expected:** PASS (13 tests)

---

### Step 1.9: Write failing tests for table introspection

Add to `test-sqlite-store.cjs`:

```javascript
// =============================================================================
// INTROSPECTION TESTS
// =============================================================================

test('SQLiteStore.tableExists returns true for existing table', () => {
  const dbPath = path.join(tempDir, 'test-table-exists.db');
  const store = new SQLiteStore(dbPath);

  store.exec(`CREATE TABLE my_table (id INTEGER PRIMARY KEY)`);

  assertTrue(store.tableExists('my_table'), 'Should find existing table');
  assertFalse(store.tableExists('no_such_table'), 'Should not find missing table');

  store.close();
});

test('SQLiteStore.getTableInfo returns column information', () => {
  const dbPath = path.join(tempDir, 'test-table-info.db');
  const store = new SQLiteStore(dbPath);

  store.exec(`
    CREATE TABLE items (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      count INTEGER DEFAULT 0
    )
  `);

  const info = store.getTableInfo('items');
  assertEqual(info.length, 3, 'Should have 3 columns');
  assertEqual(info[0].name, 'id', 'First column is id');
  assertEqual(info[1].name, 'name', 'Second column is name');
  assertEqual(info[1].notnull, 1, 'name should be NOT NULL');

  store.close();
});

test('SQLiteStore.getRowCount returns count', () => {
  const dbPath = path.join(tempDir, 'test-row-count.db');
  const store = new SQLiteStore(dbPath);

  store.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)`);
  store.exec(`INSERT INTO items (value) VALUES ('a'), ('b'), ('c')`);

  assertEqual(store.getRowCount('items'), 3, 'Should count 3 rows');
  assertEqual(store.getRowCount('items', 'value = ?', ['b']), 1, 'Should count 1 filtered row');

  store.close();
});
```

**Run:** `node ~/.claude/memory/tests/test-sqlite-store.cjs`
**Expected:** FAIL with "store.tableExists is not a function"

---

### Step 1.10: Implement introspection methods

Add to `SQLiteStore` class:

```javascript
  /**
   * Check if a table exists
   * @param {string} tableName
   * @returns {boolean}
   */
  tableExists(tableName) {
    const row = this.queryOne(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      [tableName]
    );
    return row !== null;
  }

  /**
   * Get table column information
   * @param {string} tableName
   * @returns {Array<{cid: number, name: string, type: string, notnull: number, dflt_value: any, pk: number}>}
   */
  getTableInfo(tableName) {
    return this.query(`PRAGMA table_info(${tableName})`);
  }

  /**
   * Get row count for a table
   * @param {string} tableName
   * @param {string} [where] - Optional WHERE clause (without WHERE keyword)
   * @param {Array} [params=[]] - WHERE parameters
   * @returns {number}
   */
  getRowCount(tableName, where, params = []) {
    const sql = where
      ? `SELECT COUNT(*) as count FROM ${tableName} WHERE ${where}`
      : `SELECT COUNT(*) as count FROM ${tableName}`;
    const row = this.queryOne(sql, params);
    return row ? row.count : 0;
  }
```

**Run:** `node ~/.claude/memory/tests/test-sqlite-store.cjs`
**Expected:** PASS (16 tests)

---

### Step 1.11: Commit SQLiteStore

```bash
cd ~/.claude/memory
git add core/sqlite-store.cjs tests/test-sqlite-store.cjs
git commit -m "feat(core): add SQLiteStore base class for SQLite-backed adapters

- Connection management with better-sqlite3
- Prepared statement caching for performance
- Transaction support with auto-rollback
- Query methods: exec, query, queryOne, run
- Introspection: tableExists, getTableInfo, getRowCount
- WAL mode enabled by default for concurrency

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create WarpSQLiteAdapter

**Files:**
- Create: `~/.claude/memory/adapters/warp-sqlite-adapter.cjs`
- Test: `~/.claude/memory/tests/test-warp-adapter.cjs`

**Purpose:** Read Warp Terminal AI history (1,708 queries, 49 agent conversations) and normalize to MemoryRecord format.

**Data Sources:**
- `~/.local/state/warp-terminal/warp.sqlite` (primary)
- `~/.local/state/warp-terminal-preview/warp.sqlite` (preview builds)

**Schema:**
```sql
-- ai_queries table (570+ rows)
CREATE TABLE IF NOT EXISTS "ai_queries" (
  id INTEGER PRIMARY KEY NOT NULL,
  exchange_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  start_ts DATETIME NOT NULL,
  input TEXT NOT NULL,           -- JSON with query details
  working_directory TEXT,
  output_status TEXT NOT NULL,   -- 'success', 'error', etc.
  model_id TEXT NOT NULL DEFAULT '',
  planning_model_id TEXT NOT NULL DEFAULT '',
  coding_model_id TEXT NOT NULL DEFAULT ''
);

-- agent_conversations table (13+ rows)
CREATE TABLE agent_conversations (
  id INTEGER PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  conversation_data TEXT NOT NULL,  -- JSON with full conversation
  last_modified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

### Step 2.1: Write the failing test for WarpSQLiteAdapter constructor

```javascript
// tests/test-warp-adapter.cjs
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    testsPassed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    testsFailed++;
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    testsPassed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    testsFailed++;
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(`${message}: expected truthy value`);
  }
}

function assertFalse(value, message) {
  if (value) {
    throw new Error(`${message}: expected falsy value`);
  }
}

// Create temp directory with mock Warp database
const tempDir = path.join(os.tmpdir(), `warp-adapter-test-${Date.now()}`);
const mockDbPath = path.join(tempDir, 'warp.sqlite');
fs.mkdirSync(tempDir, { recursive: true });

// Set up mock database
const Database = require('better-sqlite3');
const mockDb = new Database(mockDbPath);

mockDb.exec(`
  CREATE TABLE IF NOT EXISTS ai_queries (
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
  );

  CREATE TABLE IF NOT EXISTS agent_conversations (
    id INTEGER PRIMARY KEY NOT NULL,
    conversation_id TEXT NOT NULL,
    conversation_data TEXT NOT NULL,
    last_modified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

// Insert test data
const insertQuery = mockDb.prepare(`
  INSERT INTO ai_queries (exchange_id, conversation_id, start_ts, input, working_directory, output_status, model_id)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

insertQuery.run(
  'ex-001', 'conv-001', '2026-01-15 10:30:00',
  JSON.stringify({ query: 'How do I fix this TypeScript error?', context: 'error TS2345' }),
  '/home/rob/project', 'success', 'gpt-4'
);

insertQuery.run(
  'ex-002', 'conv-001', '2026-01-15 10:35:00',
  JSON.stringify({ query: 'Can you explain git rebase?', context: '' }),
  '/home/rob/project', 'success', 'gpt-4'
);

insertQuery.run(
  'ex-003', 'conv-002', '2026-01-16 14:00:00',
  JSON.stringify({ query: 'Debug this Python script', context: 'ImportError' }),
  '/home/rob/scripts', 'error', 'gpt-4'
);

const insertAgent = mockDb.prepare(`
  INSERT INTO agent_conversations (conversation_id, conversation_data, last_modified_at)
  VALUES (?, ?, ?)
`);

insertAgent.run(
  'agent-001',
  JSON.stringify({
    title: 'Set up Docker environment',
    messages: [
      { role: 'user', content: 'Help me set up Docker for this project' },
      { role: 'assistant', content: 'I will help you configure Docker...' }
    ]
  }),
  '2026-01-16 15:00:00'
);

mockDb.close();

// Import module under test
const { WarpSQLiteAdapter } = require('../adapters/warp-sqlite-adapter.cjs');

// =============================================================================
// CONSTRUCTOR TESTS
// =============================================================================

test('WarpSQLiteAdapter constructor with explicit path', () => {
  const adapter = new WarpSQLiteAdapter({ dbPaths: [mockDbPath] });

  assertEqual(adapter.name, 'warp-sqlite', 'Should have correct name');
  assertEqual(adapter.priority, 0.75, 'Should have priority 0.75');
  assertTrue(adapter.enabled, 'Should be enabled by default');
});

test('WarpSQLiteAdapter does not support write', () => {
  const adapter = new WarpSQLiteAdapter({ dbPaths: [mockDbPath] });

  assertFalse(adapter.supportsWrite(), 'Warp data is read-only');
});

// Cleanup
process.on('exit', () => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
  process.exitCode = testsFailed > 0 ? 1 : 0;
});
```

**Run:** `node ~/.claude/memory/tests/test-warp-adapter.cjs`
**Expected:** FAIL with "Cannot find module '../adapters/warp-sqlite-adapter.cjs'"

---

### Step 2.2: Write minimal WarpSQLiteAdapter

```javascript
// adapters/warp-sqlite-adapter.cjs
/**
 * Cortex - Claude's Cognitive Layer - Warp SQLite Adapter
 *
 * Reads AI query history from Warp Terminal's SQLite database.
 * Provides access to 1,708+ AI queries and 49 agent conversations.
 *
 * Data Sources:
 * - ~/.local/state/warp-terminal/warp.sqlite
 * - ~/.local/state/warp-terminal-preview/warp.sqlite
 *
 * @version 1.0.0
 * @see Design: ../docs/design/memory-orchestrator.md
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { BaseAdapter } = require('./base-adapter.cjs');
const { SQLiteStore } = require('../core/sqlite-store.cjs');

// =============================================================================
// WARP SQLITE ADAPTER
// =============================================================================

/**
 * Adapter for Warp Terminal AI history
 * Priority: 0.75 - Valuable local context, but less curated than episodic memory
 */
class WarpSQLiteAdapter extends BaseAdapter {
  /**
   * @param {Object} config
   * @param {string[]} [config.dbPaths] - Explicit database paths (for testing)
   * @param {boolean} [config.enabled=true] - Enable/disable adapter
   */
  constructor(config = {}) {
    super({
      name: 'warp-sqlite',
      priority: 0.75,
      timeout: 500,  // Local SQLite is fast
      enabled: config.enabled !== false,
    });

    // Database paths - use explicit paths or discover defaults
    this.dbPaths = config.dbPaths || this._discoverDatabases();

    // Lazy-loaded store references
    this._stores = new Map();
  }

  /**
   * Discover Warp database locations
   * @private
   * @returns {string[]}
   */
  _discoverDatabases() {
    const homeDir = os.homedir();
    const candidates = [
      path.join(homeDir, '.local/state/warp-terminal/warp.sqlite'),
      path.join(homeDir, '.local/state/warp-terminal-preview/warp.sqlite'),
    ];

    return candidates.filter(p => fs.existsSync(p));
  }

  /**
   * Get or create SQLiteStore for a database
   * @private
   * @param {string} dbPath
   * @returns {SQLiteStore|null}
   */
  _getStore(dbPath) {
    if (!this._stores.has(dbPath)) {
      try {
        if (fs.existsSync(dbPath)) {
          this._stores.set(dbPath, new SQLiteStore(dbPath, { readonly: true }));
        }
      } catch (error) {
        console.warn(`[WarpSQLiteAdapter] Failed to open ${dbPath}:`, error.message);
        return null;
      }
    }
    return this._stores.get(dbPath) || null;
  }

  /**
   * Check if any Warp database is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return this.dbPaths.some(p => fs.existsSync(p));
  }

  /**
   * Warp data is read-only
   * @returns {boolean}
   */
  supportsWrite() {
    return false;
  }
}

module.exports = { WarpSQLiteAdapter };
```

**Run:** `node ~/.claude/memory/tests/test-warp-adapter.cjs`
**Expected:** PASS (2 tests)

---

### Step 2.3: Write failing tests for isAvailable and query

Add to `test-warp-adapter.cjs`:

```javascript
// =============================================================================
// AVAILABILITY TESTS
// =============================================================================

await testAsync('WarpSQLiteAdapter.isAvailable returns true for valid db', async () => {
  const adapter = new WarpSQLiteAdapter({ dbPaths: [mockDbPath] });
  const available = await adapter.isAvailable();
  assertTrue(available, 'Should be available with valid database');
});

await testAsync('WarpSQLiteAdapter.isAvailable returns false for missing db', async () => {
  const adapter = new WarpSQLiteAdapter({ dbPaths: ['/nonexistent/path.db'] });
  const available = await adapter.isAvailable();
  assertFalse(available, 'Should not be available with missing database');
});

// =============================================================================
// QUERY TESTS
// =============================================================================

await testAsync('WarpSQLiteAdapter.query returns normalized records', async () => {
  const adapter = new WarpSQLiteAdapter({ dbPaths: [mockDbPath] });

  const context = {
    tags: ['typescript', 'error'],
    intent: 'debugging',
    intentConfidence: 0.8,
  };

  const records = await adapter.query(context, { limit: 10 });

  assertTrue(Array.isArray(records), 'Should return array');
  assertTrue(records.length > 0, 'Should return records');

  // Check first record structure
  const record = records[0];
  assertTrue(record.id, 'Should have id');
  assertTrue(record.content, 'Should have content');
  assertTrue(record.type, 'Should have type');
  assertEqual(record._source, 'warp-sqlite', 'Should have source');
});

await testAsync('WarpSQLiteAdapter.query filters by working directory', async () => {
  const adapter = new WarpSQLiteAdapter({ dbPaths: [mockDbPath] });

  const context = {
    projectHash: '/home/rob/project',
    tags: [],
  };

  const records = await adapter.query(context, { projectHash: '/home/rob/project' });

  // Should only return records from /home/rob/project
  for (const record of records) {
    assertEqual(record.projectHash, '/home/rob/project', 'Should filter by project');
  }
});

await testAsync('WarpSQLiteAdapter.query respects limit', async () => {
  const adapter = new WarpSQLiteAdapter({ dbPaths: [mockDbPath] });

  const records = await adapter.query({}, { limit: 1 });

  assertEqual(records.length, 1, 'Should respect limit');
});
```

**Run:** `node ~/.claude/memory/tests/test-warp-adapter.cjs`
**Expected:** FAIL with "adapter.query is not a function" or returns empty

---

### Step 2.4: Implement query method

Add to `WarpSQLiteAdapter` class:

```javascript
  /**
   * Query Warp AI history for relevant memories
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @param {import('./base-adapter.cjs').QueryOptions} [options]
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async query(context, options = {}) {
    return this._executeQuery(async () => {
      const allRecords = [];

      for (const dbPath of this.dbPaths) {
        const store = this._getStore(dbPath);
        if (!store) continue;

        // Query ai_queries table
        const queries = this._queryAiQueries(store, context, options);
        allRecords.push(...queries);

        // Query agent_conversations table
        const agents = this._queryAgentConversations(store, context, options);
        allRecords.push(...agents);
      }

      // Sort by timestamp descending (most recent first)
      allRecords.sort((a, b) =>
        new Date(b.sourceTimestamp).getTime() - new Date(a.sourceTimestamp).getTime()
      );

      // Apply limit
      const limit = options.limit || 50;
      return allRecords.slice(0, limit);
    });
  }

  /**
   * Query ai_queries table
   * @private
   */
  _queryAiQueries(store, context, options) {
    const records = [];

    let sql = `
      SELECT id, exchange_id, conversation_id, start_ts, input,
             working_directory, output_status, model_id
      FROM ai_queries
      WHERE 1=1
    `;
    const params = [];

    // Filter by working directory if project specified
    if (options.projectHash) {
      sql += ` AND working_directory = ?`;
      params.push(options.projectHash);
    }

    // Order by most recent first
    sql += ` ORDER BY start_ts DESC`;

    // Apply limit at SQL level for efficiency
    const limit = (options.limit || 50) * 2;  // Get extra to allow filtering
    sql += ` LIMIT ?`;
    params.push(limit);

    const rows = store.query(sql, params);

    for (const row of rows) {
      const record = this._normalizeAiQuery(row);
      if (record && this._matchesContext(record, context)) {
        records.push(record);
      }
    }

    return records;
  }

  /**
   * Query agent_conversations table
   * @private
   */
  _queryAgentConversations(store, context, options) {
    const records = [];

    let sql = `
      SELECT id, conversation_id, conversation_data, last_modified_at
      FROM agent_conversations
      ORDER BY last_modified_at DESC
    `;
    const params = [];

    const limit = options.limit || 20;
    sql += ` LIMIT ?`;
    params.push(limit);

    const rows = store.query(sql, params);

    for (const row of rows) {
      const record = this._normalizeAgentConversation(row);
      if (record && this._matchesContext(record, context)) {
        records.push(record);
      }
    }

    return records;
  }

  /**
   * Check if record matches query context
   * @private
   */
  _matchesContext(record, context) {
    if (!context.tags?.length && !context.intent) {
      return true;  // No filters, match all
    }

    const contentLower = record.content.toLowerCase();

    // Check tag matches
    if (context.tags?.length) {
      const hasTag = context.tags.some(tag =>
        contentLower.includes(tag.toLowerCase())
      );
      if (hasTag) return true;
    }

    // Check intent matches
    if (context.intent) {
      if (contentLower.includes(context.intent.toLowerCase())) {
        return true;
      }
    }

    return false;
  }

  /**
   * Normalize ai_queries row to MemoryRecord
   * @param {Object} row
   * @returns {import('./base-adapter.cjs').MemoryRecord|null}
   */
  normalize(row) {
    // Delegate to appropriate normalizer
    if (row.input !== undefined) {
      return this._normalizeAiQuery(row);
    } else if (row.conversation_data !== undefined) {
      return this._normalizeAgentConversation(row);
    }
    return null;
  }

  /**
   * Normalize ai_queries row
   * @private
   */
  _normalizeAiQuery(row) {
    try {
      // Parse input JSON
      let inputData = {};
      try {
        inputData = JSON.parse(row.input);
      } catch {
        inputData = { query: row.input };
      }

      const query = inputData.query || inputData.text || row.input;
      const context = inputData.context || '';

      // Infer type from content
      const type = this._inferType(query);

      // Extract tags from content
      const tags = this._extractTags(query + ' ' + context);

      return this._createBaseRecord({
        id: `warp:query:${row.id}`,
        version: 1,
        type,
        content: query,
        summary: query.slice(0, 100),
        projectHash: row.working_directory || null,
        tags,
        intent: this._inferIntent(query),
        sourceSessionId: row.conversation_id,
        sourceTimestamp: row.start_ts,
        extractionConfidence: row.output_status === 'success' ? 0.8 : 0.5,
        usageCount: 1,
        usageSuccessRate: row.output_status === 'success' ? 1.0 : 0.0,
        lastUsed: row.start_ts,
        decayScore: this._calculateDecay(row.start_ts),
        status: 'active',
        createdAt: row.start_ts,
        updatedAt: row.start_ts,
        _warpModel: row.model_id,
        _warpExchangeId: row.exchange_id,
      });
    } catch (error) {
      console.warn('[WarpSQLiteAdapter] Failed to normalize query:', error.message);
      return null;
    }
  }

  /**
   * Normalize agent_conversations row
   * @private
   */
  _normalizeAgentConversation(row) {
    try {
      const data = JSON.parse(row.conversation_data);
      const title = data.title || 'Agent Conversation';
      const messages = data.messages || [];

      // Combine messages into content
      const content = messages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n\n');

      const tags = this._extractTags(title + ' ' + content);

      return this._createBaseRecord({
        id: `warp:agent:${row.id}`,
        version: 1,
        type: 'skill',  // Agent conversations are typically task-focused
        content: content,
        summary: title,
        projectHash: null,  // Agent conversations don't have working directory
        tags,
        intent: 'task',
        sourceSessionId: row.conversation_id,
        sourceTimestamp: row.last_modified_at,
        extractionConfidence: 0.9,  // Agent conversations are complete tasks
        usageCount: 1,
        usageSuccessRate: 0.8,
        lastUsed: row.last_modified_at,
        decayScore: this._calculateDecay(row.last_modified_at),
        status: 'active',
        createdAt: row.last_modified_at,
        updatedAt: row.last_modified_at,
        _warpConversationId: row.conversation_id,
      });
    } catch (error) {
      console.warn('[WarpSQLiteAdapter] Failed to normalize agent conversation:', error.message);
      return null;
    }
  }

  /**
   * Infer memory type from content
   * @private
   */
  _inferType(content) {
    const lower = content.toLowerCase();

    if (lower.includes('error') || lower.includes('fix') || lower.includes('debug')) {
      return 'learning';
    }
    if (lower.includes('how to') || lower.includes('how do')) {
      return 'skill';
    }
    if (lower.includes('explain') || lower.includes('what is')) {
      return 'learning';
    }
    if (lower.includes('best practice') || lower.includes('pattern')) {
      return 'pattern';
    }

    return 'learning';
  }

  /**
   * Infer intent from content
   * @private
   */
  _inferIntent(content) {
    const lower = content.toLowerCase();

    if (lower.includes('error') || lower.includes('fix') || lower.includes('debug')) {
      return 'debugging';
    }
    if (lower.includes('how to') || lower.includes('setup') || lower.includes('install')) {
      return 'setup';
    }
    if (lower.includes('explain') || lower.includes('what is')) {
      return 'learning';
    }

    return 'general';
  }

  /**
   * Extract tags from content
   * @private
   */
  _extractTags(content) {
    const tags = [];
    const lower = content.toLowerCase();

    const techPatterns = [
      'typescript', 'javascript', 'python', 'node', 'react', 'vue',
      'git', 'docker', 'kubernetes', 'linux', 'bash', 'zsh',
      'rust', 'go', 'java', 'sql', 'postgres', 'mongodb',
      'api', 'rest', 'graphql', 'json', 'yaml',
    ];

    for (const tech of techPatterns) {
      if (lower.includes(tech)) {
        tags.push(tech);
      }
    }

    return tags.slice(0, 5);
  }

  /**
   * Calculate decay score based on timestamp
   * @private
   */
  _calculateDecay(timestamp) {
    const date = new Date(timestamp);
    const age = Date.now() - date.getTime();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    return Math.max(0.1, Math.exp(-age / thirtyDays));
  }

  /**
   * Close all database connections
   */
  close() {
    for (const store of this._stores.values()) {
      store.close();
    }
    this._stores.clear();
  }
```

**Run:** `node ~/.claude/memory/tests/test-warp-adapter.cjs`
**Expected:** PASS (7 tests)

---

### Step 2.5: Write failing test for getStats

Add to `test-warp-adapter.cjs`:

```javascript
// =============================================================================
// STATS TESTS
// =============================================================================

await testAsync('WarpSQLiteAdapter.getStats returns record counts', async () => {
  const adapter = new WarpSQLiteAdapter({ dbPaths: [mockDbPath] });

  const stats = await adapter.getStats();

  assertEqual(stats.name, 'warp-sqlite', 'Should have adapter name');
  assertTrue(stats.available, 'Should be available');
  assertFalse(stats.supportsWrite, 'Should not support write');
});

await testAsync('WarpSQLiteAdapter.getTotalCounts returns query and agent counts', async () => {
  const adapter = new WarpSQLiteAdapter({ dbPaths: [mockDbPath] });

  const counts = adapter.getTotalCounts();

  assertEqual(counts.queries, 3, 'Should count 3 queries');
  assertEqual(counts.agents, 1, 'Should count 1 agent conversation');
  assertEqual(counts.total, 4, 'Should count 4 total');
});
```

**Run:** `node ~/.claude/memory/tests/test-warp-adapter.cjs`
**Expected:** FAIL with "adapter.getTotalCounts is not a function"

---

### Step 2.6: Implement getTotalCounts

Add to `WarpSQLiteAdapter` class:

```javascript
  /**
   * Get total record counts across all databases
   * @returns {{queries: number, agents: number, total: number, byDatabase: Object}}
   */
  getTotalCounts() {
    const counts = {
      queries: 0,
      agents: 0,
      total: 0,
      byDatabase: {},
    };

    for (const dbPath of this.dbPaths) {
      const store = this._getStore(dbPath);
      if (!store) continue;

      const dbName = path.basename(path.dirname(dbPath));
      const queryCount = store.getRowCount('ai_queries');
      const agentCount = store.getRowCount('agent_conversations');

      counts.queries += queryCount;
      counts.agents += agentCount;
      counts.byDatabase[dbName] = {
        queries: queryCount,
        agents: agentCount,
      };
    }

    counts.total = counts.queries + counts.agents;
    return counts;
  }
```

**Run:** `node ~/.claude/memory/tests/test-warp-adapter.cjs`
**Expected:** PASS (9 tests)

---

### Step 2.7: Commit WarpSQLiteAdapter

```bash
cd ~/.claude/memory
git add adapters/warp-sqlite-adapter.cjs tests/test-warp-adapter.cjs
git commit -m "feat(adapters): add WarpSQLiteAdapter for Warp Terminal AI history

- Reads from ~/.local/state/warp-terminal/warp.sqlite
- Supports both ai_queries and agent_conversations tables
- Normalizes to MemoryRecord format with tags, intent, decay
- Read-only adapter (Warp manages its own database)
- Filters by working directory for project-specific queries
- getTotalCounts() for statistics

Unlocks 1,708+ AI queries and 49 agent conversations

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create GeminiAdapter

**Files:**
- Create: `~/.claude/memory/adapters/gemini-adapter.cjs`
- Test: `~/.claude/memory/tests/test-gemini-adapter.cjs`

**Purpose:** Read Google Antigravity/Gemini task sessions (15+ sessions with markdown files).

**Data Source:** `~/.gemini/antigravity/brain/`

**Structure:**
```
~/.gemini/antigravity/brain/
├── <uuid>/
│   ├── task.md
│   ├── implementation_plan.md
│   ├── walkthrough.md
│   └── verification_plan.md
└── <uuid>/
    └── ...
```

---

### Step 3.1: Write failing test for GeminiAdapter constructor

```javascript
// tests/test-gemini-adapter.cjs
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    testsPassed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    testsFailed++;
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    testsPassed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    testsFailed++;
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(`${message}: expected truthy value`);
  }
}

function assertFalse(value, message) {
  if (value) {
    throw new Error(`${message}: expected falsy value`);
  }
}

// Create mock Gemini brain directory
const tempDir = path.join(os.tmpdir(), `gemini-adapter-test-${Date.now()}`);
const brainDir = path.join(tempDir, 'brain');

// Create test sessions
const session1 = path.join(brainDir, 'session-001');
const session2 = path.join(brainDir, 'session-002');

fs.mkdirSync(session1, { recursive: true });
fs.mkdirSync(session2, { recursive: true });

// Session 1: Docker setup
fs.writeFileSync(path.join(session1, 'task.md'), `# Task: Set up Docker for development

## Goal
Configure Docker and docker-compose for the project.

## Requirements
- Dockerfile for Node.js app
- docker-compose.yml with PostgreSQL
- Volume mounts for development
`);

fs.writeFileSync(path.join(session1, 'implementation_plan.md'), `# Implementation Plan

## Step 1: Create Dockerfile
Create a multi-stage Dockerfile...

## Step 2: Create docker-compose.yml
Add services for app and database...
`);

// Session 2: Git configuration
fs.writeFileSync(path.join(session2, 'task.md'), `# Task: Configure Git hooks

## Goal
Set up pre-commit hooks for linting.
`);

fs.writeFileSync(path.join(session2, 'walkthrough.md'), `# Walkthrough

1. Install husky
2. Configure pre-commit script
`);

// Import module under test
const { GeminiAdapter } = require('../adapters/gemini-adapter.cjs');

// =============================================================================
// CONSTRUCTOR TESTS
// =============================================================================

test('GeminiAdapter constructor with explicit path', () => {
  const adapter = new GeminiAdapter({ brainPath: brainDir });

  assertEqual(adapter.name, 'gemini', 'Should have correct name');
  assertEqual(adapter.priority, 0.7, 'Should have priority 0.7');
  assertTrue(adapter.enabled, 'Should be enabled by default');
});

test('GeminiAdapter does not support write', () => {
  const adapter = new GeminiAdapter({ brainPath: brainDir });

  assertFalse(adapter.supportsWrite(), 'Gemini data is read-only');
});

// Cleanup
process.on('exit', () => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
  process.exitCode = testsFailed > 0 ? 1 : 0;
});
```

**Run:** `node ~/.claude/memory/tests/test-gemini-adapter.cjs`
**Expected:** FAIL with "Cannot find module '../adapters/gemini-adapter.cjs'"

---

### Step 3.2: Write minimal GeminiAdapter

```javascript
// adapters/gemini-adapter.cjs
/**
 * Cortex - Claude's Cognitive Layer - Gemini Adapter
 *
 * Reads task sessions from Google Antigravity/Gemini brain directory.
 * Provides access to 15+ task sessions with markdown files.
 *
 * Data Source: ~/.gemini/antigravity/brain/
 *
 * Session Structure:
 * - task.md - Task definition and requirements
 * - implementation_plan.md - Step-by-step implementation
 * - walkthrough.md - Guided walkthrough
 * - verification_plan.md - Testing and verification steps
 *
 * @version 1.0.0
 * @see Design: ../docs/design/memory-orchestrator.md
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { BaseAdapter } = require('./base-adapter.cjs');

// =============================================================================
// GEMINI ADAPTER
// =============================================================================

/**
 * Adapter for Gemini/Antigravity task sessions
 * Priority: 0.7 - Structured task sessions, less frequent than daily queries
 */
class GeminiAdapter extends BaseAdapter {
  /**
   * @param {Object} config
   * @param {string} [config.brainPath] - Explicit brain directory path
   * @param {boolean} [config.enabled=true] - Enable/disable adapter
   */
  constructor(config = {}) {
    super({
      name: 'gemini',
      priority: 0.7,
      timeout: 200,  // Local file system is fast
      enabled: config.enabled !== false,
    });

    // Brain directory - use explicit path or discover default
    this.brainPath = config.brainPath || this._discoverBrainPath();

    // Cache of loaded sessions
    this._sessionCache = new Map();
    this._cacheTTL = 5 * 60 * 1000;  // 5 minutes
  }

  /**
   * Discover Gemini brain directory
   * @private
   * @returns {string|null}
   */
  _discoverBrainPath() {
    const homeDir = os.homedir();
    const candidates = [
      path.join(homeDir, '.gemini/antigravity/brain'),
      path.join(homeDir, '.gemini/brain'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Check if Gemini brain directory exists
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return this.brainPath && fs.existsSync(this.brainPath);
  }

  /**
   * Gemini data is read-only
   * @returns {boolean}
   */
  supportsWrite() {
    return false;
  }
}

module.exports = { GeminiAdapter };
```

**Run:** `node ~/.claude/memory/tests/test-gemini-adapter.cjs`
**Expected:** PASS (2 tests)

---

### Step 3.3: Write failing tests for query

Add to `test-gemini-adapter.cjs`:

```javascript
// =============================================================================
// QUERY TESTS
// =============================================================================

await testAsync('GeminiAdapter.query returns normalized records', async () => {
  const adapter = new GeminiAdapter({ brainPath: brainDir });

  const context = {
    tags: ['docker'],
    intent: 'setup',
    intentConfidence: 0.8,
  };

  const records = await adapter.query(context, { limit: 10 });

  assertTrue(Array.isArray(records), 'Should return array');
  assertTrue(records.length > 0, 'Should return records');

  // Check record structure
  const record = records[0];
  assertTrue(record.id, 'Should have id');
  assertTrue(record.content, 'Should have content');
  assertEqual(record._source, 'gemini', 'Should have source');
});

await testAsync('GeminiAdapter.query returns all sessions without filter', async () => {
  const adapter = new GeminiAdapter({ brainPath: brainDir });

  const records = await adapter.query({}, {});

  // We have 2 sessions, each with multiple files
  assertTrue(records.length >= 2, 'Should return records from both sessions');
});

await testAsync('GeminiAdapter.query filters by content', async () => {
  const adapter = new GeminiAdapter({ brainPath: brainDir });

  const context = {
    tags: ['git', 'hooks'],
  };

  const records = await adapter.query(context, {});

  // Should match session 2 (git hooks)
  assertTrue(records.length > 0, 'Should find git hooks session');
  assertTrue(
    records.some(r => r.content.toLowerCase().includes('git')),
    'Should contain git-related content'
  );
});
```

**Run:** `node ~/.claude/memory/tests/test-gemini-adapter.cjs`
**Expected:** FAIL with query returning empty or error

---

### Step 3.4: Implement query method

Add to `GeminiAdapter` class:

```javascript
  /**
   * Query Gemini task sessions for relevant memories
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @param {import('./base-adapter.cjs').QueryOptions} [options]
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async query(context, options = {}) {
    return this._executeQuery(async () => {
      if (!this.brainPath || !fs.existsSync(this.brainPath)) {
        return [];
      }

      const allRecords = [];
      const sessions = this._discoverSessions();

      for (const sessionPath of sessions) {
        const sessionRecords = this._loadSession(sessionPath);

        for (const record of sessionRecords) {
          if (this._matchesContext(record, context)) {
            allRecords.push(record);
          }
        }
      }

      // Sort by timestamp descending
      allRecords.sort((a, b) =>
        new Date(b.sourceTimestamp).getTime() - new Date(a.sourceTimestamp).getTime()
      );

      // Apply limit
      const limit = options.limit || 50;
      return allRecords.slice(0, limit);
    });
  }

  /**
   * Discover session directories
   * @private
   * @returns {string[]}
   */
  _discoverSessions() {
    if (!this.brainPath) return [];

    try {
      const entries = fs.readdirSync(this.brainPath, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => path.join(this.brainPath, e.name));
    } catch (error) {
      console.warn('[GeminiAdapter] Failed to list sessions:', error.message);
      return [];
    }
  }

  /**
   * Load all files from a session directory
   * @private
   * @param {string} sessionPath
   * @returns {import('./base-adapter.cjs').MemoryRecord[]}
   */
  _loadSession(sessionPath) {
    const cacheKey = sessionPath;
    const cached = this._sessionCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this._cacheTTL) {
      this._trackCacheAccess(true);
      return cached.records;
    }
    this._trackCacheAccess(false);

    const records = [];
    const sessionId = path.basename(sessionPath);
    const sessionStat = fs.statSync(sessionPath);

    // Known file types in Gemini sessions
    const fileTypes = [
      { name: 'task.md', type: 'skill', priority: 1.0 },
      { name: 'implementation_plan.md', type: 'pattern', priority: 0.9 },
      { name: 'walkthrough.md', type: 'skill', priority: 0.8 },
      { name: 'verification_plan.md', type: 'pattern', priority: 0.7 },
    ];

    for (const fileType of fileTypes) {
      const filePath = path.join(sessionPath, fileType.name);

      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const record = this._normalizeFile(
            sessionId,
            fileType.name,
            content,
            fileType.type,
            fileType.priority,
            sessionStat.mtime
          );
          if (record) {
            records.push(record);
          }
        } catch (error) {
          console.warn(`[GeminiAdapter] Failed to read ${filePath}:`, error.message);
        }
      }
    }

    // Cache the results
    this._sessionCache.set(cacheKey, {
      records,
      timestamp: Date.now(),
    });

    return records;
  }

  /**
   * Normalize a file to MemoryRecord
   * @private
   */
  _normalizeFile(sessionId, fileName, content, type, confidence, mtime) {
    // Extract title from first heading
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : fileName.replace('.md', '');

    // Extract tags from content
    const tags = this._extractTags(content);

    return this._createBaseRecord({
      id: `gemini:${sessionId}:${fileName}`,
      version: 1,
      type,
      content,
      summary: title.slice(0, 100),
      projectHash: null,  // Gemini sessions don't have project context
      tags,
      intent: this._inferIntent(content),
      sourceSessionId: sessionId,
      sourceTimestamp: mtime.toISOString(),
      extractionConfidence: confidence,
      usageCount: 1,
      usageSuccessRate: 0.8,
      lastUsed: mtime.toISOString(),
      decayScore: this._calculateDecay(mtime),
      status: 'active',
      createdAt: mtime.toISOString(),
      updatedAt: mtime.toISOString(),
      _geminiFileName: fileName,
    });
  }

  /**
   * Normalize raw data (required by BaseAdapter)
   * @param {Object} raw
   * @returns {import('./base-adapter.cjs').MemoryRecord|null}
   */
  normalize(raw) {
    if (!raw || !raw.content) return null;
    return this._normalizeFile(
      raw.sessionId || 'unknown',
      raw.fileName || 'unknown.md',
      raw.content,
      raw.type || 'learning',
      raw.confidence || 0.5,
      new Date(raw.mtime || Date.now())
    );
  }

  /**
   * Check if record matches query context
   * @private
   */
  _matchesContext(record, context) {
    if (!context.tags?.length && !context.intent) {
      return true;  // No filters, match all
    }

    const contentLower = record.content.toLowerCase();

    // Check tag matches
    if (context.tags?.length) {
      const hasTag = context.tags.some(tag =>
        contentLower.includes(tag.toLowerCase())
      );
      if (hasTag) return true;
    }

    // Check intent matches
    if (context.intent) {
      if (contentLower.includes(context.intent.toLowerCase())) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract tags from markdown content
   * @private
   */
  _extractTags(content) {
    const tags = [];
    const lower = content.toLowerCase();

    const techPatterns = [
      'docker', 'kubernetes', 'git', 'github',
      'typescript', 'javascript', 'python', 'node',
      'react', 'vue', 'angular',
      'postgres', 'mysql', 'mongodb', 'redis',
      'linux', 'bash', 'shell',
      'api', 'rest', 'graphql',
      'test', 'ci', 'cd', 'deploy',
    ];

    for (const tech of techPatterns) {
      if (lower.includes(tech)) {
        tags.push(tech);
      }
    }

    return tags.slice(0, 5);
  }

  /**
   * Infer intent from content
   * @private
   */
  _inferIntent(content) {
    const lower = content.toLowerCase();

    if (lower.includes('install') || lower.includes('setup') || lower.includes('configure')) {
      return 'setup';
    }
    if (lower.includes('debug') || lower.includes('fix') || lower.includes('error')) {
      return 'debugging';
    }
    if (lower.includes('test') || lower.includes('verify')) {
      return 'testing';
    }
    if (lower.includes('implement') || lower.includes('create') || lower.includes('build')) {
      return 'implementation';
    }

    return 'task';
  }

  /**
   * Calculate decay score
   * @private
   */
  _calculateDecay(date) {
    const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime();
    const age = Date.now() - timestamp;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    return Math.max(0.1, Math.exp(-age / thirtyDays));
  }

  /**
   * Get session count
   * @returns {number}
   */
  getSessionCount() {
    return this._discoverSessions().length;
  }

  /**
   * Clear cache
   */
  clearCache() {
    this._sessionCache.clear();
  }
```

**Run:** `node ~/.claude/memory/tests/test-gemini-adapter.cjs`
**Expected:** PASS (5 tests)

---

### Step 3.5: Commit GeminiAdapter

```bash
cd ~/.claude/memory
git add adapters/gemini-adapter.cjs tests/test-gemini-adapter.cjs
git commit -m "feat(adapters): add GeminiAdapter for Antigravity task sessions

- Reads from ~/.gemini/antigravity/brain/
- Parses task.md, implementation_plan.md, walkthrough.md, verification_plan.md
- Normalizes markdown to MemoryRecord format
- Extracts tags, intent, and title from content
- Session caching with 5-minute TTL
- Read-only adapter (Gemini manages its own files)

Unlocks 15+ structured task sessions

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Create EpisodicAnnotationsLayer

**Files:**
- Create: `~/.claude/memory/adapters/episodic-annotations-layer.cjs`
- Modify: `~/.claude/memory/adapters/episodic-memory-adapter.cjs`
- Test: `~/.claude/memory/tests/test-episodic-annotations.cjs`

**Purpose:** Enable write operations on episodic memory without corrupting the read-only conversation archives. Annotations are stored separately in JSONL format and merged with search results.

**Architecture:**
```
Episodic Memory (Read-Only)     Annotations Layer (Read-Write)
┌─────────────────────────┐     ┌─────────────────────────┐
│ conversation-archive/   │     │ ~/.claude/memory/       │
│   session-1.jsonl       │────▶│   annotations/          │
│   session-2.jsonl       │     │     episodic.jsonl      │
└─────────────────────────┘     └─────────────────────────┘
         │                                │
         └────────────┬───────────────────┘
                      │
              ┌───────▼───────┐
              │ Merged Results│
              │ + enrichments │
              └───────────────┘
```

---

### Step 4.1: Write failing test for EpisodicAnnotationsLayer

```javascript
// tests/test-episodic-annotations.cjs
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    testsPassed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    testsFailed++;
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    testsPassed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    testsFailed++;
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(`${message}: expected truthy value`);
  }
}

function assertFalse(value, message) {
  if (value) {
    throw new Error(`${message}: expected falsy value`);
  }
}

// Create temp directory
const tempDir = path.join(os.tmpdir(), `episodic-annotations-test-${Date.now()}`);
fs.mkdirSync(tempDir, { recursive: true });

// Import module under test
const { EpisodicAnnotationsLayer } = require('../adapters/episodic-annotations-layer.cjs');

// =============================================================================
// CONSTRUCTOR TESTS
// =============================================================================

test('EpisodicAnnotationsLayer constructor creates storage', () => {
  const layer = new EpisodicAnnotationsLayer({ basePath: tempDir });

  assertTrue(layer, 'Should create instance');
  assertTrue(fs.existsSync(path.join(tempDir, 'annotations')), 'Should create annotations directory');
});

test('EpisodicAnnotationsLayer supports write', () => {
  const layer = new EpisodicAnnotationsLayer({ basePath: tempDir });

  assertTrue(layer.supportsWrite(), 'Should support write operations');
});

// Cleanup
process.on('exit', () => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
  process.exitCode = testsFailed > 0 ? 1 : 0;
});
```

**Run:** `node ~/.claude/memory/tests/test-episodic-annotations.cjs`
**Expected:** FAIL with "Cannot find module '../adapters/episodic-annotations-layer.cjs'"

---

### Step 4.2: Write minimal EpisodicAnnotationsLayer

```javascript
// adapters/episodic-annotations-layer.cjs
/**
 * Cortex - Claude's Cognitive Layer - Episodic Annotations Layer
 *
 * Enables write operations on episodic memory without corrupting
 * the read-only conversation archives. Annotations are stored
 * separately and merged with search results.
 *
 * Annotation Types:
 * - tags: Add searchable tags to conversations
 * - notes: Add user notes to specific messages
 * - corrections: Mark corrections or clarifications
 * - highlights: Mark important sections
 * - links: Connect related conversations
 *
 * @version 1.0.0
 * @see Design: ../docs/design/memory-orchestrator.md
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { JSONLStore } = require('../core/storage.cjs');

// =============================================================================
// EPISODIC ANNOTATIONS LAYER
// =============================================================================

/**
 * @typedef {Object} Annotation
 * @property {string} id - Unique annotation ID
 * @property {string} targetId - ID of the annotated record (conversation path)
 * @property {string} targetType - 'conversation' | 'message' | 'snippet'
 * @property {'tag' | 'note' | 'correction' | 'highlight' | 'link'} annotationType
 * @property {string} content - Annotation content
 * @property {Object} [metadata] - Additional metadata
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 */

/**
 * Layer that adds write capability to episodic memory
 */
class EpisodicAnnotationsLayer {
  /**
   * @param {Object} config
   * @param {string} [config.basePath] - Base directory for annotations storage
   */
  constructor(config = {}) {
    this.basePath = config.basePath || path.join(
      process.env.HOME || process.env.USERPROFILE,
      '.claude/memory'
    );

    // Ensure annotations directory exists
    this.annotationsDir = path.join(this.basePath, 'annotations');
    if (!fs.existsSync(this.annotationsDir)) {
      fs.mkdirSync(this.annotationsDir, { recursive: true });
    }

    // Storage for annotations
    this._store = new JSONLStore(path.join(this.annotationsDir, 'episodic.jsonl'));
    this._loaded = false;
  }

  /**
   * Ensure store is loaded
   * @private
   */
  async _ensureLoaded() {
    if (!this._loaded) {
      await this._store.load();
      this._loaded = true;
    }
  }

  /**
   * Check if write is supported
   * @returns {boolean}
   */
  supportsWrite() {
    return true;
  }
}

module.exports = { EpisodicAnnotationsLayer };
```

**Run:** `node ~/.claude/memory/tests/test-episodic-annotations.cjs`
**Expected:** PASS (2 tests)

---

### Step 4.3: Write failing tests for annotation CRUD

Add to `test-episodic-annotations.cjs`:

```javascript
// =============================================================================
// WRITE TESTS
// =============================================================================

await testAsync('EpisodicAnnotationsLayer.addAnnotation creates annotation', async () => {
  const layer = new EpisodicAnnotationsLayer({ basePath: tempDir });

  const result = await layer.addAnnotation({
    targetId: '/path/to/conversation.jsonl',
    targetType: 'conversation',
    annotationType: 'tag',
    content: 'important',
  });

  assertTrue(result.success, 'Should succeed');
  assertTrue(result.id, 'Should return annotation ID');
});

await testAsync('EpisodicAnnotationsLayer.getAnnotations retrieves by target', async () => {
  const layer = new EpisodicAnnotationsLayer({ basePath: tempDir });

  // Add some annotations
  await layer.addAnnotation({
    targetId: '/path/to/session-1.jsonl',
    targetType: 'conversation',
    annotationType: 'tag',
    content: 'debugging',
  });

  await layer.addAnnotation({
    targetId: '/path/to/session-1.jsonl',
    targetType: 'conversation',
    annotationType: 'note',
    content: 'Contains solution for memory leak',
  });

  await layer.addAnnotation({
    targetId: '/path/to/session-2.jsonl',
    targetType: 'conversation',
    annotationType: 'tag',
    content: 'setup',
  });

  const annotations = await layer.getAnnotations('/path/to/session-1.jsonl');

  assertEqual(annotations.length, 2, 'Should return 2 annotations for session-1');
});

await testAsync('EpisodicAnnotationsLayer.updateAnnotation modifies content', async () => {
  const layer = new EpisodicAnnotationsLayer({ basePath: tempDir });

  const { id } = await layer.addAnnotation({
    targetId: '/path/to/test.jsonl',
    targetType: 'conversation',
    annotationType: 'note',
    content: 'Original note',
  });

  const result = await layer.updateAnnotation(id, { content: 'Updated note' });

  assertTrue(result.success, 'Should succeed');

  const annotations = await layer.getAnnotations('/path/to/test.jsonl');
  const updated = annotations.find(a => a.id === id);

  assertEqual(updated.content, 'Updated note', 'Content should be updated');
});

await testAsync('EpisodicAnnotationsLayer.deleteAnnotation removes annotation', async () => {
  const layer = new EpisodicAnnotationsLayer({ basePath: tempDir });

  const { id } = await layer.addAnnotation({
    targetId: '/path/to/delete-test.jsonl',
    targetType: 'conversation',
    annotationType: 'tag',
    content: 'to-delete',
  });

  const result = await layer.deleteAnnotation(id);

  assertTrue(result.success, 'Should succeed');

  const annotations = await layer.getAnnotations('/path/to/delete-test.jsonl');
  const found = annotations.find(a => a.id === id);

  assertEqual(found, undefined, 'Annotation should be deleted');
});
```

**Run:** `node ~/.claude/memory/tests/test-episodic-annotations.cjs`
**Expected:** FAIL with "layer.addAnnotation is not a function"

---

### Step 4.4: Implement CRUD methods

Add to `EpisodicAnnotationsLayer` class:

```javascript
  /**
   * Add a new annotation
   * @param {Object} annotation
   * @param {string} annotation.targetId - ID of the annotated record
   * @param {'conversation' | 'message' | 'snippet'} annotation.targetType
   * @param {'tag' | 'note' | 'correction' | 'highlight' | 'link'} annotation.annotationType
   * @param {string} annotation.content
   * @param {Object} [annotation.metadata]
   * @returns {Promise<{success: boolean, id?: string, error?: string}>}
   */
  async addAnnotation(annotation) {
    await this._ensureLoaded();

    const now = new Date().toISOString();
    const id = `ann:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;

    const record = {
      id,
      targetId: annotation.targetId,
      targetType: annotation.targetType || 'conversation',
      annotationType: annotation.annotationType,
      content: annotation.content,
      metadata: annotation.metadata || {},
      createdAt: now,
      updatedAt: now,
    };

    const result = await this._store.append(record);

    if (result.success) {
      return { success: true, id };
    } else {
      return { success: false, error: result.error || 'Failed to add annotation' };
    }
  }

  /**
   * Get all annotations for a target
   * @param {string} targetId
   * @returns {Promise<Annotation[]>}
   */
  async getAnnotations(targetId) {
    await this._ensureLoaded();

    const all = this._store.getAll();
    return all.filter(a =>
      a.targetId === targetId &&
      a.status !== 'deleted'
    );
  }

  /**
   * Get annotations by type
   * @param {string} annotationType
   * @returns {Promise<Annotation[]>}
   */
  async getAnnotationsByType(annotationType) {
    await this._ensureLoaded();

    const all = this._store.getAll();
    return all.filter(a =>
      a.annotationType === annotationType &&
      a.status !== 'deleted'
    );
  }

  /**
   * Update an annotation
   * @param {string} id
   * @param {Partial<Annotation>} updates
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async updateAnnotation(id, updates) {
    await this._ensureLoaded();

    const result = await this._store.update(id, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });

    return result;
  }

  /**
   * Delete an annotation
   * @param {string} id
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deleteAnnotation(id) {
    await this._ensureLoaded();

    return this._store.softDelete(id);
  }

  /**
   * Search annotations by content
   * @param {string} query
   * @returns {Promise<Annotation[]>}
   */
  async searchAnnotations(query) {
    await this._ensureLoaded();

    const all = this._store.getAll();
    const lowerQuery = query.toLowerCase();

    return all.filter(a =>
      a.status !== 'deleted' &&
      (a.content.toLowerCase().includes(lowerQuery) ||
       a.targetId.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get all tags across all annotations
   * @returns {Promise<{tag: string, count: number}[]>}
   */
  async getAllTags() {
    await this._ensureLoaded();

    const tags = new Map();
    const all = this._store.getAll();

    for (const annotation of all) {
      if (annotation.annotationType === 'tag' && annotation.status !== 'deleted') {
        const tag = annotation.content.toLowerCase();
        tags.set(tag, (tags.get(tag) || 0) + 1);
      }
    }

    return Array.from(tags.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Merge annotations into memory records
   * @param {import('./base-adapter.cjs').MemoryRecord[]} records
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async enrichRecords(records) {
    await this._ensureLoaded();

    const annotationsByTarget = new Map();
    const all = this._store.getAll();

    for (const annotation of all) {
      if (annotation.status !== 'deleted') {
        const existing = annotationsByTarget.get(annotation.targetId) || [];
        existing.push(annotation);
        annotationsByTarget.set(annotation.targetId, existing);
      }
    }

    return records.map(record => {
      const annotations = annotationsByTarget.get(record.id) || [];

      if (annotations.length === 0) {
        return record;
      }

      // Merge tags from tag annotations
      const tagAnnotations = annotations
        .filter(a => a.annotationType === 'tag')
        .map(a => a.content);

      // Merge notes
      const noteAnnotations = annotations
        .filter(a => a.annotationType === 'note')
        .map(a => a.content);

      return {
        ...record,
        tags: [...new Set([...record.tags, ...tagAnnotations])],
        _annotations: annotations,
        _notes: noteAnnotations,
      };
    });
  }

  /**
   * Get statistics
   * @returns {Promise<{total: number, byType: Object}>}
   */
  async getStats() {
    await this._ensureLoaded();

    const all = this._store.getAll().filter(a => a.status !== 'deleted');
    const byType = {};

    for (const annotation of all) {
      byType[annotation.annotationType] = (byType[annotation.annotationType] || 0) + 1;
    }

    return {
      total: all.length,
      byType,
    };
  }
```

**Run:** `node ~/.claude/memory/tests/test-episodic-annotations.cjs`
**Expected:** PASS (6 tests)

---

### Step 4.5: Write failing test for enrichRecords

Add to `test-episodic-annotations.cjs`:

```javascript
// =============================================================================
// ENRICHMENT TESTS
// =============================================================================

await testAsync('EpisodicAnnotationsLayer.enrichRecords merges annotations', async () => {
  const layer = new EpisodicAnnotationsLayer({ basePath: tempDir });

  // Add annotations for a record
  await layer.addAnnotation({
    targetId: 'record-123',
    targetType: 'conversation',
    annotationType: 'tag',
    content: 'useful',
  });

  await layer.addAnnotation({
    targetId: 'record-123',
    targetType: 'conversation',
    annotationType: 'note',
    content: 'This solved a tricky bug',
  });

  // Create a mock record
  const records = [{
    id: 'record-123',
    content: 'Some content',
    tags: ['existing-tag'],
  }];

  const enriched = await layer.enrichRecords(records);

  assertEqual(enriched.length, 1, 'Should return same number of records');
  assertTrue(enriched[0].tags.includes('useful'), 'Should include annotation tag');
  assertTrue(enriched[0].tags.includes('existing-tag'), 'Should keep existing tag');
  assertTrue(enriched[0]._notes.includes('This solved a tricky bug'), 'Should include notes');
});

await testAsync('EpisodicAnnotationsLayer.getAllTags returns tag counts', async () => {
  const layer = new EpisodicAnnotationsLayer({ basePath: tempDir });

  // Add multiple tags
  await layer.addAnnotation({
    targetId: 'any',
    targetType: 'conversation',
    annotationType: 'tag',
    content: 'common-tag',
  });

  await layer.addAnnotation({
    targetId: 'any2',
    targetType: 'conversation',
    annotationType: 'tag',
    content: 'common-tag',
  });

  await layer.addAnnotation({
    targetId: 'any3',
    targetType: 'conversation',
    annotationType: 'tag',
    content: 'rare-tag',
  });

  const tags = await layer.getAllTags();

  assertTrue(tags.length >= 2, 'Should have at least 2 unique tags');

  const commonTag = tags.find(t => t.tag === 'common-tag');
  assertTrue(commonTag && commonTag.count >= 2, 'common-tag should have count >= 2');
});
```

**Run:** `node ~/.claude/memory/tests/test-episodic-annotations.cjs`
**Expected:** PASS (8 tests)

---

### Step 4.6: Commit EpisodicAnnotationsLayer

```bash
cd ~/.claude/memory
git add adapters/episodic-annotations-layer.cjs tests/test-episodic-annotations.cjs
git commit -m "feat(adapters): add EpisodicAnnotationsLayer for write operations

- Enables tagging, notes, corrections, highlights, links on episodic memory
- Stores annotations separately in JSONL (preserves archive integrity)
- Full CRUD: addAnnotation, getAnnotations, updateAnnotation, deleteAnnotation
- enrichRecords() merges annotations into search results
- getAllTags() for tag cloud/autocomplete
- searchAnnotations() for cross-conversation search

Enables write operations without corrupting read-only archives

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Register Adapters in AdapterRegistry

**Files:**
- Modify: `~/.claude/memory/core/adapter-registry.cjs`
- Test: `~/.claude/memory/tests/test-adapter-registry.cjs`

**Purpose:** Add new adapters to the registry with proper initialization and MCP caller injection.

---

### Step 5.1: Update AdapterRegistry

Read existing registry and add new adapters to the factory function.

```javascript
// In adapter-registry.cjs, add imports and registration

const { WarpSQLiteAdapter } = require('../adapters/warp-sqlite-adapter.cjs');
const { GeminiAdapter } = require('../adapters/gemini-adapter.cjs');
const { EpisodicAnnotationsLayer } = require('../adapters/episodic-annotations-layer.cjs');

// In createDefaultRegistry function, add:

// Warp SQLite adapter (local AI history)
if (config.adapters?.warpSqlite?.enabled !== false) {
  const warpAdapter = new WarpSQLiteAdapter(config.adapters?.warpSqlite || {});
  registry.register(warpAdapter);
}

// Gemini adapter (task sessions)
if (config.adapters?.gemini?.enabled !== false) {
  const geminiAdapter = new GeminiAdapter(config.adapters?.gemini || {});
  registry.register(geminiAdapter);
}

// Episodic annotations layer (attached to episodic memory)
if (config.adapters?.episodicAnnotations?.enabled !== false) {
  registry.annotationsLayer = new EpisodicAnnotationsLayer(
    config.adapters?.episodicAnnotations || {}
  );
}
```

---

### Step 5.2: Commit registry update

```bash
cd ~/.claude/memory
git add core/adapter-registry.cjs
git commit -m "feat(core): register new adapters in AdapterRegistry

- Add WarpSQLiteAdapter (priority 0.75)
- Add GeminiAdapter (priority 0.7)
- Add EpisodicAnnotationsLayer (attached as registry.annotationsLayer)
- Support config options for each adapter

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Update Design Documentation

**Files:**
- Modify: `~/.claude/memory/docs/design/memory-orchestrator.md`

**Purpose:** Document new adapters and their capabilities.

---

### Step 6.1: Add new adapter documentation

Add to Section 2.3:

```markdown
#### Section 2.3.5: Warp SQLite Adapter
Local SQLite storage for Warp Terminal AI history.
- Priority: 0.75
- Timeout: 500ms
- **Read Support**: Full
  - `query()` - Search ai_queries and agent_conversations
  - `getTotalCounts()` - Statistics across all databases
- **Write Support**: No (Warp manages its own database)
- **Data Sources**:
  - `~/.local/state/warp-terminal/warp.sqlite`
  - `~/.local/state/warp-terminal-preview/warp.sqlite`

#### Section 2.3.6: Gemini Adapter
Markdown file storage for Google Antigravity/Gemini task sessions.
- Priority: 0.7
- Timeout: 200ms
- **Read Support**: Full
  - `query()` - Search task sessions by content
  - `getSessionCount()` - Count available sessions
- **Write Support**: No (Gemini manages its own files)
- **Data Source**: `~/.gemini/antigravity/brain/`

#### Section 2.3.7: Episodic Annotations Layer
Overlay for adding write capability to read-only episodic memory.
- **Write Support**: Full
  - `addAnnotation()` - Add tag, note, correction, highlight, or link
  - `updateAnnotation()` - Modify existing annotation
  - `deleteAnnotation()` - Remove annotation
  - `enrichRecords()` - Merge annotations into search results
- **Storage**: `~/.claude/memory/annotations/episodic.jsonl`
```

---

### Step 6.2: Commit documentation

```bash
cd ~/.claude/memory
git add docs/design/memory-orchestrator.md
git commit -m "docs: add WarpSQLiteAdapter, GeminiAdapter, EpisodicAnnotationsLayer

- Document data sources and schemas
- Document read/write capabilities
- Document priority and timeout settings

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

**Tasks Completed:**
1. ✅ SQLiteStore base class with connection management, transactions, introspection
2. ✅ WarpSQLiteAdapter for 1,708+ AI queries and 49 agent conversations
3. ✅ GeminiAdapter for 15+ structured task sessions
4. ✅ EpisodicAnnotationsLayer for write operations on read-only archives
5. ✅ AdapterRegistry updates
6. ✅ Documentation updates

**Total New Files:**
- `core/sqlite-store.cjs`
- `adapters/warp-sqlite-adapter.cjs`
- `adapters/gemini-adapter.cjs`
- `adapters/episodic-annotations-layer.cjs`
- `tests/test-sqlite-store.cjs`
- `tests/test-warp-adapter.cjs`
- `tests/test-gemini-adapter.cjs`
- `tests/test-episodic-annotations.cjs`

**Data Unlocked:**
- 1,708 Warp AI queries
- 49 Warp agent conversations
- 15+ Gemini task sessions
- Write capability for episodic memory enrichment

---

**Plan complete and saved to `docs/plans/2026-02-01-cortex-adapter-expansion.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
