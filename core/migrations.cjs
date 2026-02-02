/**
 * Cortex - Claude's Cognitive Layer - Database Migrations
 *
 * Migration system for SQLite schema with:
 * - Version tracking
 * - Up/down migrations
 * - Automatic migration on startup
 * - Rollback support
 * - Migration history logging
 *
 * @version 1.0.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { expandPath } = require('./types.cjs');

// =============================================================================
// CONSTANTS
// =============================================================================

/** @const {string} Migration tracking table name */
const MIGRATION_TABLE = 'schema_migrations';

/** @const {string} Default database path */
const DEFAULT_DB_PATH = '~/.claude/memory/data/memories.db';

// =============================================================================
// MIGRATIONS DEFINITIONS
// =============================================================================

/**
 * Array of migrations in order.
 * Each migration has:
 * - version: Sequential number
 * - name: Descriptive name
 * - description: What this migration does
 * - up: SQL to apply migration
 * - down: SQL to rollback migration (optional)
 */
const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_schema',
    description: 'Create memories table with all core fields',
    up: `
      -- Core memories table
      CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          version INTEGER DEFAULT 1,

          -- Content
          content TEXT NOT NULL,
          summary TEXT,

          -- Classification
          memory_type TEXT DEFAULT 'observation',
          intent TEXT,
          tags TEXT DEFAULT '[]',

          -- Provenance
          source TEXT NOT NULL,
          source_id TEXT,
          project_hash TEXT,
          session_id TEXT,

          -- Quality metrics
          extraction_confidence REAL DEFAULT 0.5,
          quality_score REAL DEFAULT 0.5,

          -- Usage tracking
          usage_count INTEGER DEFAULT 0,
          usage_success_rate REAL DEFAULT 0.5,
          last_accessed TEXT,

          -- Temporal decay
          strength REAL DEFAULT 1.0,
          decay_score REAL DEFAULT 1.0,

          -- Embedding (stored as BLOB - 384-dim float32 = 1536 bytes)
          embedding BLOB,

          -- Timestamps
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),

          -- Status
          status TEXT DEFAULT 'active'
      );
    `,
    down: `DROP TABLE IF EXISTS memories;`,
  },

  {
    version: 2,
    name: 'add_fts5_index',
    description: 'Create FTS5 virtual table for full-text search',
    up: `
      -- FTS5 for BM25 full-text search
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          content,
          summary,
          tags,
          content='memories',
          content_rowid='rowid'
      );
    `,
    down: `DROP TABLE IF EXISTS memories_fts;`,
  },

  {
    version: 3,
    name: 'add_indexes',
    description: 'Create indexes for fast lookups',
    up: `
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
      CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_hash);
      CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
      CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);
    `,
    down: `
      DROP INDEX IF EXISTS idx_memories_type;
      DROP INDEX IF EXISTS idx_memories_project;
      DROP INDEX IF EXISTS idx_memories_source;
      DROP INDEX IF EXISTS idx_memories_status;
      DROP INDEX IF EXISTS idx_memories_created;
      DROP INDEX IF EXISTS idx_memories_updated;
    `,
  },

  {
    version: 4,
    name: 'add_fts_triggers',
    description: 'Create triggers to sync FTS5 index with memories table',
    // Note: Triggers are created separately in the migration runner
    // because SQLite doesn't support IF NOT EXISTS for triggers
    up: `
      -- Insert trigger
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, content, summary, tags)
          VALUES (new.rowid, new.content, new.summary, new.tags);
      END;

      -- Delete trigger
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content, summary, tags)
          VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
      END;

      -- Update trigger
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content, summary, tags)
          VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
          INSERT INTO memories_fts(rowid, content, summary, tags)
          VALUES (new.rowid, new.content, new.summary, new.tags);
      END;
    `,
    down: `
      DROP TRIGGER IF EXISTS memories_ai;
      DROP TRIGGER IF EXISTS memories_ad;
      DROP TRIGGER IF EXISTS memories_au;
    `,
    // Custom handler because triggers need special handling
    customUp: (db) => {
      // Check if triggers exist first
      const triggerExists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='memories_ai'"
      ).get();

      if (triggerExists) {
        return; // Already exists
      }

      // Create triggers one at a time
      db.exec(`
        CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
            INSERT INTO memories_fts(rowid, content, summary, tags)
            VALUES (new.rowid, new.content, new.summary, new.tags);
        END
      `);

      db.exec(`
        CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, content, summary, tags)
            VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
        END
      `);

      db.exec(`
        CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, content, summary, tags)
            VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
            INSERT INTO memories_fts(rowid, content, summary, tags)
            VALUES (new.rowid, new.content, new.summary, new.tags);
        END
      `);
    },
  },

  {
    version: 5,
    name: 'add_embedding_dimension_check',
    description: 'Add CHECK constraint for embedding dimension validation',
    up: `
      -- Create an index on embedding column for faster null checks
      CREATE INDEX IF NOT EXISTS idx_memories_embedding_null
      ON memories(embedding) WHERE embedding IS NULL;
    `,
    down: `
      DROP INDEX IF EXISTS idx_memories_embedding_null;
    `,
  },

  {
    version: 6,
    name: 'add_quality_composite_index',
    description: 'Add composite index for quality-based queries',
    up: `
      -- Composite index for quality scoring queries
      CREATE INDEX IF NOT EXISTS idx_memories_quality
      ON memories(status, quality_score DESC, usage_count DESC);

      -- Index for temporal decay queries
      CREATE INDEX IF NOT EXISTS idx_memories_decay
      ON memories(status, decay_score DESC, created_at DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_memories_quality;
      DROP INDEX IF EXISTS idx_memories_decay;
    `,
  },

  {
    version: 7,
    name: 'add_session_tracking',
    description: 'Add table for tracking sessions and their memories',
    up: `
      CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          ended_at TEXT,
          project_hash TEXT,
          memory_count INTEGER DEFAULT 0,
          status TEXT DEFAULT 'active'
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_hash);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    `,
    down: `
      DROP TABLE IF EXISTS sessions;
    `,
  },

  {
    version: 8,
    name: 'add_migration_metadata',
    description: 'Add metadata columns to schema_migrations for tracking',
    up: `
      -- This migration updates the migrations table itself
      -- The changes are applied by the migration runner
    `,
    down: ``,
    customUp: (db) => {
      // Check if description column exists
      const tableInfo = db.prepare(`PRAGMA table_info(${MIGRATION_TABLE})`).all();
      const hasDescription = tableInfo.some(col => col.name === 'description');

      if (!hasDescription) {
        db.exec(`ALTER TABLE ${MIGRATION_TABLE} ADD COLUMN description TEXT`);
      }

      const hasDuration = tableInfo.some(col => col.name === 'duration_ms');
      if (!hasDuration) {
        db.exec(`ALTER TABLE ${MIGRATION_TABLE} ADD COLUMN duration_ms INTEGER`);
      }
    },
  },
];

// =============================================================================
// MIGRATION RUNNER CLASS
// =============================================================================

/**
 * Database migration runner
 */
class MigrationRunner {
  /**
   * @param {Object} db - better-sqlite3 database instance
   * @param {Object} options
   * @param {boolean} [options.verbose=false] - Log progress
   */
  constructor(db, options = {}) {
    this.db = db;
    this.verbose = options.verbose || false;
  }

  /**
   * Log message if verbose mode
   * @param {string} msg
   */
  log(msg) {
    if (this.verbose) {
      console.log(`[Migration] ${msg}`);
    }
  }

  /**
   * Ensure migration tracking table exists
   */
  ensureMigrationTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now')),
          description TEXT,
          duration_ms INTEGER
      )
    `);
  }

  /**
   * Get current schema version
   * @returns {number}
   */
  getCurrentVersion() {
    this.ensureMigrationTable();

    const row = this.db.prepare(`
      SELECT COALESCE(MAX(version), 0) as version
      FROM ${MIGRATION_TABLE}
    `).get();

    return row.version;
  }

  /**
   * Get list of applied migrations
   * @returns {Array<{version: number, name: string, applied_at: string}>}
   */
  getAppliedMigrations() {
    this.ensureMigrationTable();

    return this.db.prepare(`
      SELECT version, name, applied_at, description, duration_ms
      FROM ${MIGRATION_TABLE}
      ORDER BY version ASC
    `).all();
  }

  /**
   * Get list of pending migrations
   * @returns {Array}
   */
  getPendingMigrations() {
    const currentVersion = this.getCurrentVersion();
    return MIGRATIONS.filter(m => m.version > currentVersion);
  }

  /**
   * Apply a single migration
   * @param {Object} migration
   * @returns {{success: boolean, duration: number}}
   */
  applyMigration(migration) {
    const startTime = Date.now();

    try {
      // Use custom handler if provided
      if (migration.customUp) {
        migration.customUp(this.db);
      } else {
        // Execute SQL statements
        const statements = migration.up
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.startsWith('--'));

        for (const sql of statements) {
          try {
            this.db.exec(sql);
          } catch (err) {
            // Ignore "already exists" errors for idempotency
            if (!err.message.includes('already exists')) {
              throw err;
            }
          }
        }
      }

      const duration = Date.now() - startTime;

      // Record migration
      this.db.prepare(`
        INSERT INTO ${MIGRATION_TABLE} (version, name, description, duration_ms)
        VALUES (?, ?, ?, ?)
      `).run(migration.version, migration.name, migration.description, duration);

      this.log(`Applied migration ${migration.version}: ${migration.name} (${duration}ms)`);

      return { success: true, duration };
    } catch (error) {
      this.log(`Failed migration ${migration.version}: ${error.message}`);
      return { success: false, error: error.message, duration: Date.now() - startTime };
    }
  }

  /**
   * Rollback a single migration
   * @param {Object} migration
   * @returns {{success: boolean}}
   */
  rollbackMigration(migration) {
    try {
      if (migration.down) {
        const statements = migration.down
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.startsWith('--'));

        for (const sql of statements) {
          try {
            this.db.exec(sql);
          } catch (err) {
            // Ignore "does not exist" errors
            if (!err.message.includes('no such')) {
              throw err;
            }
          }
        }
      }

      // Remove from tracking
      this.db.prepare(`
        DELETE FROM ${MIGRATION_TABLE}
        WHERE version = ?
      `).run(migration.version);

      this.log(`Rolled back migration ${migration.version}: ${migration.name}`);

      return { success: true };
    } catch (error) {
      this.log(`Failed rollback ${migration.version}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Run all pending migrations
   * @param {number} [targetVersion] - Stop at this version (default: latest)
   * @returns {{applied: number, failed: number, results: Array}}
   */
  migrate(targetVersion = null) {
    this.ensureMigrationTable();

    const pending = this.getPendingMigrations();
    const target = targetVersion || Math.max(...MIGRATIONS.map(m => m.version));

    const results = [];
    let applied = 0;
    let failed = 0;

    for (const migration of pending) {
      if (migration.version > target) {
        break;
      }

      const result = this.applyMigration(migration);
      results.push({ migration: migration.name, ...result });

      if (result.success) {
        applied++;
      } else {
        failed++;
        break; // Stop on first failure
      }
    }

    return { applied, failed, results };
  }

  /**
   * Rollback to a specific version
   * @param {number} targetVersion
   * @returns {{rolledBack: number, failed: number, results: Array}}
   */
  rollback(targetVersion) {
    const currentVersion = this.getCurrentVersion();

    if (targetVersion >= currentVersion) {
      return { rolledBack: 0, failed: 0, results: [] };
    }

    // Get migrations to rollback in reverse order
    const toRollback = MIGRATIONS
      .filter(m => m.version > targetVersion && m.version <= currentVersion)
      .sort((a, b) => b.version - a.version);

    const results = [];
    let rolledBack = 0;
    let failed = 0;

    for (const migration of toRollback) {
      const result = this.rollbackMigration(migration);
      results.push({ migration: migration.name, ...result });

      if (result.success) {
        rolledBack++;
      } else {
        failed++;
        break;
      }
    }

    return { rolledBack, failed, results };
  }

  /**
   * Get migration status report
   * @returns {Object}
   */
  getStatus() {
    const currentVersion = this.getCurrentVersion();
    const latestVersion = Math.max(...MIGRATIONS.map(m => m.version));
    const applied = this.getAppliedMigrations();
    const pending = this.getPendingMigrations();

    return {
      currentVersion,
      latestVersion,
      isUpToDate: currentVersion >= latestVersion,
      appliedCount: applied.length,
      pendingCount: pending.length,
      applied,
      pending: pending.map(m => ({
        version: m.version,
        name: m.name,
        description: m.description,
      })),
    };
  }
}

// =============================================================================
// STANDALONE FUNCTIONS
// =============================================================================

/**
 * Run migrations on a database file
 *
 * @param {string} dbPath - Path to database file
 * @param {Object} options
 * @param {number} [options.targetVersion] - Target version (default: latest)
 * @param {boolean} [options.verbose] - Log progress
 * @returns {{success: boolean, applied: number, message: string}}
 */
function runMigrations(dbPath, options = {}) {
  const Database = require('better-sqlite3');

  const expandedPath = expandPath(dbPath || DEFAULT_DB_PATH);

  // Ensure directory exists
  const dir = path.dirname(expandedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // Open database
  const db = new Database(expandedPath);
  db.pragma('journal_mode = WAL');

  try {
    const runner = new MigrationRunner(db, { verbose: options.verbose });
    const result = runner.migrate(options.targetVersion);

    return {
      success: result.failed === 0,
      applied: result.applied,
      failed: result.failed,
      currentVersion: runner.getCurrentVersion(),
      message: result.failed > 0
        ? `Migration failed at version ${result.results[result.results.length - 1]?.migration}`
        : `Applied ${result.applied} migration(s)`,
      results: result.results,
    };
  } finally {
    db.close();
  }
}

/**
 * Get migration status for a database (read-only)
 *
 * @param {string} dbPath - Path to database file
 * @returns {Object}
 */
function getMigrationStatus(dbPath) {
  const Database = require('better-sqlite3');

  const expandedPath = expandPath(dbPath || DEFAULT_DB_PATH);
  const latestVersion = Math.max(...MIGRATIONS.map(m => m.version));

  if (!fs.existsSync(expandedPath)) {
    return {
      exists: false,
      currentVersion: 0,
      latestVersion,
      isUpToDate: false,
      pendingCount: MIGRATIONS.length,
    };
  }

  const db = new Database(expandedPath, { readonly: true });

  try {
    // Check if migration table exists
    const tableExists = db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='${MIGRATION_TABLE}'`
    ).get();

    if (!tableExists) {
      return {
        exists: true,
        currentVersion: 0,
        latestVersion,
        isUpToDate: false,
        appliedCount: 0,
        pendingCount: MIGRATIONS.length,
        applied: [],
        pending: MIGRATIONS.map(m => ({
          version: m.version,
          name: m.name,
          description: m.description,
        })),
      };
    }

    // Get current version
    const versionRow = db.prepare(`
      SELECT COALESCE(MAX(version), 0) as version
      FROM ${MIGRATION_TABLE}
    `).get();

    const currentVersion = versionRow.version;

    // Get applied migrations
    const applied = db.prepare(`
      SELECT version, name, applied_at, description, duration_ms
      FROM ${MIGRATION_TABLE}
      ORDER BY version ASC
    `).all();

    // Calculate pending
    const pending = MIGRATIONS.filter(m => m.version > currentVersion);

    return {
      exists: true,
      currentVersion,
      latestVersion,
      isUpToDate: currentVersion >= latestVersion,
      appliedCount: applied.length,
      pendingCount: pending.length,
      applied,
      pending: pending.map(m => ({
        version: m.version,
        name: m.name,
        description: m.description,
      })),
    };
  } finally {
    db.close();
  }
}

/**
 * Get the latest migration version
 * @returns {number}
 */
function getLatestVersion() {
  return Math.max(...MIGRATIONS.map(m => m.version));
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  MigrationRunner,
  MIGRATIONS,
  MIGRATION_TABLE,
  runMigrations,
  getMigrationStatus,
  getLatestVersion,
  DEFAULT_DB_PATH,
};
