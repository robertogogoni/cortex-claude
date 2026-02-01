/**
 * Cortex - Claude's Cognitive Layer - SQLite Store
 *
 * Reusable SQLite storage class analogous to JSONLStore, with:
 * - Connection management (open/close)
 * - Prepared statement caching for performance
 * - Transaction support with auto-commit/rollback
 * - Table introspection utilities
 * - WAL mode by default for better concurrency
 */

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { expandPath } = require('./types.cjs');

// =============================================================================
// SQLITE STORE
// =============================================================================

class SQLiteStore {
  /**
   * Create a new SQLiteStore instance.
   *
   * @param {string} filePath - Path to the SQLite database file
   * @param {Object} [options={}] - Configuration options
   * @param {boolean} [options.readonly=false] - Open database in readonly mode
   * @param {number} [options.timeout=5000] - Busy timeout in milliseconds
   * @param {boolean} [options.wal=true] - Enable WAL mode (default: true)
   */
  constructor(filePath, options = {}) {
    this.filePath = expandPath(filePath);
    this.options = {
      readonly: options.readonly || false,
      timeout: options.timeout || 5000,
      wal: options.wal !== false, // Default to true
    };

    /** @type {Database|null} */
    this.db = null;

    /** @type {Map<string, Statement>} */
    this.statementCache = new Map();

    // Statistics
    this.stats = {
      queries: 0,
      writes: 0,
      transactions: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  // ===========================================================================
  // CONNECTION MANAGEMENT
  // ===========================================================================

  /**
   * Open the database connection.
   * Creates the database file and parent directories if they don't exist.
   * Idempotent - safe to call multiple times.
   */
  open() {
    if (this.db) {
      return; // Already open
    }

    // Ensure parent directory exists
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    // Open database with better-sqlite3 options
    this.db = new Database(this.filePath, {
      readonly: this.options.readonly,
      timeout: this.options.timeout,
    });

    // Enable WAL mode for better concurrency (unless readonly)
    if (this.options.wal && !this.options.readonly) {
      this.db.pragma('journal_mode = WAL');
    }

    // Set busy timeout
    this.db.pragma(`busy_timeout = ${this.options.timeout}`);
  }

  /**
   * Close the database connection.
   * Clears the statement cache and releases all resources.
   * Idempotent - safe to call multiple times.
   */
  close() {
    if (!this.db) {
      return; // Already closed
    }

    // Clear cached statements
    this.clearCache();

    // Close the database
    this.db.close();
    this.db = null;
  }

  /**
   * Check if the database connection is open.
   * @returns {boolean}
   */
  isOpen() {
    return this.db !== null;
  }

  /**
   * Ensure database is open, throw if not.
   * @private
   */
  _ensureOpen() {
    if (!this.db) {
      throw new Error('Database is not open. Call open() first.');
    }
  }

  // ===========================================================================
  // QUERY METHODS
  // ===========================================================================

  /**
   * Execute SQL statements without returning results.
   * Use for DDL (CREATE, ALTER, DROP) or multiple statements.
   *
   * @param {string} sql - SQL statement(s) to execute
   */
  exec(sql) {
    this._ensureOpen();
    this.db.exec(sql);
    this.stats.queries++;
  }

  /**
   * Execute a query and return all matching rows.
   *
   * @param {string} sql - SQL query
   * @param {Array|Object} [params] - Positional (array) or named (object) parameters
   * @returns {Object[]} Array of row objects
   */
  query(sql, params) {
    this._ensureOpen();
    const stmt = this._getStatement(sql);
    this.stats.queries++;

    if (params) {
      return stmt.all(params);
    }
    return stmt.all();
  }

  /**
   * Execute a query and return a single row or null.
   *
   * @param {string} sql - SQL query
   * @param {Array|Object} [params] - Positional (array) or named (object) parameters
   * @returns {Object|null} Single row object or null if no match
   */
  queryOne(sql, params) {
    this._ensureOpen();
    const stmt = this._getStatement(sql);
    this.stats.queries++;

    if (params) {
      return stmt.get(params) || null;
    }
    return stmt.get() || null;
  }

  // ===========================================================================
  // WRITE METHODS
  // ===========================================================================

  /**
   * Execute an INSERT, UPDATE, or DELETE statement.
   *
   * @param {string} sql - SQL statement
   * @param {Array|Object} [params] - Positional (array) or named (object) parameters
   * @returns {{changes: number, lastInsertRowid: number|bigint}} Result info
   */
  run(sql, params) {
    this._ensureOpen();
    const stmt = this._getStatement(sql);
    this.stats.writes++;

    let result;
    if (params) {
      result = stmt.run(params);
    } else {
      result = stmt.run();
    }

    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  // ===========================================================================
  // TRANSACTIONS
  // ===========================================================================

  /**
   * Execute a function within a transaction.
   * Automatically commits on success, rolls back on error.
   *
   * @template T
   * @param {function(): T} fn - Function to execute within transaction
   * @returns {T} The return value of the function
   * @throws {Error} Re-throws any error from the function after rollback
   */
  transaction(fn) {
    this._ensureOpen();
    this.stats.transactions++;

    // Use better-sqlite3's transaction helper
    const wrappedFn = this.db.transaction(fn);
    return wrappedFn();
  }

  // ===========================================================================
  // INTROSPECTION
  // ===========================================================================

  /**
   * Check if a table exists in the database.
   *
   * @param {string} tableName - Name of the table
   * @returns {boolean}
   */
  tableExists(tableName) {
    this._ensureOpen();
    const row = this.queryOne(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
      [tableName]
    );
    return row !== null;
  }

  /**
   * Get column information for a table.
   *
   * @param {string} tableName - Name of the table
   * @returns {Object[]} Array of column info objects with:
   *   - cid: Column ID
   *   - name: Column name
   *   - type: Column type
   *   - notnull: 1 if NOT NULL, 0 otherwise
   *   - dflt_value: Default value or null
   *   - pk: 1 if primary key, 0 otherwise
   */
  getTableInfo(tableName) {
    this._ensureOpen();
    // PRAGMA table_info returns empty for non-existent tables
    return this.query(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`);
  }

  /**
   * Get the number of rows in a table, optionally filtered.
   *
   * @param {string} tableName - Name of the table
   * @param {string} [where] - Optional WHERE clause (without 'WHERE' keyword)
   * @param {Array|Object} [params] - Parameters for the WHERE clause
   * @returns {number} Row count
   */
  getRowCount(tableName, where, params) {
    this._ensureOpen();
    const escapedName = tableName.replace(/"/g, '""');
    let sql = `SELECT COUNT(*) as count FROM "${escapedName}"`;

    if (where) {
      sql += ` WHERE ${where}`;
    }

    const row = params ? this.queryOne(sql, params) : this.queryOne(sql);
    return row ? row.count : 0;
  }

  /**
   * Get a list of all tables in the database.
   *
   * @returns {string[]} Array of table names
   */
  getTables() {
    this._ensureOpen();
    const rows = this.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    return rows.map(r => r.name);
  }

  /**
   * Get database file size in bytes.
   *
   * @returns {number} File size in bytes, or 0 if file doesn't exist
   */
  getFileSize() {
    try {
      const stats = fs.statSync(this.filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  // ===========================================================================
  // PREPARED STATEMENT CACHING
  // ===========================================================================

  /**
   * Get a prepared statement, using cache if available.
   * @private
   * @param {string} sql - SQL statement
   * @returns {Statement}
   */
  _getStatement(sql) {
    let stmt = this.statementCache.get(sql);

    if (stmt) {
      this.stats.cacheHits++;
      return stmt;
    }

    this.stats.cacheMisses++;
    stmt = this.db.prepare(sql);
    this.statementCache.set(sql, stmt);
    return stmt;
  }

  /**
   * Get cache statistics.
   * @returns {{size: number, hits: number, misses: number}}
   */
  getCacheStats() {
    return {
      size: this.statementCache.size,
      hits: this.stats.cacheHits,
      misses: this.stats.cacheMisses,
    };
  }

  /**
   * Clear the prepared statement cache.
   */
  clearCache() {
    this.statementCache.clear();
    this.stats.cacheHits = 0;
    this.stats.cacheMisses = 0;
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  /**
   * Get overall store statistics.
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      isOpen: this.isOpen(),
      filePath: this.filePath,
      cacheSize: this.statementCache.size,
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  SQLiteStore,
};
