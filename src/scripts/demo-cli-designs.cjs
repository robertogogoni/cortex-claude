#!/usr/bin/env node
/**
 * Cortex CLI Renderer Demo
 *
 * Shows the final Gradient Clack design using real CortexRenderer class
 * with simulated adapter data. Run directly in terminal for best results.
 *
 * Usage:
 *   node scripts/demo-cli-designs.cjs           # Full animated demo
 *   node scripts/demo-cli-designs.cjs --compact  # Compact mode
 *   node scripts/demo-cli-designs.cjs --quiet    # Quiet mode
 *   node scripts/demo-cli-designs.cjs --nocolor  # No ANSI colors
 */

'use strict';

const { CortexRenderer } = require('../hooks/cli-renderer.cjs');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const ADAPTERS = [
  { name: 'jsonl',           totalRecords: 142, lastQueryTime: 95,   wasColdStart: false },
  { name: 'claudemd',        totalRecords: 26,  lastQueryTime: 148,  wasColdStart: false },
  { name: 'gemini',          totalRecords: 8,   lastQueryTime: 403,  wasColdStart: false },
  { name: 'knowledge-graph', totalRecords: 10,  lastQueryTime: 466,  wasColdStart: false },
  { name: 'warp-sqlite',     totalRecords: 87,  lastQueryTime: 608,  wasColdStart: false },
  { name: 'vector',          totalRecords: 189, lastQueryTime: 1511, wasColdStart: true  },
  { name: 'episodic-memory', totalRecords: 312, lastQueryTime: 2252, wasColdStart: false },
];

// Sort by query time to simulate streaming order
const SORTED = [...ADAPTERS].sort((a, b) => a.lastQueryTime - b.lastQueryTime);

async function demoFull(noColor) {
  const renderer = new CortexRenderer({
    verbosity: 'full',
    tokenBudget: 4000,
    noColor,
  });

  renderer.banner();
  renderer.begin();
  renderer.phaseStart('Initializing');
  await sleep(600);
  renderer.phaseDone('Initialized', 300);

  renderer.phaseStart('Querying 7 adapters');

  for (const adapter of SORTED) {
    // Simulate staggered arrival
    await sleep(Math.min(200, adapter.lastQueryTime / 5));
    renderer.adapterResult(adapter);
  }

  // Simulate one error for demo
  renderer.adapterError({
    name: 'demo-fail',
    error: 'Timeout',
    lastQueryTime: 5000,
  });

  renderer.end({
    memoriesSelected: 47,
    estimatedTokens: 1545,
    duration: 2300,
    totalQueried: 774,
    hydeExpanded: true,
    hydeMs: 85,
    rankingMs: 200,
  });
}

async function demoCompact() {
  const renderer = new CortexRenderer({
    verbosity: 'full',
    tokenBudget: 4000,
  });

  renderer.compact({
    memoriesSelected: 47,
    estimatedTokens: 1545,
    duration: 2300,
  });
}

async function demoQuiet() {
  const renderer = new CortexRenderer({
    verbosity: 'full',
    tokenBudget: 4000,
  });

  renderer.quiet({
    memoriesSelected: 47,
    estimatedTokens: 1545,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const noColor = args.includes('--nocolor') || args.includes('--no-color');

  if (args.includes('--compact')) {
    await demoCompact();
  } else if (args.includes('--quiet')) {
    await demoQuiet();
  } else {
    await demoFull(noColor);
  }
}

main().catch(e => {
  process.stderr.write('\x1b[?25h'); // Restore cursor on error
  console.error(e);
  process.exit(1);
});
