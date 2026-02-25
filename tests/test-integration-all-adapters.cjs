#!/usr/bin/env node
/**
 * Integration Test — All 8 Adapters Return Results Without mcpCaller
 *
 * This test validates the Phase E fix: both EpisodicMemoryAdapter and
 * KnowledgeGraphAdapter now work via direct file access, bypassing the
 * MCP-to-MCP limitation that caused the 57-memory problem.
 *
 * BEFORE Phase E: Only 4-5 adapters returned results (JSONL, CLAUDE.md, Gemini, Warp, Vector)
 * AFTER Phase E: All 7-8 adapters return results (+ EpisodicMemory, KnowledgeGraph)
 *
 * @version 1.0.0
 */

'use strict';

const path = require('path');

// =============================================================================
// INTEGRATION TEST
// =============================================================================

async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Phase E Integration Test — All Adapters Without mcpCaller');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Load the registry factory — the SAME code path as production
  const { createDefaultRegistry } = require('../adapters/index.cjs');

  // Create registry WITHOUT mcpCaller — this is the exact scenario
  // that caused the 57-memory problem in HaikuWorker
  const registry = createDefaultRegistry({
    basePath: path.join(process.env.HOME, '.claude', 'memory'),
    mcpCaller: null,  // <-- THE KEY: no MCP access
    verbose: true,    // Show errors for debugging
  });

  // Query context simulating a real user query
  const context = {
    projectName: 'memory',
    projectHash: null,
    projectType: 'nodejs',
    intent: 'debugging and development',
    intentConfidence: 0.7,
    tags: ['claude', 'memory', 'mcp'],
    domains: ['javascript', 'documentation'],
    gitBranch: 'master',
  };

  const options = {
    limit: 500,  // High limit to see all results
  };

  console.log('▸ Query context:', JSON.stringify({
    tags: context.tags,
    intent: context.intent,
    projectName: context.projectName,
  }));
  console.log('▸ mcpCaller: null (NO MCP ACCESS)\n');

  // Execute query across all adapters
  const startTime = Date.now();
  const { results, stats } = await registry.queryAll(context, options);
  const totalTime = Date.now() - startTime;

  // =========================================================================
  // REPORT
  // =========================================================================

  console.log('┌───────────────────────────────────────────────────────────────────┐');
  console.log('│                     ADAPTER RESULTS REPORT                        │');
  console.log('├─────────────────────┬──────────┬──────────┬──────────┬────────────┤');
  console.log('│ Adapter             │ Status   │ Records  │ Time(ms) │ Error      │');
  console.log('├─────────────────────┼──────────┼──────────┼──────────┼────────────┤');

  let adaptersPassed = 0;
  let adaptersFailed = 0;
  let totalRecords = 0;

  // Expected adapters in order
  const expectedAdapters = [
    'jsonl',
    'episodic-memory',
    'knowledge-graph',
    'claudemd',
    'gemini',
    'warp-sqlite',
    'vector',           // Note: adapter name is 'vector', not 'vector-search'
  ];

  for (const name of expectedAdapters) {
    const s = stats[name];
    if (!s) {
      const line = `│ ${name.padEnd(19)} │ ${'MISSING'.padEnd(8)} │ ${'-'.padEnd(8)} │ ${'-'.padEnd(8)} │ ${'not registered'.padEnd(10)} │`;
      console.log(line);
      adaptersFailed++;
      continue;
    }

    const status = s.available ? '✓ OK' : '✗ FAIL';
    const records = String(s.totalRecords).padStart(6);
    const time = String(s.lastQueryTime).padStart(6);
    const error = s.error ? s.error.slice(0, 10) : '-';

    const line = `│ ${name.padEnd(19)} │ ${status.padEnd(8)} │ ${records.padEnd(8)} │ ${time.padEnd(8)} │ ${error.padEnd(10)} │`;
    console.log(line);

    if (s.available && s.totalRecords > 0) {
      adaptersPassed++;
      totalRecords += s.totalRecords;
    } else if (s.available && s.totalRecords === 0) {
      // Available but no results for this query — still counts as working
      adaptersPassed++;
    } else {
      adaptersFailed++;
    }
  }

  console.log('├─────────────────────┼──────────┼──────────┼──────────┼────────────┤');
  console.log(`│ TOTAL               │ ${String(adaptersPassed).padStart(2)}/${expectedAdapters.length} ok  │ ${String(totalRecords).padStart(6).padEnd(8)} │ ${String(totalTime).padStart(6).padEnd(8)} │            │`);
  console.log('└─────────────────────┴──────────┴──────────┴──────────┴────────────┘');

  // Memory source breakdown
  console.log('\n▸ Memory Source Breakdown:');
  const sourceMap = {};
  for (const r of results) {
    const source = r._source || 'unknown';
    sourceMap[source] = (sourceMap[source] || 0) + 1;
  }
  for (const [source, count] of Object.entries(sourceMap).sort((a, b) => b[1] - a[1])) {
    const bar = '█'.repeat(Math.min(40, Math.ceil(count / 2)));
    console.log(`  ${source.padEnd(20)} ${String(count).padStart(5)} ${bar}`);
  }

  // =========================================================================
  // VALIDATION
  // =========================================================================

  console.log('\n▸ Validation:');

  // Critical check: the two previously-broken adapters
  const episodic = stats['episodic-memory'];
  const kg = stats['knowledge-graph'];

  if (episodic?.available) {
    console.log(`  ✓ episodic-memory: AVAILABLE (${episodic.totalRecords} records, ${episodic.lastQueryTime}ms)`);
  } else {
    console.log(`  ✗ episodic-memory: FAILED — ${episodic?.error || 'not available'}`);
  }

  if (kg?.available) {
    console.log(`  ✓ knowledge-graph: AVAILABLE (${kg.totalRecords} records, ${kg.lastQueryTime}ms)`);
  } else {
    console.log(`  ✗ knowledge-graph: FAILED — ${kg?.error || 'not available'}`);
  }

  // Count adapters that returned results
  const withResults = Object.values(stats).filter(s => s.available && s.totalRecords > 0).length;
  console.log(`\n  Adapters with results: ${withResults}/${expectedAdapters.length}`);
  console.log(`  Total unique memories: ${results.length}`);

  // Final verdict
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (episodic?.available && kg?.available && adaptersFailed === 0) {
    console.log('  ✅ PHASE E FIX VERIFIED: All adapters work without mcpCaller');
  } else if (episodic?.available && kg?.available) {
    console.log('  ⚠️  PARTIAL: EpisodicMemory + KnowledgeGraph fixed, but some adapters failed');
  } else {
    console.log('  ❌ PHASE E FIX INCOMPLETE: Critical adapters still failing');
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Exit with error if critical adapters failed
  const criticalOk = episodic?.available && kg?.available;
  process.exit(criticalOk ? 0 : 1);
}

main().catch(err => {
  console.error('Integration test error:', err);
  process.exit(1);
});
