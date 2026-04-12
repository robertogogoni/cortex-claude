#!/usr/bin/env node
/**
 * Cortex Memory Interactive TUI
 * Terminal User Interface for exploring and maintaining the Cortex Morphology
 */

'use strict';

const { select, input, confirm } = require('@inquirer/prompts');
const { execSync } = require('child_process');
const path = require('path');

const CORTEX_CLI = path.join(__dirname, 'cortex.cjs');
const INGEST_CLI = path.join(__dirname, 'cortex-ingest.cjs');

console.clear();
console.log('\x1b[36m============================================================\x1b[0m');
console.log('\x1b[1m\x1b[36m  🧠  CORTEX MORPHOLOGY - TERMINAL UI \x1b[0m');
console.log('\x1b[36m============================================================\x1b[0m\n');

async function main() {
  let exit = false;

  while (!exit) {
    const action = await select({
      message: 'What would you like to do?',
      choices: [
        { name: '📊 View Memory Status', value: 'status', description: 'Monitor storage size and system sanity' },
        { name: '🔍 Search Memories', value: 'search', description: 'Search across the memory topological graph' },
        { name: '📥 Ingest New Data', value: 'ingest', description: 'Feed text, markdown, or audio files into the cortex lobes' },
        { name: '🚀 Promote Memory Tiers', value: 'promote', description: 'Run tier-promotions (Working -> Short Term -> Long Term)' },
        { name: '🧬 Consolidate Graph', value: 'consolidate', description: 'Merge duplicate records and synthesize patterns' },
        { name: 'export', name: '💾 Export Obsidian Vault', value: 'export', description: 'Generate human-readable visual vault' },
        { name: '❌ Exit', value: 'exit' }
      ]
    });

    try {
      console.log('');
      switch (action) {
        case 'status':
          execSync(`node "${CORTEX_CLI}" status`, { stdio: 'inherit' });
          break;
        case 'search':
          const query = await input({ message: 'Enter your search query:' });
          if (query) execSync(`node "${CORTEX_CLI}" search "${query}"`, { stdio: 'inherit' });
          break;
        case 'ingest':
          const fileToIngest = await input({ message: 'Enter the absolute path to the file you want to ingest:' });
          if (fileToIngest) {
             const isReal = await confirm({ message: 'Are you sure you want to ingest this file?' });
             if (isReal) execSync(`node "${INGEST_CLI}" "${fileToIngest}"`, { stdio: 'inherit' });
          }
          break;
        case 'promote':
          execSync(`node "${CORTEX_CLI}" promote`, { stdio: 'inherit' });
          break;
        case 'consolidate':
          execSync(`node "${CORTEX_CLI}" consolidate`, { stdio: 'inherit' });
          break;
        case 'export':
          const vaultTarget = await input({ message: 'Enter export path (default: ~/.claude/memory/obsidian-vault):', default: '~/.claude/memory/obsidian-vault' });
          execSync(`node "${CORTEX_CLI}" export-vault --vault-path "${vaultTarget}" --clean`, { stdio: 'inherit' });
          break;
        case 'exit':
          exit = true;
          console.log('\x1b[36mGoodbye! Keep your mental state secure.\x1b[0m');
          break;
      }
    } catch (e) {
      console.error('\x1b[31m[TUI Execution Error]\x1b[0m Failed to run command.', e.message);
    }

    if (!exit) {
      console.log('');
      await input({ message: 'Press Enter to return to main menu...' });
      console.clear();
      console.log('\x1b[36m============================================================\x1b[0m');
      console.log('\x1b[1m\x1b[36m  🧠  CORTEX MORPHOLOGY - TERMINAL UI \x1b[0m');
      console.log('\x1b[36m============================================================\x1b[0m\n');
    }
  }
}

main().catch(err => {
  console.error('\x1b[31mFatal TUI Error:\x1b[0m', err);
  process.exit(1);
});
