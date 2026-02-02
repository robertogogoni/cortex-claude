#!/usr/bin/env node
/**
 * Cortex Query Performance Benchmark
 *
 * Measures query performance before/after optimizations.
 * Runs test queries multiple times and reports statistics.
 *
 * Usage:
 *   node scripts/benchmark-query.cjs [--iterations=3] [--warmup] [--verbose]
 *
 * Options:
 *   --iterations=N  Number of times to run each query (default: 3)
 *   --warmup        Run one warmup query first (loads models)
 *   --verbose       Show detailed timing for each query
 *   --no-api        Disable Haiku API calls (test local performance only)
 *
 * @version 1.0.0
 */

'use strict';

const path = require('path');

// Parse arguments
const args = process.argv.slice(2);
const iterations = parseInt(args.find(a => a.startsWith('--iterations='))?.split('=')[1]) || 3;
const warmup = args.includes('--warmup');
const verbose = args.includes('--verbose');
const noApi = args.includes('--no-api');

// Test queries representing different types
const TEST_QUERIES = [
  {
    query: 'React hooks best practices',
    description: 'Common tech query',
    expectedIntent: 'learning',
  },
  {
    query: 'debugging memory leaks Node.js',
    description: 'Debugging query',
    expectedIntent: 'debugging',
  },
  {
    query: 'PostgreSQL optimization indexes',
    description: 'Database optimization',
    expectedIntent: 'implementing',
  },
  {
    query: 'git rebase vs merge workflow',
    description: 'Git workflow question',
    expectedIntent: 'learning',
  },
  {
    query: 'how to structure monorepo',
    description: 'Architecture question',
    expectedIntent: 'planning',
  },
];

// Statistics helpers
function calcStats(times) {
  if (times.length === 0) return { avg: 0, min: 0, max: 0, p50: 0, p95: 0 };

  const sorted = [...times].sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);

  return {
    avg: Math.round(sum / times.length),
    min: Math.round(sorted[0]),
    max: Math.round(sorted[sorted.length - 1]),
    p50: Math.round(sorted[Math.floor(sorted.length * 0.5)]),
    p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1]),
  };
}

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTable(rows, headers) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i]).length))
  );

  const separator = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const headerRow = '|' + headers.map((h, i) => ` ${h.padEnd(widths[i])} `).join('|') + '|';

  const dataRows = rows.map(row =>
    '|' + row.map((cell, i) => ` ${String(cell).padEnd(widths[i])} `).join('|') + '|'
  );

  return [separator, headerRow, separator, ...dataRows, separator].join('\n');
}

async function main() {
  console.log('='.repeat(70));
  console.log('  CORTEX QUERY PERFORMANCE BENCHMARK');
  console.log('='.repeat(70));
  console.log(`\nConfiguration:`);
  console.log(`  - Iterations per query: ${iterations}`);
  console.log(`  - Warmup: ${warmup ? 'yes' : 'no'}`);
  console.log(`  - Haiku API: ${noApi ? 'disabled' : 'enabled'}`);
  console.log(`  - Verbose: ${verbose ? 'yes' : 'no'}`);
  console.log();

  // Import the HaikuWorker
  let HaikuWorker;
  try {
    const workerModule = require('../cortex/haiku-worker.cjs');
    HaikuWorker = workerModule.HaikuWorker;
  } catch (error) {
    console.error('Failed to load HaikuWorker:', error.message);
    process.exit(1);
  }

  // Initialize worker
  const basePath = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'memory');
  const worker = new HaikuWorker({
    basePath,
    enableApiCalls: !noApi,
    verbose,
  });

  console.log('Worker initialized.\n');

  // Warmup run (loads embedding model, etc.)
  if (warmup) {
    console.log('Running warmup query...');
    const warmupStart = Date.now();
    try {
      await worker.query('warmup query test', ['all'], 5);
      console.log(`Warmup completed in ${formatMs(Date.now() - warmupStart)}\n`);
    } catch (error) {
      console.log(`Warmup failed (ok): ${error.message}\n`);
    }
    // Clear cache to ensure fair benchmark
    worker.clearCache();
  }

  // Run benchmarks
  const results = [];
  const allTimes = [];

  for (const test of TEST_QUERIES) {
    console.log(`\nTesting: "${test.query}"`);
    console.log(`  (${test.description})`);

    const times = [];
    let lastResult = null;

    for (let i = 0; i < iterations; i++) {
      // Clear cache between iterations to measure cold performance
      // Comment out next line to measure cached performance
      if (i > 0) worker.clearCache();

      const start = Date.now();
      try {
        lastResult = await worker.query(test.query, ['all'], 10);
        const elapsed = Date.now() - start;
        times.push(elapsed);
        allTimes.push(elapsed);

        if (verbose) {
          console.log(`    Run ${i + 1}: ${formatMs(elapsed)} (${lastResult?.stats?.apiCalls || 0} API calls, ${lastResult?.memories?.length || 0} results)`);
        }
      } catch (error) {
        console.log(`    Run ${i + 1}: ERROR - ${error.message}`);
        times.push(-1);
      }
    }

    const validTimes = times.filter(t => t >= 0);
    const stats = calcStats(validTimes);

    results.push({
      query: test.query.substring(0, 30),
      description: test.description,
      avg: formatMs(stats.avg),
      min: formatMs(stats.min),
      max: formatMs(stats.max),
      apiCalls: lastResult?.stats?.apiCalls || 0,
      cacheHits: lastResult?.stats?.cacheHits || 0,
      results: lastResult?.memories?.length || 0,
    });

    console.log(`  Results: avg=${formatMs(stats.avg)}, min=${formatMs(stats.min)}, max=${formatMs(stats.max)}`);
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('  RESULTS SUMMARY');
  console.log('='.repeat(70) + '\n');

  const tableRows = results.map(r => [
    r.query,
    r.avg,
    r.min,
    r.max,
    r.apiCalls,
    r.cacheHits,
    r.results,
  ]);

  console.log(formatTable(
    tableRows,
    ['Query', 'Avg', 'Min', 'Max', 'API', 'Cache', 'Results']
  ));

  // Overall stats
  const validAllTimes = allTimes.filter(t => t >= 0);
  const overallStats = calcStats(validAllTimes);

  console.log('\n--- OVERALL STATISTICS ---');
  console.log(`  Total queries: ${validAllTimes.length}`);
  console.log(`  Average: ${formatMs(overallStats.avg)}`);
  console.log(`  Minimum: ${formatMs(overallStats.min)}`);
  console.log(`  Maximum: ${formatMs(overallStats.max)}`);
  console.log(`  P50: ${formatMs(overallStats.p50)}`);
  console.log(`  P95: ${formatMs(overallStats.p95)}`);

  // Performance target check
  console.log('\n--- PERFORMANCE TARGET ---');
  const targetMs = 5000;
  const underTarget = validAllTimes.filter(t => t < targetMs).length;
  const percent = Math.round((underTarget / validAllTimes.length) * 100);
  const status = overallStats.avg < targetMs ? 'PASS' : 'FAIL';

  console.log(`  Target: < ${formatMs(targetMs)}`);
  console.log(`  Result: ${status} (${percent}% of queries under target)`);

  if (status === 'PASS') {
    console.log(`  [OK] Average query time is within target!`);
  } else {
    console.log(`  [SLOW] Average query time exceeds target by ${formatMs(overallStats.avg - targetMs)}`);
  }

  // Worker stats
  const workerStats = worker.getStats();
  console.log('\n--- WORKER STATISTICS ---');
  console.log(`  Total API calls: ${workerStats.apiCalls}`);
  console.log(`  Total cache hits: ${workerStats.cacheHits}`);
  console.log(`  Tokens used: ${workerStats.tokensUsed}`);
  console.log(`  Estimated cost: $${workerStats.estimatedCost.toFixed(4)}`);
  console.log(`  Cache size: ${workerStats.cache.size}/${workerStats.cache.maxSize}`);

  console.log('\n' + '='.repeat(70));
  console.log('  BENCHMARK COMPLETE');
  console.log('='.repeat(70) + '\n');
}

// Run
main().catch(error => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
