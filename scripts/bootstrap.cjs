#!/usr/bin/env node
/**
 * Cortex - Claude's Cognitive Layer - Bootstrap Script
 *
 * Initializes the Cortex system:
 * 1. Creates required directory structure
 * 2. Initializes empty JSONL storage files
 * 3. Tests connectivity to MCP servers
 * 4. Seeds initial data from CLAUDE.md files (optional)
 * 5. Reports system status
 *
 * Usage:
 *   node bootstrap.cjs                    # Run with defaults
 *   node bootstrap.cjs --seed             # Include CLAUDE.md seeding
 *   node bootstrap.cjs --test-mcp         # Test MCP server connectivity
 *   node bootstrap.cjs --verbose          # Verbose output
 *
 * @version 1.1.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { expandPath } = require('../core/types.cjs');

// =============================================================================
// CONFIGURATION
// =============================================================================

const BASE_PATH = expandPath('~/.claude/memory');

const REQUIRED_DIRECTORIES = [
  'data/memories',
  'data/skills',
  'data/projects',
  'data/cache',
  'logs',
  'adapters',
  'hooks',
  'core',
  'scripts',
  'tests',
];

const REQUIRED_FILES = [
  {
    path: 'data/memories/working.jsonl',
    description: 'Working memory (recent, high-priority)',
    initial: '',
  },
  {
    path: 'data/memories/short-term.jsonl',
    description: 'Short-term memory (7-day window)',
    initial: '',
  },
  {
    path: 'data/memories/long-term.jsonl',
    description: 'Long-term memory (permanent)',
    initial: '',
  },
  {
    path: 'data/skills/index.jsonl',
    description: 'Skill memory (extracted procedures)',
    initial: '',
  },
  {
    path: 'data/cache/query-cache.json',
    description: 'Query result cache',
    initial: '{}',
  },
  {
    path: 'logs/cmo.log',
    description: 'Cortex operation log',
    initial: '',
  },
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Parse command line arguments
 * @returns {Object}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    seed: args.includes('--seed') || args.includes('-s'),
    testMcp: args.includes('--test-mcp') || args.includes('-t'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    help: args.includes('--help') || args.includes('-h'),
    force: args.includes('--force') || args.includes('-f'),
  };
}

/**
 * Print usage information
 */
function printUsage() {
  console.log(`
Cortex - Claude's Cognitive Layer - Bootstrap Script

Usage:
  node bootstrap.cjs [options]

Options:
  --seed, -s       Seed initial data from CLAUDE.md files
  --test-mcp, -t   Test MCP server connectivity
  --verbose, -v    Show verbose output
  --force, -f      Force recreation of existing files
  --help, -h       Show this help message

Examples:
  node bootstrap.cjs                  # Basic initialization
  node bootstrap.cjs --seed           # Initialize with CLAUDE.md data
  node bootstrap.cjs --test-mcp -v    # Test MCP and show verbose output
`);
}

/**
 * Log with optional verbosity
 */
function log(message, verbose = false, forceShow = false) {
  if (forceShow || verbose) {
    console.log(message);
  }
}

/**
 * Print colored status
 */
function printStatus(label, status, details = '') {
  const colors = {
    ok: '\x1b[32m✓\x1b[0m',
    error: '\x1b[31m✗\x1b[0m',
    warn: '\x1b[33m⚠\x1b[0m',
    info: '\x1b[36mℹ\x1b[0m',
    skip: '\x1b[90m○\x1b[0m',
  };

  const icon = colors[status] || colors.info;
  const detailStr = details ? ` ${details}` : '';
  console.log(`  ${icon} ${label}${detailStr}`);
}

// =============================================================================
// BOOTSTRAP FUNCTIONS
// =============================================================================

/**
 * Create required directories
 * @param {Object} options
 * @returns {Object} Result with created/existing counts
 */
function createDirectories(options) {
  const result = { created: 0, existing: 0, errors: [] };

  log('\n📁 Creating directory structure...', options.verbose, true);

  for (const dir of REQUIRED_DIRECTORIES) {
    const fullPath = path.join(BASE_PATH, dir);
    try {
      if (fs.existsSync(fullPath)) {
        result.existing++;
        printStatus(dir, 'skip', '(exists)');
      } else {
        fs.mkdirSync(fullPath, { recursive: true });
        result.created++;
        printStatus(dir, 'ok', '(created)');
      }
    } catch (error) {
      result.errors.push({ dir, error: error.message });
      printStatus(dir, 'error', `(${error.message})`);
    }
  }

  return result;
}

/**
 * Create required files
 * @param {Object} options
 * @returns {Object} Result with created/existing counts
 */
function createFiles(options) {
  const result = { created: 0, existing: 0, errors: [] };

  log('\n📄 Creating storage files...', options.verbose, true);

  for (const file of REQUIRED_FILES) {
    const fullPath = path.join(BASE_PATH, file.path);
    try {
      const exists = fs.existsSync(fullPath);

      if (exists && !options.force) {
        result.existing++;
        printStatus(file.path, 'skip', `(exists) - ${file.description}`);
      } else {
        // Ensure parent directory exists
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, file.initial, 'utf-8');
        result.created++;
        printStatus(file.path, 'ok', `(${exists ? 'reset' : 'created'}) - ${file.description}`);
      }
    } catch (error) {
      result.errors.push({ file: file.path, error: error.message });
      printStatus(file.path, 'error', `(${error.message})`);
    }
  }

  return result;
}

/**
 * Test MCP server connectivity
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function testMcpConnectivity(options) {
  log('\n🔌 Testing MCP server connectivity...', options.verbose, true);

  const result = {
    episodicMemory: { available: false, error: null },
    knowledgeGraph: { available: false, error: null },
  };

  // Note: In a real implementation, this would actually call the MCP tools
  // For bootstrap, we just check if the adapters can be loaded

  try {
    const { EpisodicMemoryAdapter } = require('../adapters/episodic-memory-adapter.cjs');
    const adapter = new EpisodicMemoryAdapter({
      mcpCaller: async () => { throw new Error('No MCP caller available during bootstrap'); },
    });
    result.episodicMemory.available = true;
    printStatus('Episodic Memory Adapter', 'ok', '(module loaded)');
    printStatus('  → MCP Tool', 'warn', '(requires Claude Code context to test)');
  } catch (error) {
    result.episodicMemory.error = error.message;
    printStatus('Episodic Memory Adapter', 'error', `(${error.message})`);
  }

  try {
    const { KnowledgeGraphAdapter } = require('../adapters/knowledge-graph-adapter.cjs');
    const adapter = new KnowledgeGraphAdapter({
      mcpCaller: async () => { throw new Error('No MCP caller available during bootstrap'); },
    });
    result.knowledgeGraph.available = true;
    printStatus('Knowledge Graph Adapter', 'ok', '(module loaded)');
    printStatus('  → MCP Tool', 'warn', '(requires Claude Code context to test)');
  } catch (error) {
    result.knowledgeGraph.error = error.message;
    printStatus('Knowledge Graph Adapter', 'error', `(${error.message})`);
  }

  return result;
}

/**
 * Seed initial data from CLAUDE.md files
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function seedFromClaudeMd(options) {
  log('\n📖 Seeding from CLAUDE.md files...', options.verbose, true);

  const result = { parsed: 0, records: 0, errors: [] };

  try {
    const { ClaudeMdAdapter } = require('../adapters/claudemd-adapter.cjs');
    const adapter = new ClaudeMdAdapter({
      paths: [
        '~/.claude/CLAUDE.md',
        '~/claude-cross-machine-sync/CLAUDE.md',
        '.claude/CLAUDE.md',
        './CLAUDE.md',
      ],
    });

    // Query with empty context to get all records
    const records = await adapter.query({});

    if (records.length > 0) {
      result.parsed++;
      result.records = records.length;

      // Write to long-term memory as seed
      const longTermPath = path.join(BASE_PATH, 'data/memories/long-term.jsonl');
      const existing = fs.existsSync(longTermPath)
        ? fs.readFileSync(longTermPath, 'utf-8').split('\n').filter(l => l.trim()).length
        : 0;

      if (existing === 0 || options.force) {
        const lines = records.map(r => JSON.stringify(r));
        fs.writeFileSync(longTermPath, lines.join('\n') + '\n', 'utf-8');
        printStatus('CLAUDE.md parsing', 'ok', `(${records.length} records extracted)`);
        printStatus('Long-term memory seed', 'ok', `(${records.length} records written)`);
      } else {
        printStatus('CLAUDE.md parsing', 'ok', `(${records.length} records found)`);
        printStatus('Long-term memory seed', 'skip', `(${existing} existing records, use --force to override)`);
      }
    } else {
      printStatus('CLAUDE.md parsing', 'warn', '(no records extracted)');
    }
  } catch (error) {
    result.errors.push(error.message);
    printStatus('CLAUDE.md parsing', 'error', `(${error.message})`);
  }

  return result;
}

/**
 * Print system status summary
 * @param {Object} results
 */
function printSummary(results) {
  console.log('\n' + '═'.repeat(60));
  console.log('📊 BOOTSTRAP SUMMARY');
  console.log('═'.repeat(60));

  // Directories
  console.log(`\n📁 Directories: ${results.dirs.created} created, ${results.dirs.existing} existing`);
  if (results.dirs.errors.length > 0) {
    console.log(`   ⚠ ${results.dirs.errors.length} errors`);
  }

  // Files
  console.log(`📄 Files: ${results.files.created} created, ${results.files.existing} existing`);
  if (results.files.errors.length > 0) {
    console.log(`   ⚠ ${results.files.errors.length} errors`);
  }

  // MCP
  if (results.mcp) {
    const mcpStatus = results.mcp.episodicMemory.available && results.mcp.knowledgeGraph.available
      ? 'adapters loaded (test in Claude Code)'
      : 'some adapters failed';
    console.log(`🔌 MCP: ${mcpStatus}`);
  }

  // Seed
  if (results.seed) {
    console.log(`📖 Seed: ${results.seed.records} records from CLAUDE.md`);
  }

  // Overall status
  const hasErrors = results.dirs.errors.length > 0 || results.files.errors.length > 0;
  console.log('\n' + '─'.repeat(60));

  if (hasErrors) {
    console.log('⚠️  Bootstrap completed with warnings');
  } else {
    console.log('✅ Bootstrap completed successfully!');
  }

  console.log(`\n💡 Next steps:
   1. Verify MCP servers are configured in ~/.claude.json
   2. Run: node ~/.claude/memory/scripts/status.cjs
   3. Start a Claude Code session to test memory injection
`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const options = parseArgs();

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  console.log('═'.repeat(60));
  console.log('🚀 CLAUDE MEMORY ORCHESTRATOR - BOOTSTRAP');
  console.log('═'.repeat(60));
  console.log(`   Base Path: ${BASE_PATH}`);
  console.log(`   Options: seed=${options.seed}, testMcp=${options.testMcp}, force=${options.force}`);

  const results = {
    dirs: null,
    files: null,
    mcp: null,
    seed: null,
  };

  // Step 1: Create directories
  results.dirs = createDirectories(options);

  // Step 2: Create files
  results.files = createFiles(options);

  // Step 3: Test MCP connectivity (if requested)
  if (options.testMcp) {
    results.mcp = await testMcpConnectivity(options);
  }

  // Step 4: Seed from CLAUDE.md (if requested)
  if (options.seed) {
    results.seed = await seedFromClaudeMd(options);
  }

  // Print summary
  printSummary(results);
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ Bootstrap failed:', error.message);
    process.exit(1);
  });
}

// Export for testing
module.exports = {
  createDirectories,
  createFiles,
  testMcpConnectivity,
  seedFromClaudeMd,
  REQUIRED_DIRECTORIES,
  REQUIRED_FILES,
};
