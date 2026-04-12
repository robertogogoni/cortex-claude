#!/usr/bin/env node
/**
 * Cortex Master CLI
 * Interactive guide to all Cortex memory functions
 */

'use strict';

const readline = require('readline');
const { spawn } = require('child_process');
const path = require('path');

const CORTEX_BIN = __dirname;

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bgBlue: '\x1b[44m',
  yellow: '\x1b[33m',
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function printHeader() {
  console.clear();
  console.log(`\n${colors.bgBlue}${colors.bold} 🧠 CORTEX MASTER CONSOLE ${colors.reset}\n`);
  console.log(`${colors.cyan}The AI Cognitive Layer & Universal Memory System${colors.reset}\n`);
}

function showMenu() {
  printHeader();
  
  console.log(`${colors.bold}1. 📥 Ingest External Data${colors.reset}`);
  console.log(`   ${colors.dim}Import WhatsApp, Beeper, Voice Notes, or Markdown into memory${colors.reset}\n`);
  
  console.log(`${colors.bold}2. 💤 Neural Dream Consolidation${colors.reset}`);
  console.log(`   ${colors.dim}Run REM sleep cycle to wire neurons, extract patterns, and prune links${colors.reset}\n`);
  
  console.log(`${colors.bold}3. 🕸️  Export to Obsidian${colors.reset}`);
  console.log(`   ${colors.dim}Generate the interactive, color-coded Knowledge Graph Vault${colors.reset}\n`);
  
  console.log(`${colors.bold}4. 🌐 Start API Server${colors.reset}`);
  console.log(`   ${colors.dim}Host your brain on localhost:4000 for external dashboards${colors.reset}\n`);
  
  console.log(`${colors.bold}5. 💾 Backup Memory State${colors.reset}`);
  console.log(`   ${colors.dim}Snapshot your SQLite and Neural databases safely to a tar.gz${colors.reset}\n`);
  
  console.log(`${colors.bold}6. 📊 System Status${colors.reset}`);
  console.log(`   ${colors.dim}Check memory stats, Vector indexing, and Haiku/Sonnet connections${colors.reset}\n`);
  
  console.log(`${colors.bold}0. Exit${colors.reset}\n`);

  rl.question(`${colors.yellow}Select an option [0-6]: ${colors.reset}`, handleSelection);
}

function handleSelection(answer) {
  const selection = parseInt(answer.trim());
  let script = null;
  let args = [];

  switch (selection) {
    case 1:
      // Ingest
      rl.question(`\n${colors.cyan}Enter path to file (or press enter for voice demo): ${colors.reset}`, (filePath) => {
        const fp = filePath.trim() || 'demo.mp3';
        script = 'cortex-ingest.cjs';
        args = [fp, 'audio'];
        runScript(script, args);
      });
      return;
    case 2:
      script = 'cortex-neural-cli.cjs';
      break;
    case 3:
      script = 'cortex-obsidian-cli.cjs';
      break;
    case 4:
      script = '../cortex/api-server.cjs';
      break;
    case 5:
      script = 'cortex-backup.cjs';
      args = ['backup'];
      break;
    case 6:
      script = 'cortex.cjs';
      args = ['status'];
      break;
    case 0:
      console.log(`\n${colors.magenta}Shutting down Cortex Console.${colors.reset}\n`);
      process.exit(0);
    default:
      console.log(`\n${colors.red}Invalid selection.${colors.reset}\n`);
      setTimeout(showMenu, 1000);
      return;
  }

  if (script) {
    runScript(script, args);
  }
}

function runScript(scriptName, args = []) {
  console.log(`\n${colors.dim}Executing ${scriptName}...${colors.reset}\n`);
  
  const scriptPath = path.join(CORTEX_BIN, scriptName);
  
  const child = spawn('node', [scriptPath, ...args], {
    stdio: 'inherit',
  });

  child.on('close', (code) => {
    rl.question(`\n${colors.yellow}Press ENTER to return to the main menu...${colors.reset}`, () => {
      showMenu();
    });
  });
}

showMenu();