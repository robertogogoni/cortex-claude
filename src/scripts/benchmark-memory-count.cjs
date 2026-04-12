#!/usr/bin/env node
/**
 * Benchmark: Memory Count Before/After Phase E Fix
 *
 * Runs multiple representative queries and measures:
 * - Total memories returned per query
 * - Source diversity (which adapters contribute)
 * - Latency per query
 *
 * Usage: node scripts/benchmark-memory-count.cjs
 *
 * @version 1.0.0
 */

'use strict';

const path = require('path');

const queries = [
  { tags: ['claude', 'code', 'configuration'], intent: 'configuration setup' },
  { tags: ['debugging', 'errors'], intent: 'debugging and troubleshooting' },
  { tags: ['wayland', 'cedilla'], intent: 'wayland cedilla fix' },
  { tags: ['cortex', 'memory', 'system'], intent: 'memory architecture' },
  { tags: ['hyprland', 'setup'], intent: 'desktop configuration' },
  { tags: ['git', 'workflow'], intent: 'version control patterns' },
  { tags: ['bash', 'script'], intent: 'shell scripting' },
  { tags: ['node', 'javascript'], intent: 'nodejs development' },
];

async function main() {
  const { createDefaultRegistry } = require('../adapters/index.cjs');

  const registry = createDefaultRegistry({
    basePath: path.join(process.env.HOME, '.claude', 'memory'),
    mcpCaller: null,
    verbose: false,
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Cortex Memory Benchmark — ${timestamp}`);
  console.log(`  mcpCaller: null (Phase E direct access mode)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const allResults = [];

  for (const q of queries) {
    const context = {
      projectName: 'memory',
      projectType: 'nodejs',
      intent: q.intent,
      intentConfidence: 0.7,
      tags: q.tags,
      domains: ['javascript'],
      gitBranch: 'master',
    };

    const t = Date.now();
    const { results, stats } = await registry.queryAll(context, { limit: 100 });
    const elapsed = Date.now() - t;

    const sources = {};
    for (const r of results) {
      const src = r._source || 'unknown';
      sources[src] = (sources[src] || 0) + 1;
    }

    const adapterCount = Object.values(stats).filter(s => s.available && s.totalRecords > 0).length;

    console.log(`Query: "${q.tags.join(' ')}" (intent: ${q.intent})`);
    console.log(`  Total: ${results.length} memories from ${adapterCount} adapters in ${elapsed}ms`);
    for (const [src, count] of Object.entries(sources).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${src.padEnd(20)} ${count}`);
    }
    console.log('');

    allResults.push({
      query: q.tags.join(' '),
      intent: q.intent,
      total: results.length,
      adapters: adapterCount,
      elapsed,
      sources,
    });
  }

  // Summary
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  SUMMARY`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const avgMemories = Math.round(allResults.reduce((s, r) => s + r.total, 0) / allResults.length);
  const avgLatency = Math.round(allResults.reduce((s, r) => s + r.elapsed, 0) / allResults.length);
  const maxAdapters = Math.max(...allResults.map(r => r.adapters));

  console.log(`  Queries run:       ${allResults.length}`);
  console.log(`  Avg memories/query: ${avgMemories}`);
  console.log(`  Avg latency:       ${avgLatency}ms`);
  console.log(`  Max active adapters: ${maxAdapters}`);
  console.log('');
  console.log(`  BEFORE Phase E: ~57 memories, ~4 adapters`);
  console.log(`  AFTER Phase E:  ~${avgMemories} memories, ~${maxAdapters} adapters`);
  console.log(`  Improvement:    ~${(avgMemories / 57).toFixed(1)}x more memories`);
  console.log('');
}

main().catch(err => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
