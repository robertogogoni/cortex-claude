#!/usr/bin/env node
/**
 * Cortex Memory Tier Promotion CLI
 *
 * Manages memory lifecycle across tiers:
 * - Working memory: Very recent (< 24 hours), max 50 items
 * - Short-term memory: Recent (1-7 days), max 200 items
 * - Long-term memory: Permanent, quality-filtered
 *
 * Usage:
 *   node scripts/promote.cjs           # Dry run (default) - shows what would happen
 *   node scripts/promote.cjs --execute # Actually perform promotions
 *   node scripts/promote.cjs --summary # Show current tier statistics
 *   node scripts/promote.cjs --help    # Show help
 */

'use strict';

const path = require('path');
const { TierPromotion, DEFAULT_THRESHOLDS } = require('../core/tier-promotion.cjs');

// =============================================================================
// ANSI COLORS
// =============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Bright foreground
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',

  // Background
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

const c = (color, text) => `${colors[color]}${text}${colors.reset}`;
const b = (text) => `${colors.bold}${text}${colors.reset}`;

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

function formatTable(headers, rows) {
  const widths = headers.map((h, i) => {
    const maxDataWidth = Math.max(...rows.map(r => String(r[i] || '').length));
    return Math.max(h.length, maxDataWidth);
  });

  const separator = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const formatRow = (row) => '| ' + row.map((cell, i) =>
    String(cell || '').padEnd(widths[i])
  ).join(' | ') + ' |';

  console.log(separator);
  console.log(formatRow(headers));
  console.log(separator);
  for (const row of rows) {
    console.log(formatRow(row));
  }
  console.log(separator);
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  if (ms < 3600000) return (ms / 60000).toFixed(1) + 'm';
  if (ms < 86400000) return (ms / 3600000).toFixed(1) + 'h';
  return (ms / 86400000).toFixed(1) + 'd';
}

// =============================================================================
// HELP
// =============================================================================

function showHelp() {
  console.log(`
${b('Cortex Memory Tier Promotion')}

${c('cyan', 'USAGE:')}
  node scripts/promote.cjs [options]

${c('cyan', 'OPTIONS:')}
  ${c('yellow', '--execute, -e')}     Actually perform promotions (default is dry-run)
  ${c('yellow', '--summary, -s')}     Show current tier statistics only
  ${c('yellow', '--verbose, -v')}     Enable verbose logging
  ${c('yellow', '--help, -h')}        Show this help message

${c('cyan', 'TIERS:')}
  ${c('green', 'Working Memory')}     < 24 hours, max 50 items
  ${c('yellow', 'Short-term Memory')}  1-7 days, max 200 items
  ${c('blue', 'Long-term Memory')}   Permanent, quality-filtered

${c('cyan', 'PROMOTION RULES:')}
  Working -> Short-term:
    - Age > 24 hours, OR
    - Count exceeds 50 (oldest first)

  Short-term -> Long-term:
    - Age > 7 days, AND
    - usageSuccessRate >= 0.6 (high quality)

  Short-term -> Delete:
    - Age > 7 days, AND
    - usageSuccessRate < 0.3 (low quality)

${c('cyan', 'QUALITY SCORE:')}
  Calculated from: extractionConfidence (25%), usageCount (20%),
                   usageSuccessRate (35%), decayScore (20%)

${c('cyan', 'EXAMPLES:')}
  # Preview what would be promoted (safe, no changes)
  node scripts/promote.cjs

  # Actually perform promotions
  node scripts/promote.cjs --execute

  # Show current statistics
  node scripts/promote.cjs --summary
`);
}

// =============================================================================
// SUMMARY COMMAND
// =============================================================================

async function showSummary(promoter) {
  await promoter.initialize();
  const summary = promoter.getSummary();

  console.log();
  console.log(b('=== Cortex Memory Tier Summary ==='));
  console.log();

  formatTable(
    ['Tier', 'Count', 'Limit', 'Capacity', 'Max Age'],
    [
      [
        c('green', 'Working'),
        summary.tiers.working.count,
        summary.tiers.working.maxItems,
        summary.tiers.working.capacityUsed,
        formatDuration(DEFAULT_THRESHOLDS.working.maxAge),
      ],
      [
        c('yellow', 'Short-term'),
        summary.tiers.shortTerm.count,
        summary.tiers.shortTerm.maxItems,
        summary.tiers.shortTerm.capacityUsed,
        formatDuration(DEFAULT_THRESHOLDS.shortTerm.maxAge),
      ],
      [
        c('blue', 'Long-term'),
        summary.tiers.longTerm.count,
        'Unlimited',
        '-',
        'Permanent',
      ],
    ]
  );

  console.log();
  console.log(b('Quality Thresholds for Short-term:'));
  console.log(`  Promote to Long-term: usageSuccessRate >= ${DEFAULT_THRESHOLDS.shortTerm.promoteThreshold}`);
  console.log(`  Delete (low quality): usageSuccessRate < ${DEFAULT_THRESHOLDS.shortTerm.deleteThreshold}`);

  if (summary.runStats.lastRun) {
    console.log();
    console.log(b('Last Promotion Run:'));
    console.log(`  Time: ${summary.runStats.lastRun}`);
    console.log(`  Total Promotions: ${summary.runStats.totalPromotions}`);
    console.log(`  Total Deletions: ${summary.runStats.totalDeletions}`);
    console.log(`  Total Errors: ${summary.runStats.totalErrors}`);
  }

  console.log();
}

// =============================================================================
// PROMOTE COMMAND (DRY RUN OR EXECUTE)
// =============================================================================

async function runPromotion(promoter, execute, verbose) {
  console.log();
  console.log(b(`=== Memory Tier Promotion ${execute ? '(EXECUTE)' : '(DRY RUN)'} ===`));
  console.log();

  if (!execute) {
    console.log(c('yellow', '  This is a DRY RUN. No changes will be made.'));
    console.log(c('yellow', '  Use --execute to actually perform promotions.'));
    console.log();
  }

  const initResult = await promoter.initialize();
  if (!initResult.success) {
    console.log(c('red', `  Failed to initialize stores: ${initResult.error}`));
    process.exit(1);
  }

  console.log(b('Current State:'));
  console.log(`  Working memory:    ${initResult.stores.working.count} items`);
  console.log(`  Short-term memory: ${initResult.stores.shortTerm.count} items`);
  console.log(`  Long-term memory:  ${initResult.stores.longTerm.count} items`);
  console.log();

  // Run promotion
  const result = await promoter.promote({ dryRun: !execute });

  if (!result.success) {
    console.log(c('red', `  Promotion failed: ${result.error}`));
    process.exit(1);
  }

  const { results } = result;

  // Working -> Short-term
  console.log(b('Working -> Short-term:'));
  if (results.promoted.workingToShortTerm.length === 0) {
    console.log(c('dim', '  No items to promote'));
  } else {
    formatTable(
      ['ID', 'Age (hours)', 'Reason', 'Quality'],
      results.promoted.workingToShortTerm.map(item => [
        item.id.substring(0, 20) + (item.id.length > 20 ? '...' : ''),
        item.age,
        item.reason,
        item.quality.toFixed(2),
      ])
    );
  }
  console.log();

  // Short-term -> Long-term
  console.log(b('Short-term -> Long-term:'));
  if (results.promoted.shortTermToLongTerm.length === 0) {
    console.log(c('dim', '  No items to promote'));
  } else {
    formatTable(
      ['ID', 'Age (days)', 'Reason', 'Quality', 'Success Rate'],
      results.promoted.shortTermToLongTerm.map(item => [
        item.id.substring(0, 20) + (item.id.length > 20 ? '...' : ''),
        item.age,
        item.reason,
        item.quality.toFixed(2),
        item.usageSuccessRate.toFixed(2),
      ])
    );
  }
  console.log();

  // Deleted
  console.log(b('Deleted (low quality):'));
  if (results.deleted.length === 0) {
    console.log(c('dim', '  No items to delete'));
  } else {
    formatTable(
      ['ID', 'Age (days)', 'Quality', 'Success Rate'],
      results.deleted.map(item => [
        item.id.substring(0, 20) + (item.id.length > 20 ? '...' : ''),
        item.age,
        item.quality.toFixed(2),
        item.usageSuccessRate.toFixed(2),
      ])
    );
  }
  console.log();

  // Errors
  if (results.errors.length > 0) {
    console.log(c('red', b('Errors:')));
    for (const error of results.errors) {
      console.log(c('red', `  ${error.id}: ${error.operation} - ${error.error}`));
    }
    console.log();
  }

  // Summary
  console.log(b('Summary:'));
  console.log(`  Working memory:    ${results.stats.workingBefore} -> ${results.stats.workingAfter}`);
  console.log(`  Short-term memory: ${results.stats.shortTermBefore} -> ${results.stats.shortTermAfter}`);
  console.log(`  Long-term memory:  ${results.stats.longTermBefore} -> ${results.stats.longTermAfter}`);
  console.log();

  const totalChanges = results.promoted.workingToShortTerm.length +
                       results.promoted.shortTermToLongTerm.length +
                       results.deleted.length;

  if (execute) {
    if (totalChanges > 0) {
      console.log(c('green', `  ✓ ${totalChanges} changes applied successfully`));
    } else {
      console.log(c('dim', '  No changes needed'));
    }
  } else {
    if (totalChanges > 0) {
      console.log(c('yellow', `  ${totalChanges} changes would be made. Run with --execute to apply.`));
    } else {
      console.log(c('dim', '  No changes would be made'));
    }
  }
  console.log();
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const options = {
    execute: args.includes('--execute') || args.includes('-e'),
    summary: args.includes('--summary') || args.includes('-s'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    help: args.includes('--help') || args.includes('-h'),
  };

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const promoter = new TierPromotion({
    basePath: path.join(__dirname, '..'),
    verbose: options.verbose,
  });

  try {
    if (options.summary) {
      await showSummary(promoter);
    } else {
      await runPromotion(promoter, options.execute, options.verbose);
    }
  } catch (error) {
    console.error(c('red', `Error: ${error.message}`));
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
