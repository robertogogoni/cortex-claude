#!/usr/bin/env node
/**
 * Cortex - JSONL to Vector Index Backfill Script
 *
 * Reads memories from JSONL files and populates:
 * 1. SQLite database (MemoryStore)
 * 2. HNSW vector index (VectorIndex)
 *
 * Usage:
 *   npm run backfill              # Run backfill
 *   npm run backfill:dry          # Preview without changes
 *   node scripts/backfill-vectors.cjs --force   # Regenerate all embeddings
 *   node scripts/backfill-vectors.cjs --dry-run # Preview mode
 *
 * @version 1.0.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// =============================================================================
// CONFIGURATION
// =============================================================================

const BASE_PATH = path.resolve(__dirname, '..');
const DATA_PATH = path.join(BASE_PATH, 'data');

/** JSONL files to process in order of priority */
const JSONL_FILES = [
  path.join(DATA_PATH, 'memories', 'working.jsonl'),
  path.join(DATA_PATH, 'memories', 'short-term.jsonl'),
  path.join(DATA_PATH, 'memories', 'long-term.jsonl'),
  path.join(DATA_PATH, 'memories', 'learnings.jsonl'),
  path.join(DATA_PATH, 'memories', 'insights.jsonl'),
];

/** Batch size for processing */
const BATCH_SIZE = 50;

/** Progress update frequency */
const PROGRESS_INTERVAL = 10;

// =============================================================================
// ARGUMENT PARSING
// =============================================================================

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-n');
const forceRegenerate = args.includes('--force') || args.includes('-f');
const verbose = args.includes('--verbose') || args.includes('-v');
const help = args.includes('--help') || args.includes('-h');

if (help) {
  console.log(`
Cortex Vector Backfill Script

Reads memories from JSONL files and populates the vector index with embeddings.

Usage:
  node scripts/backfill-vectors.cjs [options]
  npm run backfill
  npm run backfill:dry

Options:
  --dry-run, -n   Preview what would be done without making changes
  --force, -f     Regenerate all embeddings (even for existing records)
  --verbose, -v   Show detailed progress
  --help, -h      Show this help message

JSONL Files Processed:
  - data/memories/working.jsonl
  - data/memories/short-term.jsonl
  - data/memories/long-term.jsonl
  - data/memories/learnings.jsonl
  - data/memories/insights.jsonl
`);
  process.exit(0);
}

// =============================================================================
// STATS TRACKING
// =============================================================================

const stats = {
  totalFound: 0,
  processed: 0,
  skipped: 0,
  errors: 0,
  alreadyEmbedded: 0,
  newlyEmbedded: 0,
  insertedToSqlite: 0,
  addedToVector: 0,
  filesProcessed: 0,
  startTime: null,
  endTime: null,
};

// =============================================================================
// MAIN BACKFILL LOGIC
// =============================================================================

/**
 * Read JSONL file line by line and return array of parsed records
 * @param {string} filePath
 * @returns {Promise<Array<Object>>}
 */
async function readJsonlFile(filePath) {
  const records = [];

  if (!fs.existsSync(filePath)) {
    if (verbose) {
      console.log(`  [SKIP] File not found: ${path.basename(filePath)}`);
    }
    return records;
  }

  const fileStats = fs.statSync(filePath);
  if (fileStats.size === 0) {
    if (verbose) {
      console.log(`  [SKIP] File empty: ${path.basename(filePath)}`);
    }
    return records;
  }

  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let lineNumber = 0;

    rl.on('line', (line) => {
      lineNumber++;
      const trimmed = line.trim();
      if (!trimmed) return; // Skip empty lines

      try {
        const record = JSON.parse(trimmed);
        records.push(record);
      } catch (err) {
        if (verbose) {
          console.error(`  [WARN] Parse error at line ${lineNumber}: ${err.message}`);
        }
        stats.errors++;
      }
    });

    rl.on('close', () => resolve(records));
    rl.on('error', (err) => reject(err));
  });
}

/**
 * Determine memory source based on file path
 * @param {string} filePath
 * @returns {string}
 */
function getSourceFromFile(filePath) {
  const basename = path.basename(filePath, '.jsonl');
  const sourceMap = {
    'working': 'jsonl',
    'short-term': 'jsonl',
    'long-term': 'jsonl',
    'learnings': 'jsonl',
    'insights': 'jsonl',
  };
  return sourceMap[basename] || 'jsonl';
}

/**
 * Convert JSONL record to MemoryStore format
 * @param {Object} record
 * @param {string} source
 * @returns {Object}
 */
function normalizeRecord(record, source) {
  return {
    id: record.id,
    content: record.content || '',
    summary: record.summary || (record.content || '').slice(0, 100),
    memory_type: record.type || record.memory_type || 'observation',
    intent: record.intent || 'general',
    tags: Array.isArray(record.tags) ? record.tags : [],
    source: source,
    source_id: record.sourceSessionId || record.source_id || null,
    project_hash: record.projectHash || record.project_hash || null,
    session_id: record.sourceSessionId || record.session_id || null,
    extraction_confidence: record.extractionConfidence || record.extraction_confidence || 0.5,
    quality_score: record.quality_score || 0.5,
  };
}

/**
 * Main backfill function
 */
async function runBackfill() {
  stats.startTime = Date.now();

  console.log('');
  console.log('='.repeat(60));
  console.log('  Cortex Vector Backfill');
  console.log('='.repeat(60));
  console.log('');

  if (dryRun) {
    console.log('  MODE: Dry run (no changes will be made)');
  } else if (forceRegenerate) {
    console.log('  MODE: Force regenerate all embeddings');
  } else {
    console.log('  MODE: Incremental (skip existing)');
  }
  console.log('');

  // Lazy-load heavy modules only when needed
  let VectorSearchProvider, Embedder, MemoryStore, VectorIndex;

  if (!dryRun) {
    console.log('Loading modules...');
    const vspModule = require('../core/vector-search-provider.cjs');
    VectorSearchProvider = vspModule.VectorSearchProvider;

    const embedderModule = require('../core/embedder.cjs');
    Embedder = embedderModule.Embedder;

    const memoryStoreModule = require('../core/memory-store.cjs');
    MemoryStore = memoryStoreModule.MemoryStore;

    const vectorIndexModule = require('../core/vector-index.cjs');
    VectorIndex = vectorIndexModule.VectorIndex;
    console.log('Modules loaded.');
    console.log('');
  }

  // Phase 1: Scan JSONL files
  console.log('Phase 1: Scanning JSONL files');
  console.log('-'.repeat(40));

  const allRecords = [];

  for (const filePath of JSONL_FILES) {
    const fileName = path.basename(filePath);
    process.stdout.write(`  Reading ${fileName}... `);

    const records = await readJsonlFile(filePath);
    const source = getSourceFromFile(filePath);

    for (const record of records) {
      allRecords.push({
        record: normalizeRecord(record, source),
        sourceFile: fileName,
      });
    }

    if (records.length > 0) {
      console.log(`${records.length} records`);
      stats.filesProcessed++;
    } else {
      console.log('empty');
    }
  }

  stats.totalFound = allRecords.length;
  console.log('');
  console.log(`  Total records found: ${stats.totalFound}`);
  console.log('');

  if (stats.totalFound === 0) {
    console.log('No records to process. Exiting.');
    return;
  }

  // Dry run: show what would be done and exit
  if (dryRun) {
    console.log('Phase 2: Preview (dry run)');
    console.log('-'.repeat(40));

    const byType = {};
    const bySource = {};

    for (const { record, sourceFile } of allRecords) {
      const type = record.memory_type || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
      bySource[sourceFile] = (bySource[sourceFile] || 0) + 1;
    }

    console.log('');
    console.log('  Records by type:');
    for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${type}: ${count}`);
    }

    console.log('');
    console.log('  Records by source file:');
    for (const [file, count] of Object.entries(bySource)) {
      console.log(`    ${file}: ${count}`);
    }

    console.log('');
    console.log('  Would process:');
    console.log(`    - Insert ${stats.totalFound} records into SQLite`);
    console.log(`    - Generate ${stats.totalFound} embeddings`);
    console.log(`    - Add ${stats.totalFound} vectors to HNSW index`);
    console.log('');
    console.log('Run without --dry-run to execute backfill.');
    return;
  }

  // Phase 2: Initialize components
  console.log('Phase 2: Initializing components');
  console.log('-'.repeat(40));

  const memoryStore = new MemoryStore({
    dbPath: path.join(DATA_PATH, 'memories.db'),
  });

  const vectorIndex = new VectorIndex({
    indexPath: path.join(DATA_PATH, 'vector', 'index.bin'),
    mappingPath: path.join(DATA_PATH, 'vector', 'mapping.json'),
  });

  const embedder = new Embedder({ verbose: true });

  process.stdout.write('  Initializing MemoryStore... ');
  await memoryStore.initialize();
  console.log('done');

  process.stdout.write('  Initializing VectorIndex... ');
  await vectorIndex.initialize();
  console.log('done');

  process.stdout.write('  Preloading embedding model... ');
  await embedder.preload();
  console.log('done');
  console.log('');

  // Get existing IDs if not forcing
  const existingIds = new Set();
  if (!forceRegenerate) {
    const existingRecords = memoryStore.query({ limit: 100000, status: 'active' });
    for (const rec of existingRecords) {
      existingIds.add(rec.id);
    }
    console.log(`  Found ${existingIds.size} existing records in SQLite`);
  }

  // Phase 3: Process records
  console.log('');
  console.log('Phase 3: Processing records');
  console.log('-'.repeat(40));
  console.log('');

  let batchCount = 0;

  for (let i = 0; i < allRecords.length; i++) {
    const { record, sourceFile } = allRecords[i];
    const recordId = record.id;

    // Skip if already exists and not forcing
    if (!forceRegenerate && existingIds.has(recordId)) {
      stats.skipped++;
      stats.alreadyEmbedded++;
      continue;
    }

    try {
      // Generate embedding
      const textToEmbed = record.summary || record.content;
      if (!textToEmbed || textToEmbed.trim().length === 0) {
        if (verbose) {
          console.log(`  [SKIP] Empty content for ${recordId}`);
        }
        stats.skipped++;
        continue;
      }

      const embedding = await embedder.embed(textToEmbed);

      // Insert/update in SQLite
      if (existingIds.has(recordId)) {
        // Update existing
        memoryStore.setEmbedding(recordId, embedding);
      } else {
        // Insert new
        await memoryStore.insert({
          ...record,
          embedding,
        });
        stats.insertedToSqlite++;
      }

      // Add to vector index
      vectorIndex.add(recordId, embedding);
      stats.addedToVector++;
      stats.newlyEmbedded++;
      stats.processed++;

      // Progress update
      if ((stats.processed % PROGRESS_INTERVAL) === 0) {
        const pct = Math.round((i / allRecords.length) * 100);
        process.stdout.write(`\r  Progress: ${stats.processed}/${stats.totalFound} (${pct}%) - ${sourceFile}`);
      }

    } catch (err) {
      stats.errors++;
      if (verbose) {
        console.error(`\n  [ERROR] ${recordId}: ${err.message}`);
      }
    }
  }

  // Clear progress line
  process.stdout.write('\r' + ' '.repeat(80) + '\r');

  // Phase 4: Save indices
  console.log('');
  console.log('Phase 4: Saving indices');
  console.log('-'.repeat(40));

  process.stdout.write('  Saving VectorIndex... ');
  await vectorIndex.save();
  console.log('done');

  process.stdout.write('  Closing MemoryStore... ');
  memoryStore.close();
  console.log('done');

  stats.endTime = Date.now();

  // Final report
  console.log('');
  console.log('='.repeat(60));
  console.log('  Backfill Complete');
  console.log('='.repeat(60));
  console.log('');
  console.log('  Summary:');
  console.log(`    Total records found:    ${stats.totalFound}`);
  console.log(`    Records processed:      ${stats.processed}`);
  console.log(`    Already embedded:       ${stats.alreadyEmbedded}`);
  console.log(`    Newly embedded:         ${stats.newlyEmbedded}`);
  console.log(`    Inserted to SQLite:     ${stats.insertedToSqlite}`);
  console.log(`    Added to vector index:  ${stats.addedToVector}`);
  console.log(`    Skipped:                ${stats.skipped}`);
  console.log(`    Errors:                 ${stats.errors}`);
  console.log(`    Files processed:        ${stats.filesProcessed}`);
  console.log(`    Time elapsed:           ${((stats.endTime - stats.startTime) / 1000).toFixed(2)}s`);
  console.log('');

  // Verification step
  console.log('  Verification:');

  const vectorStats = vectorIndex.getStats();
  console.log(`    Vector index count:     ${vectorStats.vectorCount}`);

  // Reopen MemoryStore for verification
  const verifyStore = new MemoryStore({
    dbPath: path.join(DATA_PATH, 'memories.db'),
  });
  await verifyStore.initialize();

  const coverage = verifyStore.getEmbeddingCoverage();
  console.log(`    SQLite total:           ${coverage.total}`);
  console.log(`    SQLite with embedding:  ${coverage.withEmbedding}`);
  console.log(`    Coverage:               ${(coverage.coverage * 100).toFixed(1)}%`);

  verifyStore.close();

  console.log('');
}

// =============================================================================
// ENTRY POINT
// =============================================================================

runBackfill().catch((err) => {
  console.error('');
  console.error('Backfill failed with error:');
  console.error(err);
  process.exit(1);
});
