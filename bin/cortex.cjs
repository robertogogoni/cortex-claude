#!/usr/bin/env node
/**
 * Cortex Memory CLI - Command Line Interface for Cortex Memory System
 *
 * Usage:
 *   npx cortex-memory status       - Show Cortex status
 *   npx cortex-memory promote      - Run tier promotion
 *   npx cortex-memory consolidate  - Run memory consolidation
 *   npx cortex-memory search <q>   - Search memories
 *
 * @version 2.0.0
 */

'use strict';

const { Command } = require('commander');
const path = require('path');
const fs = require('fs');
const os = require('os');

// =============================================================================
// CONSTANTS
// =============================================================================

const CORTEX_DIR = path.dirname(__dirname);
const VERSION = require(path.join(CORTEX_DIR, 'package.json')).version;

// ANSI color codes (works in most terminals)
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

// Icons for visual feedback
const icons = {
  check: '\u2714',
  cross: '\u2718',
  warning: '\u26A0',
  info: '\u2139',
  arrow: '\u2192',
  brain: '\u{1F9E0}',
  search: '\u{1F50D}',
  gear: '\u2699',
  folder: '\u{1F4C1}',
  chart: '\u{1F4CA}',
  clock: '\u{1F551}',
  rocket: '\u{1F680}',
  sparkle: '\u2728',
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Color a string with ANSI codes
 */
function c(text, ...styles) {
  const codes = styles.map(s => colors[s] || '').join('');
  return `${codes}${text}${colors.reset}`;
}

/**
 * Print a header with visual styling
 */
function printHeader(title, icon = icons.brain) {
  console.log();
  console.log(c('=' .repeat(60), 'dim'));
  console.log(`  ${icon}  ${c(title, 'bold', 'cyan')}`);
  console.log(c('='.repeat(60), 'dim'));
  console.log();
}

/**
 * Print a section header
 */
function printSection(title, icon = '') {
  console.log(`${icon ? icon + ' ' : ''}${c(title, 'bold')}:`);
}

/**
 * Print a status line with icon
 */
function printStatus(label, value, success = true) {
  const icon = success ? c(icons.check, 'green') : c(icons.cross, 'red');
  console.log(`   ${icon} ${label}: ${value}`);
}

/**
 * Print a warning line
 */
function printWarning(message) {
  console.log(`   ${c(icons.warning, 'yellow')} ${c(message, 'yellow')}`);
}

/**
 * Print an info line
 */
function printInfo(message) {
  console.log(`   ${c(icons.info, 'blue')} ${message}`);
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format number with commas
 */
function formatNumber(num) {
  return num.toLocaleString();
}

/**
 * Show a progress spinner
 */
function createSpinner(message) {
  const frames = ['|', '/', '-', '\\'];
  let i = 0;
  let interval = null;

  return {
    start() {
      process.stdout.write(`   ${message} `);
      interval = setInterval(() => {
        process.stdout.write(`\r   ${message} ${c(frames[i++ % frames.length], 'cyan')}`);
      }, 100);
    },
    stop(finalMessage = 'done', success = true) {
      clearInterval(interval);
      const icon = success ? c(icons.check, 'green') : c(icons.cross, 'red');
      process.stdout.write(`\r   ${message} ${icon} ${finalMessage}\n`);
    },
    fail(message) {
      this.stop(message, false);
    },
  };
}

// =============================================================================
// STATUS COMMAND
// =============================================================================

async function statusCommand(options) {
  printHeader('Cortex Memory Status', icons.brain);

  const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');

  // Installation
  printSection('Installation', icons.folder);
  console.log(`   Location: ${c(CORTEX_DIR, 'cyan')}`);
  printStatus('Directory exists', fs.existsSync(CORTEX_DIR) ? 'Yes' : 'No', fs.existsSync(CORTEX_DIR));

  // Hooks
  console.log();
  printSection('Hooks', icons.gear);
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const sessionStart = settings.hooks?.SessionStart?.some(h =>
      h.hooks?.some(hh => hh.command?.includes('memory/hooks/session-start'))
    );
    const sessionEnd = settings.hooks?.SessionEnd?.some(h =>
      h.hooks?.some(hh => hh.command?.includes('memory/hooks/session-end'))
    );

    printStatus('SessionStart', sessionStart ? 'Registered' : 'Not registered', sessionStart);
    printStatus('SessionEnd', sessionEnd ? 'Registered' : 'Not registered', sessionEnd);
  } catch (e) {
    printWarning('Could not read settings.json');
  }

  // Memory Adapters
  console.log();
  printSection('Memory Adapters', icons.chart);
  try {
    const { createDefaultRegistry } = require(path.join(CORTEX_DIR, 'adapters', 'index.cjs'));
    const registry = createDefaultRegistry({ basePath: CORTEX_DIR });
    const adapters = registry.getAll();

    for (const adapter of adapters) {
      const status = adapter.enabled ? c('enabled', 'green') : c('disabled', 'yellow');
      const priority = (adapter.priority * 100).toFixed(0) + '%';
      console.log(`   ${adapter.enabled ? c(icons.check, 'green') : c('-', 'dim')} ${adapter.name} (${status}, priority: ${priority})`);
    }
  } catch (e) {
    printWarning(`Could not load adapters: ${e.message}`);
  }

  // Data Directories
  console.log();
  printSection('Data Directories', icons.folder);
  const dataDirs = [
    'data/memories',
    'data/skills',
    'data/projects',
    'data/cache',
    'logs',
  ];
  for (const dir of dataDirs) {
    const fullPath = path.join(CORTEX_DIR, dir);
    const exists = fs.existsSync(fullPath);
    printStatus(dir, exists ? 'exists' : 'missing', exists);
  }

  // Memory Statistics
  console.log();
  printSection('Memory Statistics', icons.chart);
  try {
    const memoriesDir = path.join(CORTEX_DIR, 'data', 'memories');
    let totalMemories = 0;
    let totalSize = 0;

    if (fs.existsSync(memoriesDir)) {
      const files = fs.readdirSync(memoriesDir).filter(f => f.endsWith('.jsonl'));
      for (const file of files) {
        const fullPath = path.join(memoriesDir, file);
        const stat = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.trim().split('\n').filter(l => l).length;
        totalMemories += lines;
        totalSize += stat.size;

        const icon = lines > 0 ? c(icons.check, 'green') : c('-', 'dim');
        console.log(`   ${icon} ${file}: ${c(formatNumber(lines), 'cyan')} memories (${formatBytes(stat.size)})`);
      }

      // Skills
      const skillsPath = path.join(CORTEX_DIR, 'data', 'skills', 'index.jsonl');
      if (fs.existsSync(skillsPath)) {
        const skillContent = fs.readFileSync(skillsPath, 'utf8');
        const skillLines = skillContent.trim().split('\n').filter(l => l).length;
        const skillStat = fs.statSync(skillsPath);
        totalMemories += skillLines;
        totalSize += skillStat.size;
        console.log(`   ${c(icons.check, 'green')} skills/index.jsonl: ${c(formatNumber(skillLines), 'cyan')} skills (${formatBytes(skillStat.size)})`);
      }

      console.log(c('   ' + '-'.repeat(40), 'dim'));
      console.log(`   ${icons.chart} Total: ${c(formatNumber(totalMemories), 'bold', 'cyan')} records (${formatBytes(totalSize)})`);

      if (totalMemories === 0) {
        printInfo('Tip: Run bootstrap --seed to populate from CLAUDE.md');
      }
    } else {
      printWarning('Memories directory not created yet');
      printInfo('Tip: Run bootstrap.cjs to initialize');
    }
  } catch (e) {
    printWarning(`Error reading memories: ${e.message}`);
  }

  // Overall Status
  console.log();
  console.log(c('='.repeat(60), 'dim'));
  const coreInstalled = fs.existsSync(CORTEX_DIR);
  const adaptersOk = fs.existsSync(path.join(CORTEX_DIR, 'adapters', 'index.cjs'));
  const hasMemories = fs.existsSync(path.join(CORTEX_DIR, 'data', 'memories'));

  if (coreInstalled && adaptersOk && hasMemories) {
    console.log(`${icons.rocket} ${c('Cortex v' + VERSION + ' is installed and ready!', 'green', 'bold')}`);
  } else if (coreInstalled) {
    console.log(`${icons.warning} ${c('Cortex is partially installed.', 'yellow')}`);
    if (!adaptersOk) printInfo('Run bootstrap to complete adapter setup');
    if (!hasMemories) printInfo('Run bootstrap --seed to initialize memories');
  } else {
    console.log(`${icons.cross} ${c('Cortex needs to be installed.', 'red')}`);
    printInfo('Run: node scripts/bootstrap.cjs --seed');
  }
  console.log();
}

// =============================================================================
// PROMOTE COMMAND - Tier Promotion
// =============================================================================

async function promoteCommand(options) {
  printHeader('Memory Tier Promotion', icons.rocket);

  const spinner = createSpinner('Loading memory stores...');
  spinner.start();

  try {
    const { JSONLStore } = require(path.join(CORTEX_DIR, 'core', 'storage.cjs'));
    const { getTimestamp } = require(path.join(CORTEX_DIR, 'core', 'types.cjs'));

    // Load stores
    const workingStore = new JSONLStore(path.join(CORTEX_DIR, 'data', 'memories', 'working.jsonl'));
    const shortTermStore = new JSONLStore(path.join(CORTEX_DIR, 'data', 'memories', 'short-term.jsonl'));
    const longTermStore = new JSONLStore(path.join(CORTEX_DIR, 'data', 'memories', 'long-term.jsonl'));

    await Promise.all([
      workingStore.load(),
      shortTermStore.load(),
      longTermStore.load(),
    ]);

    spinner.stop('stores loaded');

    // Get current counts
    const workingRecords = workingStore.getAll();
    const shortTermRecords = shortTermStore.getAll();
    const longTermRecords = longTermStore.getAll();

    printSection('Current State', icons.chart);
    console.log(`   Working Memory: ${c(formatNumber(workingRecords.length), 'cyan')} records`);
    console.log(`   Short-Term: ${c(formatNumber(shortTermRecords.length), 'cyan')} records`);
    console.log(`   Long-Term: ${c(formatNumber(longTermRecords.length), 'cyan')} records`);

    // Define promotion thresholds
    const NOW = Date.now();
    const WORKING_TO_SHORT_TERM_AGE = 24 * 60 * 60 * 1000;  // 24 hours
    const SHORT_TERM_TO_LONG_TERM_AGE = 7 * 24 * 60 * 60 * 1000;  // 7 days
    const MIN_USEFULNESS_FOR_LONG_TERM = 0.6;

    // Promotion logic
    let promotedToShortTerm = 0;
    let promotedToLongTerm = 0;
    let archived = 0;

    // Working -> Short-Term: Age > 24h
    console.log();
    printSection('Promoting Working -> Short-Term', icons.arrow);
    for (const record of workingRecords) {
      const recordAge = NOW - new Date(record.createdAt).getTime();
      if (recordAge > WORKING_TO_SHORT_TERM_AGE) {
        if (!options.dryRun) {
          await shortTermStore.append({
            ...record,
            tier: 'short-term',
            promotedAt: getTimestamp(),
            promotedFrom: 'working',
          });
          await workingStore.softDelete(record.id);
        }
        promotedToShortTerm++;
      }
    }
    console.log(`   ${promotedToShortTerm > 0 ? c(icons.check, 'green') : '-'} ${promotedToShortTerm} records ${options.dryRun ? '(would be promoted)' : 'promoted'}`);

    // Short-Term -> Long-Term: Age > 7 days AND usefulness >= 0.6
    console.log();
    printSection('Promoting Short-Term -> Long-Term', icons.arrow);
    for (const record of shortTermRecords) {
      const recordAge = NOW - new Date(record.createdAt).getTime();
      const usefulness = record.usefulness || record.score || 0.5;

      if (recordAge > SHORT_TERM_TO_LONG_TERM_AGE && usefulness >= MIN_USEFULNESS_FOR_LONG_TERM) {
        if (!options.dryRun) {
          await longTermStore.append({
            ...record,
            tier: 'long-term',
            promotedAt: getTimestamp(),
            promotedFrom: 'short-term',
          });
          await shortTermStore.softDelete(record.id);
        }
        promotedToLongTerm++;
      } else if (recordAge > SHORT_TERM_TO_LONG_TERM_AGE * 4) {
        // Archive old low-usefulness records (older than 28 days)
        if (!options.dryRun) {
          await shortTermStore.softDelete(record.id);
        }
        archived++;
      }
    }
    console.log(`   ${promotedToLongTerm > 0 ? c(icons.check, 'green') : '-'} ${promotedToLongTerm} records ${options.dryRun ? '(would be promoted)' : 'promoted'}`);
    console.log(`   ${archived > 0 ? c(icons.check, 'yellow') : '-'} ${archived} low-value records ${options.dryRun ? '(would be archived)' : 'archived'}`);

    // Compact stores if not dry run
    if (!options.dryRun && (promotedToShortTerm > 0 || promotedToLongTerm > 0 || archived > 0)) {
      console.log();
      printSection('Compacting stores', icons.gear);
      const workingCompact = await workingStore.compact({ removeDeleted: true });
      const shortTermCompact = await shortTermStore.compact({ removeDeleted: true });
      console.log(`   ${c(icons.check, 'green')} Working: ${workingCompact.before} -> ${workingCompact.after} records`);
      console.log(`   ${c(icons.check, 'green')} Short-Term: ${shortTermCompact.before} -> ${shortTermCompact.after} records`);
    }

    // Summary
    console.log();
    console.log(c('='.repeat(60), 'dim'));
    const total = promotedToShortTerm + promotedToLongTerm + archived;
    if (total > 0) {
      console.log(`${icons.sparkle} ${c(options.dryRun ? 'Dry run complete.' : 'Promotion complete!', 'green', 'bold')}`);
      console.log(`   ${formatNumber(total)} total records processed`);
    } else {
      console.log(`${icons.info} ${c('No records ready for promotion.', 'yellow')}`);
    }

    if (options.dryRun) {
      printInfo('Run without --dry-run to apply changes');
    }
    console.log();

  } catch (error) {
    spinner.fail('failed');
    console.error(`\n${c(icons.cross, 'red')} Error: ${c(error.message, 'red')}`);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// =============================================================================
// CONSOLIDATE COMMAND - Memory Consolidation
// =============================================================================

async function consolidateCommand(options) {
  printHeader('Memory Consolidation', icons.brain);

  const spinner = createSpinner('Analyzing memories...');
  spinner.start();

  try {
    const { JSONLStore } = require(path.join(CORTEX_DIR, 'core', 'storage.cjs'));
    const { generateId, getTimestamp } = require(path.join(CORTEX_DIR, 'core', 'types.cjs'));

    // Load all memory stores
    const workingStore = new JSONLStore(path.join(CORTEX_DIR, 'data', 'memories', 'working.jsonl'));
    const shortTermStore = new JSONLStore(path.join(CORTEX_DIR, 'data', 'memories', 'short-term.jsonl'));
    const longTermStore = new JSONLStore(path.join(CORTEX_DIR, 'data', 'memories', 'long-term.jsonl'));

    await Promise.all([
      workingStore.load(),
      shortTermStore.load(),
      longTermStore.load(),
    ]);

    spinner.stop('memories loaded');

    // Get all records
    const allRecords = [
      ...workingStore.getAll(),
      ...shortTermStore.getAll(),
      ...longTermStore.getAll(),
    ].filter(r => r.status !== 'deleted');

    printSection('Analysis', icons.chart);
    console.log(`   Total memories: ${c(formatNumber(allRecords.length), 'cyan')}`);

    // Group by type
    const byType = {};
    for (const record of allRecords) {
      const type = record.type || 'general';
      if (!byType[type]) byType[type] = [];
      byType[type].push(record);
    }

    console.log(`   Memory types: ${Object.keys(byType).join(', ')}`);

    // Find duplicates based on content similarity
    console.log();
    printSection('Finding duplicates', icons.search);
    const duplicateGroups = [];
    const seen = new Map();

    for (const record of allRecords) {
      const content = (record.summary || record.content || '').slice(0, 100).toLowerCase();
      const key = `${record.type}:${content}`;

      if (seen.has(key)) {
        const group = seen.get(key);
        group.push(record);
      } else {
        const group = [record];
        seen.set(key, group);
        duplicateGroups.push(group);
      }
    }

    const duplicates = duplicateGroups.filter(g => g.length > 1);
    console.log(`   Found ${c(formatNumber(duplicates.length), duplicates.length > 0 ? 'yellow' : 'green')} duplicate groups`);

    // Merge duplicates
    let mergedCount = 0;
    let removedCount = 0;

    if (duplicates.length > 0) {
      console.log();
      printSection('Merging duplicates', icons.gear);

      for (const group of duplicates) {
        // Keep the one with highest usefulness or most recent
        group.sort((a, b) => {
          const useA = a.usefulness || a.score || 0;
          const useB = b.usefulness || b.score || 0;
          if (useA !== useB) return useB - useA;
          return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
        });

        const keeper = group[0];
        const toRemove = group.slice(1);

        // Merge tags and boost usefulness
        const allTags = new Set(keeper.tags || []);
        let boostedUsefulness = keeper.usefulness || keeper.score || 0.5;

        for (const record of toRemove) {
          for (const tag of (record.tags || [])) {
            allTags.add(tag);
          }
          // Slight boost for having duplicates (validates the memory)
          boostedUsefulness += 0.05;
        }

        if (!options.dryRun) {
          // Update keeper with merged data
          await longTermStore.update(keeper.id, {
            tags: Array.from(allTags),
            usefulness: Math.min(boostedUsefulness, 1.0),
            mergedFrom: toRemove.map(r => r.id),
            consolidatedAt: getTimestamp(),
          });

          // Remove duplicates
          for (const record of toRemove) {
            const stores = [workingStore, shortTermStore, longTermStore];
            for (const store of stores) {
              if (store.get(record.id)) {
                await store.softDelete(record.id);
              }
            }
          }
        }

        mergedCount++;
        removedCount += toRemove.length;
      }

      console.log(`   ${mergedCount > 0 ? c(icons.check, 'green') : '-'} ${mergedCount} groups merged`);
      console.log(`   ${removedCount > 0 ? c(icons.check, 'green') : '-'} ${removedCount} duplicates ${options.dryRun ? '(would be removed)' : 'removed'}`);
    }

    // Pattern extraction (basic version)
    console.log();
    printSection('Pattern extraction', icons.sparkle);

    // Find common tags
    const tagCounts = {};
    for (const record of allRecords) {
      for (const tag of (record.tags || [])) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    const commonTags = Object.entries(tagCounts)
      .filter(([_, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    if (commonTags.length > 0) {
      console.log('   Top patterns by tag frequency:');
      for (const [tag, count] of commonTags) {
        console.log(`      ${c(tag, 'cyan')}: ${count} occurrences`);
      }
    } else {
      console.log('   No recurring patterns found yet');
    }

    // Compact stores if not dry run
    if (!options.dryRun && removedCount > 0) {
      console.log();
      printSection('Compacting stores', icons.gear);
      await workingStore.compact({ removeDeleted: true });
      await shortTermStore.compact({ removeDeleted: true });
      await longTermStore.compact({ removeDeleted: true });
      console.log(`   ${c(icons.check, 'green')} All stores compacted`);
    }

    // Summary
    console.log();
    console.log(c('='.repeat(60), 'dim'));
    console.log(`${icons.sparkle} ${c(options.dryRun ? 'Dry run complete.' : 'Consolidation complete!', 'green', 'bold')}`);
    if (options.dryRun) {
      printInfo('Run without --dry-run to apply changes');
    }
    console.log();

  } catch (error) {
    spinner.fail('failed');
    console.error(`\n${c(icons.cross, 'red')} Error: ${c(error.message, 'red')}`);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// =============================================================================
// SEARCH COMMAND
// =============================================================================

async function searchCommand(query, options) {
  if (!query || query.trim() === '') {
    console.log(`
${c('Usage:', 'bold')} cortex-memory search <query> [options]

Search memories across all sources (JSONL, CLAUDE.md, Episodic Memory, Knowledge Graph).

${c('Options:', 'bold')}
  --type <type>     Filter by memory type (learning, pattern, preference, skill, correction)
  --source <src>    Filter by source (jsonl, claudemd, episodic-memory, knowledge-graph)
  --limit <n>       Maximum results (default: 20)
  --format <fmt>    Output format (table, json, plain) (default: table)
  --verbose         Show detailed information

${c('Examples:', 'bold')}
  cortex-memory search "git error"                    # Search all sources
  cortex-memory search "docker" --type pattern        # Find docker patterns
  cortex-memory search "fix" --source claudemd        # Search only CLAUDE.md
  cortex-memory search "sync" --format json           # Output as JSON
`);
    return;
  }

  printHeader('Memory Search', icons.search);
  console.log(`   Query: "${c(query, 'cyan')}"`);
  if (options.type) console.log(`   Type filter: ${c(options.type, 'yellow')}`);
  if (options.source) console.log(`   Source filter: ${c(options.source, 'yellow')}`);
  console.log();

  const spinner = createSpinner('Searching memories...');
  spinner.start();

  try {
    const { QueryOrchestrator } = require(path.join(CORTEX_DIR, 'hooks', 'query-orchestrator.cjs'));

    // Create orchestrator (without MCP caller - only local sources work in CLI)
    const orchestrator = new QueryOrchestrator({
      basePath: CORTEX_DIR,
      tokenBudget: { total: 10000, perSource: 5000, perMemory: 1000 },
    });

    // Disable MCP-based adapters for CLI (they require Claude Code context)
    orchestrator.setAdapterEnabled('episodic-memory', false);
    orchestrator.setAdapterEnabled('knowledge-graph', false);

    spinner.stop('searching local sources');
    printInfo('Note: MCP sources (episodic-memory, knowledge-graph) require Claude Code context');
    console.log();

    // Execute query
    const result = await orchestrator.query({
      prompt: query,
      types: options.type ? [options.type] : null,
      adapters: options.source ? [options.source] : null,
      limit: options.limit || 20,
    });

    // Format output
    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else if (options.format === 'plain') {
      for (const memory of result.memories) {
        console.log(`[${memory.type}] ${memory.summary || memory.content}`);
      }
    } else {
      // Table format (default)
      printSection(`Results (${result.stats.totalSelected} of ${result.stats.totalQueried})`, icons.chart);
      console.log();

      if (result.memories.length === 0) {
        console.log(`   ${c('No matching memories found.', 'yellow')}`);
        printInfo('Try a different query or run: cortex-memory status');
      } else {
        // Group by type
        const byType = {};
        for (const memory of result.memories) {
          const t = memory.type || 'general';
          if (!byType[t]) byType[t] = [];
          byType[t].push(memory);
        }

        for (const [type, memories] of Object.entries(byType)) {
          console.log(c(`   ${type.toUpperCase()} (${memories.length})`, 'bold', 'cyan'));
          console.log(c('   ' + '-'.repeat(50), 'dim'));

          for (const memory of memories.slice(0, 5)) {
            const source = memory._source || 'unknown';
            const content = (memory.summary || memory.content || '').slice(0, 70);
            const relevance = memory.relevanceScore
              ? c(`[${(memory.relevanceScore * 100).toFixed(0)}%]`, 'green')
              : '';

            console.log(`   ${relevance} ${content}${content.length >= 70 ? '...' : ''}`);
            console.log(c(`      from: ${source}`, 'dim'));
          }

          if (memories.length > 5) {
            console.log(c(`      ... and ${memories.length - 5} more`, 'dim'));
          }
          console.log();
        }
      }

      // Stats
      if (options.verbose) {
        console.log();
        printSection('Statistics', icons.chart);
        console.log(`   Sources queried: ${Object.keys(result.stats.bySource).join(', ') || 'none'}`);
        console.log(`   Estimated tokens: ${result.stats.estimatedTokens}`);
      }
    }
    console.log();

  } catch (error) {
    spinner.fail('failed');
    console.error(`\n${c(icons.cross, 'red')} Error: ${c(error.message, 'red')}`);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// =============================================================================
// MAIN CLI SETUP
// =============================================================================

const program = new Command();

program
  .name('cortex-memory')
  .description('Cortex Memory System - CLI for Claude\'s cognitive layer')
  .version(VERSION);

program
  .command('status')
  .description('Show Cortex installation and memory status')
  .option('-v, --verbose', 'Show detailed information')
  .action(statusCommand);

program
  .command('promote')
  .description('Run tier promotion (working -> short-term -> long-term)')
  .option('-n, --dry-run', 'Show what would be promoted without making changes')
  .option('-v, --verbose', 'Show detailed information')
  .action(promoteCommand);

program
  .command('consolidate')
  .description('Run memory consolidation (deduplicate, merge, extract patterns)')
  .option('-n, --dry-run', 'Show what would be consolidated without making changes')
  .option('-v, --verbose', 'Show detailed information')
  .action(consolidateCommand);

program
  .command('search [query]')
  .description('Search memories across all sources')
  .option('-t, --type <type>', 'Filter by memory type')
  .option('-s, --source <source>', 'Filter by source adapter')
  .option('-l, --limit <number>', 'Maximum results', parseInt)
  .option('-f, --format <format>', 'Output format (table, json, plain)', 'table')
  .option('-v, --verbose', 'Show detailed information')
  .action(searchCommand);

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (process.argv.length <= 2) {
  program.help();
}
