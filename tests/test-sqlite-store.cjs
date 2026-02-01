#!/usr/bin/env node
/**
 * Cortex - Claude's Cognitive Layer - SQLiteStore Tests
 *
 * TDD tests for SQLiteStore - a reusable SQLite storage class.
 * Following the test patterns from test-core.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// Test utilities
const TEST_DIR = path.join(os.tmpdir(), 'sqlite-store-test-' + Date.now());

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
    if (error.stack) {
      console.log(`    ${error.stack.split('\n').slice(1, 3).join('\n    ')}`);
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
      console.log(`    ${error.stack.split('\n').slice(1, 3).join('\n    ')}`);
    }
    return false;
  }
}

// =============================================================================
// IMPORT MODULES
// =============================================================================

let SQLiteStore;

try {
  const sqliteStore = require('../core/sqlite-store.cjs');
  SQLiteStore = sqliteStore.SQLiteStore;
} catch (error) {
  console.error('Failed to import SQLiteStore:', error.message);
  console.error('Run tests after implementing sqlite-store.cjs');
  process.exit(1);
}

// =============================================================================
// CONSTRUCTOR TESTS
// =============================================================================

function testConstructor() {
  console.log('\n🏗️  Testing: Constructor and Options');
  let passed = 0;
  let total = 0;

  total++;
  passed += test('constructor creates database file', () => {
    const dbPath = path.join(TEST_DIR, 'test-create.db');
    const store = new SQLiteStore(dbPath);
    store.open();
    assert(fs.existsSync(dbPath), 'Database file should be created');
    store.close();
  });

  total++;
  passed += test('constructor accepts options.readonly', () => {
    const dbPath = path.join(TEST_DIR, 'test-readonly.db');
    // First create the db
    const store1 = new SQLiteStore(dbPath);
    store1.open();
    store1.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
    store1.close();

    // Now open readonly
    const store2 = new SQLiteStore(dbPath, { readonly: true });
    store2.open();
    assert(store2.isOpen(), 'Should open in readonly mode');

    // Writes should fail in readonly
    assert.throws(() => {
      store2.exec('INSERT INTO test (id) VALUES (1)');
    }, /readonly|SQLITE_READONLY/i, 'Should reject writes in readonly mode');

    store2.close();
  });

  total++;
  passed += test('constructor accepts options.wal', () => {
    const dbPath = path.join(TEST_DIR, 'test-wal.db');
    const store = new SQLiteStore(dbPath, { wal: true });
    store.open();

    // Check WAL mode is enabled
    const result = store.queryOne('PRAGMA journal_mode');
    assert(result && result.journal_mode === 'wal', 'WAL mode should be enabled');
    store.close();
  });

  total++;
  passed += test('constructor enables WAL by default', () => {
    const dbPath = path.join(TEST_DIR, 'test-wal-default.db');
    const store = new SQLiteStore(dbPath);
    store.open();

    const result = store.queryOne('PRAGMA journal_mode');
    assert(result && result.journal_mode === 'wal', 'WAL should be default');
    store.close();
  });

  total++;
  passed += test('constructor accepts options.timeout', () => {
    const dbPath = path.join(TEST_DIR, 'test-timeout.db');
    const store = new SQLiteStore(dbPath, { timeout: 10000 });
    store.open();
    assert(store.isOpen(), 'Should open with custom timeout');
    store.close();
  });

  return { passed, total };
}

// =============================================================================
// CONNECTION MANAGEMENT TESTS
// =============================================================================

function testConnectionManagement() {
  console.log('\n🔌 Testing: Connection Management');
  let passed = 0;
  let total = 0;

  total++;
  passed += test('open() establishes connection', () => {
    const dbPath = path.join(TEST_DIR, 'test-open.db');
    const store = new SQLiteStore(dbPath);
    assert(!store.isOpen(), 'Should not be open before open()');
    store.open();
    assert(store.isOpen(), 'Should be open after open()');
    store.close();
  });

  total++;
  passed += test('close() closes connection', () => {
    const dbPath = path.join(TEST_DIR, 'test-close.db');
    const store = new SQLiteStore(dbPath);
    store.open();
    assert(store.isOpen(), 'Should be open');
    store.close();
    assert(!store.isOpen(), 'Should be closed after close()');
  });

  total++;
  passed += test('isOpen() returns correct state', () => {
    const dbPath = path.join(TEST_DIR, 'test-isopen.db');
    const store = new SQLiteStore(dbPath);
    assert(!store.isOpen(), 'Should return false when closed');
    store.open();
    assert(store.isOpen(), 'Should return true when open');
    store.close();
    assert(!store.isOpen(), 'Should return false after close');
  });

  total++;
  passed += test('operations fail when not open', () => {
    const dbPath = path.join(TEST_DIR, 'test-notopen.db');
    const store = new SQLiteStore(dbPath);

    assert.throws(() => {
      store.exec('CREATE TABLE test (id INTEGER)');
    }, /not open|closed/i, 'exec should fail when not open');

    assert.throws(() => {
      store.query('SELECT 1');
    }, /not open|closed/i, 'query should fail when not open');
  });

  total++;
  passed += test('multiple open() calls are safe', () => {
    const dbPath = path.join(TEST_DIR, 'test-multiopen.db');
    const store = new SQLiteStore(dbPath);
    store.open();
    store.open(); // Should not throw
    assert(store.isOpen(), 'Should still be open');
    store.close();
  });

  total++;
  passed += test('multiple close() calls are safe', () => {
    const dbPath = path.join(TEST_DIR, 'test-multiclose.db');
    const store = new SQLiteStore(dbPath);
    store.open();
    store.close();
    store.close(); // Should not throw
    assert(!store.isOpen(), 'Should still be closed');
  });

  return { passed, total };
}

// =============================================================================
// QUERY METHODS TESTS
// =============================================================================

function testQueryMethods() {
  console.log('\n📖 Testing: Query Methods');
  let passed = 0;
  let total = 0;

  const dbPath = path.join(TEST_DIR, 'test-queries.db');
  const store = new SQLiteStore(dbPath);
  store.open();

  // Setup test table
  store.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      age INTEGER
    )
  `);

  total++;
  passed += test('exec() executes SQL without results', () => {
    // This should not throw - use single quotes for string literals in SQL
    store.exec("INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@test.com', 30)");
    store.exec("INSERT INTO users (name, email, age) VALUES ('Bob', 'bob@test.com', 25)");
    store.exec("INSERT INTO users (name, email, age) VALUES ('Charlie', 'charlie@test.com', 35)");
  });

  total++;
  passed += test('query() returns all matching rows', () => {
    const rows = store.query('SELECT * FROM users ORDER BY id');
    assert(Array.isArray(rows), 'Should return an array');
    assert(rows.length === 3, 'Should return 3 rows');
    assert(rows[0].name === 'Alice', 'First row should be Alice');
    assert(rows[1].name === 'Bob', 'Second row should be Bob');
    assert(rows[2].name === 'Charlie', 'Third row should be Charlie');
  });

  total++;
  passed += test('query() accepts parameters', () => {
    const rows = store.query('SELECT * FROM users WHERE age > ?', [28]);
    assert(rows.length === 2, 'Should return 2 rows');
    assert(rows.every(r => r.age > 28), 'All ages should be > 28');
  });

  total++;
  passed += test('query() accepts named parameters', () => {
    const rows = store.query('SELECT * FROM users WHERE age > :minAge', { minAge: 28 });
    assert(rows.length === 2, 'Should return 2 rows with named params');
  });

  total++;
  passed += test('query() returns empty array for no matches', () => {
    const rows = store.query('SELECT * FROM users WHERE age > 100');
    assert(Array.isArray(rows), 'Should return array');
    assert(rows.length === 0, 'Should be empty');
  });

  total++;
  passed += test('queryOne() returns single row', () => {
    const row = store.queryOne('SELECT * FROM users WHERE name = ?', ['Alice']);
    assert(row !== null, 'Should return a row');
    assert(row.name === 'Alice', 'Should be Alice');
    assert(row.age === 30, 'Age should be 30');
  });

  total++;
  passed += test('queryOne() returns null for no match', () => {
    const row = store.queryOne('SELECT * FROM users WHERE name = ?', ['NonExistent']);
    assert(row === null, 'Should return null');
  });

  total++;
  passed += test('queryOne() returns first row when multiple match', () => {
    const row = store.queryOne('SELECT * FROM users ORDER BY id');
    assert(row !== null, 'Should return a row');
    assert(row.name === 'Alice', 'Should be first row (Alice)');
  });

  store.close();
  return { passed, total };
}

// =============================================================================
// WRITE METHODS TESTS
// =============================================================================

function testWriteMethods() {
  console.log('\n✏️  Testing: Write Methods');
  let passed = 0;
  let total = 0;

  const dbPath = path.join(TEST_DIR, 'test-writes.db');
  const store = new SQLiteStore(dbPath);
  store.open();

  store.exec('CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT)');

  total++;
  passed += test('run() executes INSERT and returns changes', () => {
    const result = store.run('INSERT INTO items (value) VALUES (?)', ['test1']);
    assert(typeof result === 'object', 'Should return object');
    assert(result.changes === 1, 'Should have 1 change');
    assert(typeof result.lastInsertRowid === 'number' || typeof result.lastInsertRowid === 'bigint',
      'Should have lastInsertRowid');
  });

  total++;
  passed += test('run() returns correct lastInsertRowid', () => {
    const result1 = store.run('INSERT INTO items (value) VALUES (?)', ['test2']);
    const result2 = store.run('INSERT INTO items (value) VALUES (?)', ['test3']);
    assert(Number(result2.lastInsertRowid) > Number(result1.lastInsertRowid),
      'lastInsertRowid should increment');
  });

  total++;
  passed += test('run() executes UPDATE and returns changes', () => {
    const result = store.run('UPDATE items SET value = ? WHERE value = ?', ['updated', 'test1']);
    assert(result.changes === 1, 'Should have 1 change for UPDATE');
  });

  total++;
  passed += test('run() returns 0 changes when no rows affected', () => {
    const result = store.run('UPDATE items SET value = ? WHERE value = ?', ['x', 'nonexistent']);
    assert(result.changes === 0, 'Should have 0 changes');
  });

  total++;
  passed += test('run() executes DELETE and returns changes', () => {
    const result = store.run('DELETE FROM items WHERE value = ?', ['updated']);
    assert(result.changes === 1, 'Should have 1 change for DELETE');
  });

  total++;
  passed += test('run() accepts named parameters', () => {
    const result = store.run('INSERT INTO items (value) VALUES (:val)', { val: 'named' });
    assert(result.changes === 1, 'Should work with named params');
  });

  store.close();
  return { passed, total };
}

// =============================================================================
// TRANSACTION TESTS
// =============================================================================

function testTransactions() {
  console.log('\n🔄 Testing: Transactions');
  let passed = 0;
  let total = 0;

  total++;
  passed += test('transaction() commits on success', () => {
    const dbPath = path.join(TEST_DIR, 'test-tx-commit.db');
    const store = new SQLiteStore(dbPath);
    store.open();
    store.exec('CREATE TABLE tx_test (id INTEGER PRIMARY KEY, val TEXT)');

    const result = store.transaction(() => {
      store.run('INSERT INTO tx_test (val) VALUES (?)', ['a']);
      store.run('INSERT INTO tx_test (val) VALUES (?)', ['b']);
      return 'success';
    });

    assert(result === 'success', 'Should return function result');
    const rows = store.query('SELECT * FROM tx_test');
    assert(rows.length === 2, 'Both rows should be committed');
    store.close();
  });

  total++;
  passed += test('transaction() rolls back on error', () => {
    const dbPath = path.join(TEST_DIR, 'test-tx-rollback.db');
    const store = new SQLiteStore(dbPath);
    store.open();
    store.exec('CREATE TABLE tx_rollback (id INTEGER PRIMARY KEY, val TEXT)');

    try {
      store.transaction(() => {
        store.run('INSERT INTO tx_rollback (val) VALUES (?)', ['a']);
        throw new Error('Simulated failure');
      });
    } catch (e) {
      assert(e.message === 'Simulated failure', 'Should propagate error');
    }

    const rows = store.query('SELECT * FROM tx_rollback');
    assert(rows.length === 0, 'Should have rolled back');
    store.close();
  });

  total++;
  passed += test('transaction() handles nested operations', () => {
    const dbPath = path.join(TEST_DIR, 'test-tx-nested.db');
    const store = new SQLiteStore(dbPath);
    store.open();
    store.exec('CREATE TABLE nested (id INTEGER PRIMARY KEY, val TEXT)');

    store.transaction(() => {
      store.run('INSERT INTO nested (val) VALUES (?)', ['outer']);
      // Query within transaction should see uncommitted data
      const rows = store.query('SELECT * FROM nested');
      assert(rows.length === 1, 'Should see uncommitted row');
      store.run('INSERT INTO nested (val) VALUES (?)', ['inner']);
    });

    const rows = store.query('SELECT * FROM nested');
    assert(rows.length === 2, 'Both rows should be committed');
    store.close();
  });

  total++;
  passed += test('transaction() returns function result', () => {
    const dbPath = path.join(TEST_DIR, 'test-tx-return.db');
    const store = new SQLiteStore(dbPath);
    store.open();
    store.exec('CREATE TABLE ret_test (id INTEGER PRIMARY KEY)');

    const result = store.transaction(() => {
      store.run('INSERT INTO ret_test DEFAULT VALUES');
      return { inserted: true, count: 1 };
    });

    assert(result.inserted === true, 'Should return result.inserted');
    assert(result.count === 1, 'Should return result.count');
    store.close();
  });

  return { passed, total };
}

// =============================================================================
// INTROSPECTION TESTS
// =============================================================================

function testIntrospection() {
  console.log('\n🔍 Testing: Introspection');
  let passed = 0;
  let total = 0;

  const dbPath = path.join(TEST_DIR, 'test-introspect.db');
  const store = new SQLiteStore(dbPath);
  store.open();

  store.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL,
      stock INTEGER DEFAULT 0
    )
  `);
  store.run('INSERT INTO products (name, price, stock) VALUES (?, ?, ?)', ['Widget', 9.99, 100]);
  store.run('INSERT INTO products (name, price, stock) VALUES (?, ?, ?)', ['Gadget', 19.99, 50]);

  total++;
  passed += test('tableExists() returns true for existing table', () => {
    assert(store.tableExists('products') === true, 'products should exist');
  });

  total++;
  passed += test('tableExists() returns false for non-existent table', () => {
    assert(store.tableExists('nonexistent') === false, 'nonexistent should not exist');
  });

  total++;
  passed += test('getTableInfo() returns column information', () => {
    const info = store.getTableInfo('products');
    assert(Array.isArray(info), 'Should return array');
    assert(info.length === 4, 'Should have 4 columns');

    const idCol = info.find(c => c.name === 'id');
    assert(idCol, 'Should have id column');
    assert(idCol.pk === 1, 'id should be primary key');

    const nameCol = info.find(c => c.name === 'name');
    assert(nameCol, 'Should have name column');
    assert(nameCol.notnull === 1, 'name should be NOT NULL');

    const stockCol = info.find(c => c.name === 'stock');
    assert(stockCol, 'Should have stock column');
    assert(stockCol.dflt_value === '0', 'stock should have default 0');
  });

  total++;
  passed += test('getTableInfo() returns empty array for non-existent table', () => {
    const info = store.getTableInfo('nonexistent');
    assert(Array.isArray(info), 'Should return array');
    assert(info.length === 0, 'Should be empty');
  });

  total++;
  passed += test('getRowCount() returns total row count', () => {
    const count = store.getRowCount('products');
    assert(count === 2, 'Should have 2 rows');
  });

  total++;
  passed += test('getRowCount() with WHERE clause', () => {
    const count = store.getRowCount('products', 'price > ?', [10]);
    assert(count === 1, 'Should have 1 row with price > 10');
  });

  total++;
  passed += test('getRowCount() with named params in WHERE', () => {
    const count = store.getRowCount('products', 'stock >= :min', { min: 50 });
    assert(count === 2, 'Should have 2 rows with stock >= 50');
  });

  total++;
  passed += test('getRowCount() returns 0 for empty table', () => {
    store.exec('CREATE TABLE empty_table (id INTEGER)');
    const count = store.getRowCount('empty_table');
    assert(count === 0, 'Should have 0 rows');
  });

  total++;
  passed += test('getTables() returns list of tables', () => {
    const tables = store.getTables();
    assert(Array.isArray(tables), 'Should return array');
    assert(tables.includes('products'), 'Should include products');
    assert(tables.includes('empty_table'), 'Should include empty_table');
    assert(!tables.some(t => t.startsWith('sqlite_')), 'Should exclude sqlite_ tables');
  });

  total++;
  passed += test('getFileSize() returns database size', () => {
    const size = store.getFileSize();
    assert(typeof size === 'number', 'Should return number');
    assert(size > 0, 'Size should be > 0 for non-empty database');
  });

  store.close();
  return { passed, total };
}

// =============================================================================
// PREPARED STATEMENT CACHING TESTS
// =============================================================================

function testPreparedStatements() {
  console.log('\n📋 Testing: Prepared Statement Caching');
  let passed = 0;
  let total = 0;

  const dbPath = path.join(TEST_DIR, 'test-prepared.db');
  const store = new SQLiteStore(dbPath);
  store.open();

  store.exec('CREATE TABLE cache_test (id INTEGER PRIMARY KEY, val TEXT)');

  total++;
  passed += test('repeated queries use cached statements', () => {
    // Run same query multiple times
    for (let i = 0; i < 10; i++) {
      store.run('INSERT INTO cache_test (val) VALUES (?)', [`value-${i}`]);
    }

    // All should work efficiently (no assertion, just no crash)
    const rows = store.query('SELECT * FROM cache_test');
    assert(rows.length === 10, 'Should have 10 rows');
  });

  total++;
  passed += test('getCacheStats() returns cache statistics', () => {
    const stats = store.getCacheStats();
    assert(typeof stats === 'object', 'Should return object');
    assert(typeof stats.size === 'number', 'Should have size');
    assert(stats.size > 0, 'Cache should have entries');
  });

  total++;
  passed += test('clearCache() clears statement cache', () => {
    store.clearCache();
    const stats = store.getCacheStats();
    assert(stats.size === 0, 'Cache should be empty');

    // Queries should still work after clearing cache
    const rows = store.query('SELECT * FROM cache_test');
    assert(rows.length === 10, 'Queries should still work');
  });

  store.close();
  return { passed, total };
}

// =============================================================================
// EDGE CASES AND ERROR HANDLING TESTS
// =============================================================================

function testEdgeCases() {
  console.log('\n⚠️  Testing: Edge Cases and Error Handling');
  let passed = 0;
  let total = 0;

  total++;
  passed += test('handles NULL values correctly', () => {
    const dbPath = path.join(TEST_DIR, 'test-null.db');
    const store = new SQLiteStore(dbPath);
    store.open();
    store.exec('CREATE TABLE null_test (id INTEGER, val TEXT)');

    store.run('INSERT INTO null_test (id, val) VALUES (?, ?)', [1, null]);
    const row = store.queryOne('SELECT * FROM null_test WHERE id = 1');
    assert(row.val === null, 'Should preserve NULL values');
    store.close();
  });

  total++;
  passed += test('handles special characters in strings', () => {
    const dbPath = path.join(TEST_DIR, 'test-special.db');
    const store = new SQLiteStore(dbPath);
    store.open();
    store.exec('CREATE TABLE special_test (val TEXT)');

    const special = "Test with 'quotes', \"double quotes\", and emoji 🎉";
    store.run('INSERT INTO special_test (val) VALUES (?)', [special]);
    const row = store.queryOne('SELECT * FROM special_test');
    assert(row.val === special, 'Should preserve special characters');
    store.close();
  });

  total++;
  passed += test('handles large text values', () => {
    const dbPath = path.join(TEST_DIR, 'test-large.db');
    const store = new SQLiteStore(dbPath);
    store.open();
    store.exec('CREATE TABLE large_test (val TEXT)');

    const largeText = 'x'.repeat(100000); // 100KB
    store.run('INSERT INTO large_test (val) VALUES (?)', [largeText]);
    const row = store.queryOne('SELECT * FROM large_test');
    assert(row.val.length === 100000, 'Should preserve large values');
    store.close();
  });

  total++;
  passed += test('throws on invalid SQL', () => {
    const dbPath = path.join(TEST_DIR, 'test-invalid.db');
    const store = new SQLiteStore(dbPath);
    store.open();

    assert.throws(() => {
      store.exec('INVALID SQL STATEMENT');
    }, /syntax error|SQLITE_ERROR/i, 'Should throw on invalid SQL');
    store.close();
  });

  total++;
  passed += test('throws on constraint violation', () => {
    const dbPath = path.join(TEST_DIR, 'test-constraint.db');
    const store = new SQLiteStore(dbPath);
    store.open();
    store.exec('CREATE TABLE unique_test (val TEXT UNIQUE)');

    store.run('INSERT INTO unique_test (val) VALUES (?)', ['unique']);
    assert.throws(() => {
      store.run('INSERT INTO unique_test (val) VALUES (?)', ['unique']);
    }, /UNIQUE|constraint/i, 'Should throw on unique constraint violation');
    store.close();
  });

  total++;
  passed += test('handles binary/blob data', () => {
    const dbPath = path.join(TEST_DIR, 'test-blob.db');
    const store = new SQLiteStore(dbPath);
    store.open();
    store.exec('CREATE TABLE blob_test (data BLOB)');

    const buffer = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
    store.run('INSERT INTO blob_test (data) VALUES (?)', [buffer]);
    const row = store.queryOne('SELECT * FROM blob_test');
    assert(Buffer.isBuffer(row.data), 'Should return Buffer');
    assert(row.data.equals(buffer), 'Buffer content should match');
    store.close();
  });

  total++;
  passed += test('handles large INTEGER values', () => {
    const dbPath = path.join(TEST_DIR, 'test-bigint.db');
    const store = new SQLiteStore(dbPath);
    store.open();
    store.exec('CREATE TABLE bigint_test (val INTEGER)');

    // Use a large value within JavaScript's safe integer range
    // to verify the store handles large integers correctly
    const largeVal = Number.MAX_SAFE_INTEGER; // 9007199254740991
    store.run('INSERT INTO bigint_test (val) VALUES (?)', [largeVal]);
    const row = store.queryOne('SELECT * FROM bigint_test');
    assert(row.val === largeVal, 'Should handle large integer values');

    // Also test that BigInt input is accepted (though may lose precision
    // for values > MAX_SAFE_INTEGER when retrieved as Number)
    store.run('INSERT INTO bigint_test (val) VALUES (?)', [BigInt(12345)]);
    const row2 = store.queryOne('SELECT * FROM bigint_test WHERE val = ?', [12345]);
    assert(row2 !== null, 'Should accept BigInt input');

    store.close();
  });

  return { passed, total };
}

// =============================================================================
// REAL-WORLD SCENARIO TESTS
// =============================================================================

function testRealWorldScenarios() {
  console.log('\n🌍 Testing: Real-World Scenarios');
  let passed = 0;
  let total = 0;

  total++;
  passed += test('can read existing Warp SQLite database schema', () => {
    // Simulate the kind of operations needed for Warp adapter
    const dbPath = path.join(TEST_DIR, 'test-warp-sim.db');
    const store = new SQLiteStore(dbPath);
    store.open();

    // Create tables similar to Warp's schema
    store.exec(`
      CREATE TABLE ai_queries (
        id INTEGER PRIMARY KEY,
        input TEXT,
        output TEXT,
        model TEXT,
        created_at TEXT
      )
    `);

    store.exec(`
      CREATE TABLE ai_agent_conversations (
        id INTEGER PRIMARY KEY,
        session_id TEXT,
        messages TEXT,
        created_at TEXT
      )
    `);

    // Insert test data
    store.run(
      'INSERT INTO ai_queries (input, output, model, created_at) VALUES (?, ?, ?, ?)',
      ['{"query": "How to fix bug?"}', '{"response": "Check logs"}', 'gpt-4', '2024-01-01']
    );

    // Verify we can query it
    assert(store.tableExists('ai_queries'), 'ai_queries should exist');
    assert(store.tableExists('ai_agent_conversations'), 'ai_agent_conversations should exist');

    const count = store.getRowCount('ai_queries');
    assert(count === 1, 'Should have 1 query');

    const row = store.queryOne('SELECT * FROM ai_queries');
    assert(row.model === 'gpt-4', 'Should retrieve data correctly');

    store.close();
  });

  total++;
  passed += test('can perform bulk insert with transaction', () => {
    const dbPath = path.join(TEST_DIR, 'test-bulk.db');
    const store = new SQLiteStore(dbPath);
    store.open();
    store.exec('CREATE TABLE bulk (id INTEGER PRIMARY KEY, val TEXT)');

    const items = Array.from({ length: 1000 }, (_, i) => `item-${i}`);

    const startTime = Date.now();
    store.transaction(() => {
      for (const item of items) {
        store.run('INSERT INTO bulk (val) VALUES (?)', [item]);
      }
    });
    const elapsed = Date.now() - startTime;

    const count = store.getRowCount('bulk');
    assert(count === 1000, 'Should have 1000 rows');
    assert(elapsed < 5000, `Bulk insert should be fast (was ${elapsed}ms)`);

    store.close();
  });

  total++;
  passed += test('can handle concurrent read operations', () => {
    const dbPath = path.join(TEST_DIR, 'test-concurrent.db');
    const store = new SQLiteStore(dbPath);
    store.open();
    store.exec('CREATE TABLE concurrent (id INTEGER PRIMARY KEY, val TEXT)');

    // Insert some data
    for (let i = 0; i < 100; i++) {
      store.run('INSERT INTO concurrent (val) VALUES (?)', [`value-${i}`]);
    }

    // Perform many concurrent reads
    const results = [];
    for (let i = 0; i < 50; i++) {
      results.push(store.query('SELECT * FROM concurrent WHERE id > ?', [i * 2]));
    }

    assert(results.every(r => Array.isArray(r)), 'All queries should return arrays');
    store.close();
  });

  return { passed, total };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   SQLiteStore Tests                    ║');
  console.log('╚════════════════════════════════════════╝');

  setup();

  let totalPassed = 0;
  let totalTests = 0;

  try {
    const results = [
      testConstructor(),
      testConnectionManagement(),
      testQueryMethods(),
      testWriteMethods(),
      testTransactions(),
      testIntrospection(),
      testPreparedStatements(),
      testEdgeCases(),
      testRealWorldScenarios(),
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
