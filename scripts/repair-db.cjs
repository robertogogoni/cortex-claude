#!/usr/bin/env node
/**
 * Cortex - Database Repair Script
 *
 * Comprehensive database maintenance and repair utility:
 * - Schema integrity checking
 * - Migration validation and repair
 * - FTS5 index rebuild
 * - Orphan detection and cleanup
 * - Database vacuum/optimization
 * - Backup and restore
 *
 * Usage:
 *   node scripts/repair-db.cjs               # Run all checks
 *   node scripts/repair-db.cjs --check       # Check only (no changes)
 *   node scripts/repair-db.cjs --fix         # Fix issues
 *   node scripts/repair-db.cjs --rebuild-fts # Rebuild FTS index
 *   node scripts/repair-db.cjs --vacuum      # Vacuum database
 *   node scripts/repair-db.cjs --migrate     # Run pending migrations
 *   node scripts/repair-db.cjs --backup      # Create backup
 *
 * @version 1.0.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// =============================================================================
// CONFIGURATION
// =============================================================================

const BASE_PATH = path.resolve(__dirname, '..');
const DATA_PATH = path.join(BASE_PATH, 'data');
const DB_PATH = path.join(DATA_PATH, 'memories.db');
const BACKUP_DIR = path.join(DATA_PATH, 'backups');
const VECTOR_PATH = path.join(DATA_PATH, 'vector');

// =============================================================================
// ARGUMENT PARSING
// =============================================================================

const args = process.argv.slice(2);
const checkOnly = args.includes('--check') || args.includes('-c');
const fix = args.includes('--fix') || args.includes('-f');
const rebuildFts = args.includes('--rebuild-fts');
const vacuum = args.includes('--vacuum');
const migrate = args.includes('--migrate') || args.includes('-m');
const backup = args.includes('--backup') || args.includes('-b');
const verbose = args.includes('--verbose') || args.includes('-v');
const help = args.includes('--help') || args.includes('-h');

if (help) {
  console.log(`
Cortex Database Repair Script

Checks and repairs the SQLite memory database.

Usage:
  node scripts/repair-db.cjs [options]

Options:
  --check, -c       Check only (no changes)
  --fix, -f         Fix detected issues
  --rebuild-fts     Rebuild FTS5 full-text index
  --vacuum          Vacuum database (reclaim space)
  --migrate, -m     Run pending migrations
  --backup, -b      Create backup before changes
  --verbose, -v     Show detailed output
  --help, -h        Show this help

Examples:
  # Check database health
  node scripts/repair-db.cjs --check

  # Fix issues with backup
  node scripts/repair-db.cjs --fix --backup

  # Rebuild FTS after manual edits
  node scripts/repair-db.cjs --rebuild-fts

  # Full maintenance
  node scripts/repair-db.cjs --fix --rebuild-fts --vacuum --backup
`);
  process.exit(0);
}

// =============================================================================
// ISSUE TRACKING
// =============================================================================

const issues = [];

function addIssue(category, severity, description, fixable = true) {
  issues.push({ category, severity, description, fixable });
  const icon = severity === 'error' ? '❌' : severity === 'warning' ? '⚠️' : 'ℹ️';
  console.log(`  ${icon} [${category}] ${description}`);
}

function logOk(message) {
  console.log(`  ✓ ${message}`);
}

function log(message) {
  if (verbose) {
    console.log(`    ${message}`);
  }
}

// =============================================================================
// CHECK FUNCTIONS
// =============================================================================

/**
 * Check if database file exists and is accessible
 */
function checkDatabaseExists() {
  console.log('\n1. Checking database file...');

  if (!fs.existsSync(DB_PATH)) {
    addIssue('file', 'error', 'Database file does not exist', true);
    return false;
  }

  const stats = fs.statSync(DB_PATH);
  if (stats.size === 0) {
    addIssue('file', 'error', 'Database file is empty (0 bytes)', true);
    return false;
  }

  logOk(`Database exists (${(stats.size / 1024).toFixed(1)} KB)`);
  return true;
}

/**
 * Check SQLite integrity
 */
function checkIntegrity(db) {
  console.log('\n2. Checking SQLite integrity...');

  try {
    const result = db.pragma('integrity_check');

    if (result.length === 1 && result[0].integrity_check === 'ok') {
      logOk('Database integrity OK');
      return true;
    }

    for (const row of result) {
      addIssue('integrity', 'error', row.integrity_check, false);
    }
    return false;
  } catch (error) {
    addIssue('integrity', 'error', `Integrity check failed: ${error.message}`, false);
    return false;
  }
}

/**
 * Check schema and migrations
 */
function checkSchema(db) {
  console.log('\n3. Checking schema and migrations...');

  const { getMigrationStatus, runMigrations, MIGRATIONS } = require('../core/migrations.cjs');

  // Check if memories table exists
  const tablesResult = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all();

  const tables = tablesResult.map(r => r.name);
  log(`Tables found: ${tables.join(', ')}`);

  if (!tables.includes('memories')) {
    addIssue('schema', 'error', 'memories table is missing', true);
  } else {
    logOk('memories table exists');
  }

  if (!tables.includes('memories_fts')) {
    addIssue('schema', 'warning', 'FTS5 virtual table is missing', true);
  } else {
    logOk('FTS5 index exists');
  }

  // Check migration status
  const status = getMigrationStatus(DB_PATH);

  if (!status.isUpToDate) {
    addIssue('schema', 'warning',
      `${status.pendingCount} pending migration(s) (current: v${status.currentVersion}, latest: v${status.latestVersion})`,
      true
    );
  } else {
    logOk(`Schema up to date (v${status.currentVersion})`);
  }

  // Check required columns
  const requiredColumns = [
    'id', 'content', 'summary', 'memory_type', 'intent', 'tags',
    'source', 'embedding', 'status', 'created_at', 'updated_at'
  ];

  if (tables.includes('memories')) {
    const columns = db.prepare('PRAGMA table_info(memories)').all();
    const columnNames = columns.map(c => c.name);

    for (const col of requiredColumns) {
      if (!columnNames.includes(col)) {
        addIssue('schema', 'error', `Missing required column: ${col}`, true);
      }
    }

    log(`Columns: ${columnNames.join(', ')}`);
  }

  // Check indexes
  const indexes = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memories'"
  ).all();

  log(`Indexes: ${indexes.map(i => i.name).join(', ')}`);

  if (indexes.length < 4) {
    addIssue('schema', 'warning', 'Some indexes may be missing', true);
  }

  // Check triggers
  const triggers = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='memories'"
  ).all();

  log(`Triggers: ${triggers.map(t => t.name).join(', ')}`);

  const expectedTriggers = ['memories_ai', 'memories_ad', 'memories_au'];
  for (const trigger of expectedTriggers) {
    if (!triggers.some(t => t.name === trigger)) {
      addIssue('schema', 'warning', `Missing FTS trigger: ${trigger}`, true);
    }
  }

  return true;
}

/**
 * Check data consistency
 */
function checkDataConsistency(db) {
  console.log('\n4. Checking data consistency...');

  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='memories'").get()) {
    log('Skipping - memories table does not exist');
    return true;
  }

  // Count records
  const totalCount = db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
  logOk(`Total memories: ${totalCount}`);

  if (totalCount === 0) {
    addIssue('data', 'info', 'Database is empty (no memories stored)', false);
    return true;
  }

  // Count by status
  const byStatus = db.prepare(
    'SELECT status, COUNT(*) as count FROM memories GROUP BY status'
  ).all();

  for (const row of byStatus) {
    log(`  ${row.status}: ${row.count}`);
  }

  // Check for null content
  const nullContent = db.prepare(
    "SELECT COUNT(*) as count FROM memories WHERE content IS NULL OR content = ''"
  ).get().count;

  if (nullContent > 0) {
    addIssue('data', 'error', `${nullContent} memories have empty content`, true);
  }

  // Check for null source
  const nullSource = db.prepare(
    "SELECT COUNT(*) as count FROM memories WHERE source IS NULL OR source = ''"
  ).get().count;

  if (nullSource > 0) {
    addIssue('data', 'warning', `${nullSource} memories have empty source`, true);
  }

  // Check embedding coverage
  const withEmbedding = db.prepare(
    'SELECT COUNT(*) as count FROM memories WHERE embedding IS NOT NULL'
  ).get().count;

  const coverage = totalCount > 0 ? (withEmbedding / totalCount * 100).toFixed(1) : 0;
  logOk(`Embedding coverage: ${withEmbedding}/${totalCount} (${coverage}%)`);

  if (withEmbedding < totalCount) {
    addIssue('data', 'info',
      `${totalCount - withEmbedding} memories missing embeddings`,
      false
    );
  }

  // Check FTS sync
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='memories_fts'").get()) {
    const ftsCount = db.prepare('SELECT COUNT(*) as count FROM memories_fts').get().count;

    if (ftsCount !== totalCount) {
      addIssue('data', 'warning',
        `FTS index out of sync (${ftsCount} vs ${totalCount} records)`,
        true
      );
    } else {
      logOk('FTS index in sync');
    }
  }

  return true;
}

/**
 * Check vector index
 */
function checkVectorIndex() {
  console.log('\n5. Checking vector index...');

  const indexPath = path.join(VECTOR_PATH, 'index.bin');
  const mappingPath = path.join(VECTOR_PATH, 'mapping.json');

  if (!fs.existsSync(VECTOR_PATH)) {
    addIssue('vector', 'warning', 'Vector directory does not exist', true);
    return false;
  }

  if (!fs.existsSync(indexPath)) {
    addIssue('vector', 'info', 'Vector index not yet created', false);
    return true;
  }

  const indexStats = fs.statSync(indexPath);
  logOk(`Vector index exists (${(indexStats.size / 1024).toFixed(1)} KB)`);

  if (!fs.existsSync(mappingPath)) {
    addIssue('vector', 'error', 'Vector mapping file missing', false);
    return false;
  }

  try {
    const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    const vectorCount = Object.keys(mapping.idToPosition || {}).length;
    logOk(`Vector index contains ${vectorCount} vectors`);

    // Check for deleted positions
    const deletedCount = (mapping.deletedPositions || []).length;
    if (deletedCount > vectorCount * 0.3) {
      addIssue('vector', 'warning',
        `High fragmentation: ${deletedCount} deleted positions`,
        true
      );
    }
  } catch (error) {
    addIssue('vector', 'error', `Failed to read mapping: ${error.message}`, false);
  }

  return true;
}

/**
 * Check WAL status
 */
function checkWalStatus(db) {
  console.log('\n6. Checking WAL status...');

  const journalMode = db.pragma('journal_mode')[0].journal_mode;
  logOk(`Journal mode: ${journalMode}`);

  if (journalMode === 'wal') {
    const walPath = DB_PATH + '-wal';
    const shmPath = DB_PATH + '-shm';

    if (fs.existsSync(walPath)) {
      const walSize = fs.statSync(walPath).size;
      log(`WAL file size: ${(walSize / 1024).toFixed(1)} KB`);

      if (walSize > 10 * 1024 * 1024) { // 10MB
        addIssue('wal', 'warning', 'WAL file is large, consider checkpointing', true);
      }
    }
  }

  return true;
}

// =============================================================================
// FIX FUNCTIONS
// =============================================================================

/**
 * Create database backup
 */
function createBackup() {
  console.log('\n📦 Creating backup...');

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `memories-${timestamp}.db`);

  if (fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, backupPath);
    console.log(`  ✓ Backup created: ${path.basename(backupPath)}`);

    // Also backup vector index if exists
    const indexPath = path.join(VECTOR_PATH, 'index.bin');
    const mappingPath = path.join(VECTOR_PATH, 'mapping.json');

    if (fs.existsSync(indexPath)) {
      fs.copyFileSync(indexPath, path.join(BACKUP_DIR, `index-${timestamp}.bin`));
    }
    if (fs.existsSync(mappingPath)) {
      fs.copyFileSync(mappingPath, path.join(BACKUP_DIR, `mapping-${timestamp}.json`));
    }

    return backupPath;
  }

  console.log('  ⚠️ Nothing to backup');
  return null;
}

/**
 * Run pending migrations
 */
function applyMigrations() {
  console.log('\n🔧 Running migrations...');

  const { runMigrations } = require('../core/migrations.cjs');
  const result = runMigrations(DB_PATH, { verbose: true });

  if (result.success) {
    console.log(`  ✓ Applied ${result.applied} migration(s)`);
  } else {
    console.log(`  ❌ Migration failed: ${result.message}`);
  }

  return result.success;
}

/**
 * Rebuild FTS5 index
 */
function rebuildFtsIndex(db) {
  console.log('\n🔧 Rebuilding FTS5 index...');

  try {
    // Check if FTS table exists
    const ftsExists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE name='memories_fts'"
    ).get();

    if (!ftsExists) {
      console.log('  Creating FTS5 table...');
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
            content,
            summary,
            tags,
            content='memories',
            content_rowid='rowid'
        )
      `);
    }

    // Rebuild index
    console.log('  Rebuilding index...');
    db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')");

    // Optimize
    console.log('  Optimizing index...');
    db.exec("INSERT INTO memories_fts(memories_fts) VALUES('optimize')");

    const count = db.prepare('SELECT COUNT(*) as count FROM memories_fts').get().count;
    console.log(`  ✓ FTS index rebuilt with ${count} documents`);

    return true;
  } catch (error) {
    console.log(`  ❌ FTS rebuild failed: ${error.message}`);
    return false;
  }
}

/**
 * Vacuum database
 */
function vacuumDatabase(db) {
  console.log('\n🔧 Vacuuming database...');

  try {
    // Checkpoint WAL first
    db.pragma('wal_checkpoint(TRUNCATE)');
    console.log('  Checkpointed WAL');

    // Get size before
    const sizeBefore = fs.statSync(DB_PATH).size;

    // Close and reopen without WAL for vacuum
    db.close();

    const vacuumDb = new Database(DB_PATH);
    vacuumDb.exec('VACUUM');
    vacuumDb.pragma('journal_mode = WAL');
    vacuumDb.close();

    // Get size after
    const sizeAfter = fs.statSync(DB_PATH).size;
    const saved = sizeBefore - sizeAfter;

    console.log(`  ✓ Vacuumed (saved ${(saved / 1024).toFixed(1)} KB)`);

    return true;
  } catch (error) {
    console.log(`  ❌ Vacuum failed: ${error.message}`);
    return false;
  }
}

/**
 * Fix null/empty source values
 */
function fixEmptySources(db) {
  console.log('  Fixing empty sources...');

  const result = db.prepare(`
    UPDATE memories
    SET source = 'unknown'
    WHERE source IS NULL OR source = ''
  `).run();

  if (result.changes > 0) {
    console.log(`    Fixed ${result.changes} records`);
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  Cortex Database Repair Tool');
  console.log('='.repeat(60));

  if (checkOnly) {
    console.log('\n  MODE: Check only (no changes)');
  } else if (fix) {
    console.log('\n  MODE: Fix issues');
  }

  // Create backup if requested
  if (backup && !checkOnly) {
    createBackup();
  }

  // Check if database exists
  if (!checkDatabaseExists()) {
    if (checkOnly) {
      console.log('\nDatabase does not exist. Run with --fix to create.');
      process.exit(1);
    }

    if (fix || migrate) {
      console.log('\n🔧 Creating database...');
      applyMigrations();
    }
  }

  // Open database for checks
  let db;
  try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  } catch (error) {
    console.log(`\n❌ Failed to open database: ${error.message}`);
    process.exit(1);
  }

  try {
    // Run all checks
    checkIntegrity(db);
    checkSchema(db);
    checkDataConsistency(db);
    checkVectorIndex();
    checkWalStatus(db);

    // Apply fixes if requested
    if (!checkOnly) {
      if (migrate) {
        db.close();
        applyMigrations();
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
      }

      if (fix) {
        // Fix data issues
        if (issues.some(i => i.category === 'data' && i.fixable)) {
          console.log('\n🔧 Fixing data issues...');
          fixEmptySources(db);
        }

        // Rebuild FTS if needed
        if (issues.some(i => i.category === 'data' && i.description.includes('FTS'))) {
          rebuildFtsIndex(db);
        }
      }

      if (rebuildFts) {
        rebuildFtsIndex(db);
      }

      if (vacuum) {
        vacuumDatabase(db);
        // Reopen after vacuum
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('  Summary');
    console.log('='.repeat(60));

    const errors = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    const infos = issues.filter(i => i.severity === 'info').length;

    console.log(`\n  Issues found: ${issues.length}`);
    if (errors > 0) console.log(`    ❌ Errors: ${errors}`);
    if (warnings > 0) console.log(`    ⚠️ Warnings: ${warnings}`);
    if (infos > 0) console.log(`    ℹ️ Info: ${infos}`);

    if (issues.length === 0) {
      console.log('\n  ✅ Database is healthy!');
    } else if (checkOnly) {
      console.log('\n  Run with --fix to repair issues');
    }

    // Show database stats
    const stats = {
      memories: db.prepare('SELECT COUNT(*) as c FROM memories').get()?.c || 0,
      withEmbeddings: db.prepare(
        'SELECT COUNT(*) as c FROM memories WHERE embedding IS NOT NULL'
      ).get()?.c || 0,
      dbSize: (fs.statSync(DB_PATH).size / 1024).toFixed(1),
    };

    console.log('\n  Database Stats:');
    console.log(`    Memories: ${stats.memories}`);
    console.log(`    With embeddings: ${stats.withEmbeddings}`);
    console.log(`    Database size: ${stats.dbSize} KB`);

    console.log('');

    process.exit(errors > 0 ? 1 : 0);

  } finally {
    if (db) {
      db.close();
    }
  }
}

main().catch(err => {
  console.error('\n❌ Repair failed:', err.message);
  process.exit(1);
});
