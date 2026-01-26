#!/usr/bin/env node
/**
 * Cortex Command Line Interface (v1.1.0)
 *
 * Usage:
 *   cmo status       - Show Cortex status including adapters
 *   cmo search       - Search memories across all sources
 *   cmo bootstrap    - Initialize Cortex with optional seeding
 *   cmo install      - Install hooks
 *   cmo uninstall    - Uninstall hooks
 *   cmo test         - Run tests
 *
 * @version 1.1.0
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const args = process.argv.slice(2);
const command = args[0];
const subArgs = args.slice(1);

const CORTEX_DIR = path.dirname(__dirname);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function printHeader(title) {
  console.log('═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

// =============================================================================
// COMMANDS
// =============================================================================

const commands = {
  status: () => {
    require('./status.cjs');
  },

  install: () => {
    require('./install-hooks.cjs');
  },

  uninstall: () => {
    require('./uninstall-hooks.cjs');
  },

  bootstrap: () => {
    const bootstrapArgs = subArgs.join(' ');
    const script = path.join(CORTEX_DIR, 'scripts', 'bootstrap.cjs');
    try {
      execSync(`node "${script}" ${bootstrapArgs}`, { stdio: 'inherit' });
    } catch (e) {
      process.exit(1);
    }
  },

  search: async () => {
    const query = subArgs.join(' ').trim();

    if (!query) {
      console.log(`
Usage: cmo search <query> [options]

Search memories across all sources (JSONL, CLAUDE.md, Episodic Memory, Knowledge Graph).

Options:
  --type <type>     Filter by memory type (learning, pattern, preference, skill, correction)
  --source <src>    Filter by source (jsonl, claudemd, episodic-memory, knowledge-graph)
  --limit <n>       Maximum results (default: 20)
  --format <fmt>    Output format (table, json, plain) (default: table)

Examples:
  cmo search "git error"                    # Search all sources
  cmo search "docker" --type pattern        # Find docker patterns
  cmo search "fix" --source claudemd        # Search only CLAUDE.md
  cmo search "sync" --format json           # Output as JSON
`);
      return;
    }

    printHeader('🔍 Memory Search');
    console.log(`   Query: "${query}"`);
    console.log();

    try {
      const { QueryOrchestrator } = require('../hooks/query-orchestrator.cjs');

      // Parse options
      const typeIdx = subArgs.indexOf('--type');
      const sourceIdx = subArgs.indexOf('--source');
      const limitIdx = subArgs.indexOf('--limit');
      const formatIdx = subArgs.indexOf('--format');

      const type = typeIdx >= 0 ? subArgs[typeIdx + 1] : null;
      const source = sourceIdx >= 0 ? subArgs[sourceIdx + 1] : null;
      const limit = limitIdx >= 0 ? parseInt(subArgs[limitIdx + 1], 10) : 20;
      const format = formatIdx >= 0 ? subArgs[formatIdx + 1] : 'table';

      // Build query without option flags
      const cleanQuery = subArgs
        .filter((arg, i) => {
          if (arg.startsWith('--')) return false;
          const prev = subArgs[i - 1];
          if (prev && prev.startsWith('--')) return false;
          return true;
        })
        .join(' ')
        .trim();

      // Create orchestrator (without MCP caller - only local sources work in CLI)
      const orchestrator = new QueryOrchestrator({
        basePath: CORTEX_DIR,
        tokenBudget: { total: 10000, perSource: 5000, perMemory: 1000 },
      });

      // Disable MCP-based adapters for CLI (they require Claude Code context)
      orchestrator.setAdapterEnabled('episodic-memory', false);
      orchestrator.setAdapterEnabled('knowledge-graph', false);

      console.log('📡 Searching local sources (JSONL, CLAUDE.md)...');
      console.log('   ⚠️ Note: MCP sources require Claude Code context');
      console.log();

      // Execute query
      const result = await orchestrator.query({
        prompt: cleanQuery,
        types: type ? [type] : null,
        adapters: source ? [source] : null,
        limit,
      });

      // Format output
      if (format === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else if (format === 'plain') {
        for (const memory of result.memories) {
          console.log(`[${memory.type}] ${memory.summary || memory.content}`);
        }
      } else {
        // Table format
        console.log(`Found ${result.stats.totalSelected} relevant memories (from ${result.stats.totalQueried} queried)`);
        console.log();

        if (result.memories.length === 0) {
          console.log('   No matching memories found.');
          console.log('   Try a different query or run: cmo bootstrap --seed');
        } else {
          // Group by type
          const byType = {};
          for (const memory of result.memories) {
            const t = memory.type || 'general';
            if (!byType[t]) byType[t] = [];
            byType[t].push(memory);
          }

          for (const [type, memories] of Object.entries(byType)) {
            console.log(`┌─ ${type.toUpperCase()} (${memories.length}) ─────────────────────────────────`);
            for (const memory of memories.slice(0, 5)) {
              const source = memory._source || 'unknown';
              const content = (memory.summary || memory.content || '').slice(0, 80);
              const relevance = memory.relevanceScore
                ? ` [${(memory.relevanceScore * 100).toFixed(0)}%]`
                : '';
              console.log(`│ ${relevance} ${content}...`);
              console.log(`│   └─ from: ${source}`);
            }
            if (memories.length > 5) {
              console.log(`│   ... and ${memories.length - 5} more`);
            }
            console.log('└' + '─'.repeat(50));
            console.log();
          }
        }

        // Stats
        console.log('📊 Statistics:');
        console.log(`   Sources queried: ${Object.keys(result.stats.bySource).join(', ') || 'none'}`);
        console.log(`   Estimated tokens: ${result.stats.estimatedTokens}`);
      }
    } catch (error) {
      console.error(`❌ Search failed: ${error.message}`);
      if (error.stack) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  },

  test: () => {
    console.log('Running Cortex tests...\n');
    try {
      execSync(`node ${path.join(CORTEX_DIR, 'tests', 'test-core.cjs')}`, { stdio: 'inherit' });
      execSync(`node ${path.join(CORTEX_DIR, 'tests', 'test-hooks.cjs')}`, { stdio: 'inherit' });
      execSync(`node ${path.join(CORTEX_DIR, 'tests', 'test-lads.cjs')}`, { stdio: 'inherit' });
    } catch (e) {
      process.exit(1);
    }
  },

  adapters: () => {
    printHeader('🔌 Memory Adapters');

    try {
      const { createDefaultRegistry } = require('../adapters/index.cjs');
      const registry = createDefaultRegistry({ basePath: CORTEX_DIR });
      const adapters = registry.getAll();

      console.log();
      for (const adapter of adapters) {
        const status = adapter.enabled ? '✅ Enabled' : '⏸️ Disabled';
        console.log(`┌─ ${adapter.name} ─────────────────────────────────`);
        console.log(`│  Status: ${status}`);
        console.log(`│  Priority: ${(adapter.priority * 100).toFixed(0)}%`);
        console.log(`│  Timeout: ${adapter.timeout}ms`);
        console.log('└' + '─'.repeat(45));
        console.log();
      }
    } catch (error) {
      console.error(`❌ Failed to load adapters: ${error.message}`);
      process.exit(1);
    }
  },

  help: () => {
    console.log(`
Cortex - Claude's Cognitive Layer (Cortex) CLI v1.1.0

Usage:
  cmo <command> [options]

Commands:
  status        Show Cortex installation and configuration status
  search        Search memories across all local sources
  adapters      Show configured memory adapters
  bootstrap     Initialize Cortex (--seed to populate from CLAUDE.md)
  install       Register Cortex hooks in Claude Code settings
  uninstall     Remove Cortex hooks from Claude Code settings
  test          Run all tests
  help          Show this help message

Examples:
  cmo status                      # Check installation status
  cmo search "git error"          # Search for git-related memories
  cmo search "fix" --type pattern # Search patterns about fixes
  cmo bootstrap --seed            # Initialize with CLAUDE.md data
  cmo adapters                    # List memory adapters

Memory Sources (v1.1.0):
  • JSONL Local      - Working, short-term, long-term, skills
  • CLAUDE.md        - User-curated knowledge files
  • Episodic Memory  - Archived conversations (requires Claude Code)
  • Knowledge Graph  - Structured entities (requires Claude Code)
`);
  },
};

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  if (!command || !commands[command]) {
    commands.help();
    process.exit(command ? 1 : 0);
  } else {
    const result = commands[command]();
    if (result instanceof Promise) {
      await result;
    }
  }
}

main().catch(error => {
  console.error(`❌ Error: ${error.message}`);
  process.exit(1);
});
