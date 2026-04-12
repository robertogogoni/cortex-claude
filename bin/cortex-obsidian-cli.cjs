#!/usr/bin/env node
/**
 * Cortex CLI - Guided Memory Import, Processing & Obsidian Integration
 * 
 * Provides an interactive, guided workflow for:
 * 1. Importing memories from multiple sources
 * 2. Processing and enriching memory data
 * 3. Decoding and analyzing memory patterns
 * 4. Visualizing and displaying information
 * 5. Real Obsidian vault integration with live sync
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const readline = require('readline');

const { ObsidianVaultExporter } = require('../core/obsidian-vault.cjs');
const { AdapterRegistry, createDefaultRegistry } = require('../adapters/index.cjs');
const { expandPath } = require('../core/types.cjs');

// ANSI colors for CLI
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bgBlue: '\x1b[44m',
};

const CORTEX_HOME = expandPath('~/.claude/memory');
const OBSIDIAN_VAULT_PATH = expandPath('~/.obsidian-vault');
const SYNC_REPO = expandPath('~/claude-cross-machine-sync');

// =============================================================================
// CLI STATE
// =============================================================================

class CortexCLIState {
  constructor() {
    this.step = 0;
    this.importedRecords = [];
    this.processedRecords = [];
    this.entities = new Map();
    this.patterns = [];
    this.obsidianVaultPath = OBSIDIAN_VAULT_PATH;
    this.syncEnabled = true;
    this.verbose = false;
  }
}

// =============================================================================
// UTILITIES
// =============================================================================

function printHeader(text) {
  console.log(`${colors.bgBlue}${colors.bold}${text.padEnd(60)}${colors.reset}`);
}

function printSection(text) {
  console.log(`${colors.cyan}${colors.bold}${text}${colors.reset}`);
}

function printSuccess(text) {
  console.log(`${colors.green}✓ ${text}${colors.reset}`);
}

function printWarning(text) {
  console.log(`${colors.yellow}⚠ ${text}${colors.reset}`);
}

function printError(text) {
  console.log(`${colors.red}✗ ${text}${colors.reset}`);
}

function printInfo(text) {
  console.log(`${colors.dim}${text}${colors.reset}`);
}

function printProgress(current, total, label) {
  const percent = Math.round((current / total) * 100);
  const barLength = 30;
  const filled = Math.round((current / total) * barLength);
  const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
  console.log(`${colors.cyan}${bar} ${percent}% - ${label}${colors.reset}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// STEP 1: IMPORT
// =============================================================================

async function stepImport(state) {
  printHeader(' STEP 1: IMPORT MEMORIES ');
  console.log();

  const registry = createDefaultRegistry({
    basePath: CORTEX_HOME,
    verbose: state.verbose,
  });

  const adapters = registry.getEnabled();
  printSection(`Found ${adapters.length} enabled adapters:`);
  adapters.forEach(a => console.log(`  - ${a.name} (priority: ${a.priority})`));
  console.log();

  printSection('Collecting memories from all sources...');
  const context = { tags: [], intent: 'general', projectHash: null };
  const result = await registry.queryAll(context, { limit: 5000 });

  state.importedRecords = result.results;
  printSuccess(`Imported ${state.importedRecords.length} memories`);
  console.log();

  printSection('Source breakdown:');
  const bySource = {};
  state.importedRecords.forEach(r => {
    bySource[r._source] = (bySource[r._source] || 0) + 1;
  });
  Object.entries(bySource).forEach(([source, count]) => {
    console.log(`  ${colors.cyan}${source}${colors.reset}: ${count} records`);
  });
  console.log();

  state.step = 1;
  return state;
}

// =============================================================================
// STEP 2: PROCESS & ENRICH
// =============================================================================

async function stepProcess(state) {
  printHeader(' STEP 2: PROCESS & ENRICH ');
  console.log();

  printSection('Enriching memories with metadata...');
  
  const processed = [];
  const total = state.importedRecords.length;

  for (let i = 0; i < total; i++) {
    const record = state.importedRecords[i];
    
    // Enrich with additional metadata
    const enriched = {
      ...record,
      processedAt: new Date().toISOString(),
      entityCount: 0,
      connectionStrength: 0,
    };

    // Extract entities from content
    const entities = extractEntities(record);
    enriched.entityCount = entities.length;
    enriched.entities = entities;

    // Track entities globally
    entities.forEach(ent => {
      if (!state.entities.has(ent)) {
        state.entities.set(ent, { count: 0, records: [] });
      }
      state.entities.get(ent).count++;
      state.entities.get(ent).records.push(record.id);
    });

    processed.push(enriched);

    if (state.verbose && i % 100 === 0) {
      printProgress(i, total, `Processing (${i}/${total})`);
    }
  }

  state.processedRecords = processed;
  printSuccess(`Processed ${processed.length} memories`);
  printSuccess(`Extracted ${state.entities.size} unique entities`);
  console.log();

  printSection('Top entities by frequency:');
  const sortedEntities = Array.from(state.entities.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);
  
  sortedEntities.forEach(([entity, data], idx) => {
    console.log(`  ${idx + 1}. ${colors.magenta}${entity}${colors.reset} (${data.count} occurrences)`);
  });
  console.log();

  state.step = 2;
  return state;
}

// =============================================================================
// STEP 3: ANALYZE & DECODE
// =============================================================================

async function stepAnalyze(state) {
  printHeader(' STEP 3: ANALYZE & DECODE ');
  console.log();

  printSection('Analyzing memory patterns...');

  // Pattern detection
  const patterns = detectPatterns(state.processedRecords);
  state.patterns = patterns;

  printSuccess(`Detected ${patterns.length} significant patterns`);
  console.log();

  if (patterns.length > 0) {
    printSection('Key patterns found:');
    patterns.slice(0, 5).forEach((p, idx) => {
      console.log(`  ${idx + 1}. ${colors.yellow}${p.type}${colors.reset}: ${p.description}`);
      console.log(`     Confidence: ${p.confidence}, Records: ${p.recordCount}`);
    });
  }
  console.log();

  // Memory type distribution
  printSection('Memory type distribution:');
  const byType = {};
  state.processedRecords.forEach(r => {
    byType[r.type] = (byType[r.type] || 0) + 1;
  });
  Object.entries(byType).forEach(([type, count]) => {
    const percent = ((count / state.processedRecords.length) * 100).toFixed(1);
    console.log(`  ${colors.cyan}${type}${colors.reset}: ${count} (${percent}%)`);
  });
  console.log();

  // Temporal analysis
  printSection('Temporal distribution:');
  const dates = state.processedRecords
    .map(r => new Date(r.createdAt).toISOString().split('T')[0])
    .filter(Boolean);
  const uniqueDates = [...new Set(dates)].sort();
  console.log(`  Date range: ${colors.cyan}${uniqueDates[0] || 'N/A'}${colors.reset} to ${colors.cyan}${uniqueDates[uniqueDates.length - 1] || 'N/A'}${colors.reset}`);
  console.log(`  Unique dates with memories: ${uniqueDates.length}`);
  console.log();

  state.step = 3;
  return state;
}

// =============================================================================
// STEP 4: VISUALIZE
// =============================================================================

async function stepVisualize(state) {
  printHeader(' STEP 4: VISUALIZE ');
  console.log();

  printSection('Memory Network Summary:');
  console.log(`  Total Memories: ${state.processedRecords.length}`);
  console.log(`  Unique Entities: ${state.entities.size}`);
  console.log(`  Detected Patterns: ${state.patterns.length}`);
  console.log(`  Source Adapters: ${Object.keys(state.processedRecords.reduce((acc, r) => { acc[r._source] = true; return acc; }, {})).length}`);
  console.log();

  // Entity relationship graph (text-based)
  printSection('Entity Relationship Graph (top 10):');
  const topEntities = Array.from(state.entities.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  topEntities.forEach(([entity, data]) => {
    const connections = data.records.slice(0, 3).map(id => id.slice(0, 20) + '...');
    console.log(`  ${colors.magenta}${entity}${colors.reset}`);
    console.log(`    ↳ ${connections.join(' → ')}`);
  });
  console.log();

  // Confidence distribution
  printSection('Confidence Distribution:');
  const confidenceRanges = [
    { name: 'High (0.8-1.0)', count: 0 },
    { name: 'Medium (0.5-0.8)', count: 0 },
    { name: 'Low (0.0-0.5)', count: 0 },
  ];
  state.processedRecords.forEach(r => {
    const conf = r.extractionConfidence || 0.5;
    if (conf >= 0.8) confidenceRanges[0].count++;
    else if (conf >= 0.5) confidenceRanges[1].count++;
    else confidenceRanges[2].count++;
  });
  confidenceRanges.forEach(range => {
    const bar = '█'.repeat(Math.round(range.count / 50));
    console.log(`  ${range.name}: ${bar} (${range.count})`);
  });
  console.log();

  state.step = 4;
  return state;
}

// =============================================================================
// STEP 5: OBSIDIAN INTEGRATION
// =============================================================================

async function stepObsidian(state) {
  printHeader(' STEP 5: OBSIDIAN INTEGRATION ');
  console.log();

  // Check Obsidian installation
  const obsidianInstalled = checkObsidianInstalled();
  if (obsidianInstalled) {
    printSuccess('Obsidian detected on system');
  } else {
    printWarning('Obsidian not detected - vault will still be created');
  }
  console.log();

  // Create vault
  printSection('Creating Obsidian vault structure...');
  const exporter = new ObsidianVaultExporter({
    vaultPath: state.obsidianVaultPath,
    clean: true,
    rootFolder: 'Cortex Atlas',
  });

  const result = exporter.export(state.processedRecords);
  printSuccess(`Vault created: ${result.exportRoot}`);
  printSuccess(`Exported ${result.manifest.counts.records} records`);
  printSuccess(`Created ${result.manifest.counts.entities || state.entities.size} entity nodes`);
  console.log();

  // Create Obsidian plugin config if vault exists
  const cortexPluginConfig = {
    vaultPath: result.exportRoot,
    autoSync: state.syncEnabled,
    lastExport: new Date().toISOString(),
    recordCount: result.manifest.counts.records,
  };

  const pluginDir = path.join(result.exportRoot, '.cortex');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'config.json'),
    JSON.stringify(cortexPluginConfig, null, 2)
  );
  printSuccess('Cortex plugin config created');
  console.log();

  // Sync to cross-machine repo
  if (state.syncEnabled && fs.existsSync(SYNC_REPO)) {
    printSection('Syncing to cross-machine repository...');
    const syncPath = path.join(SYNC_REPO, 'universal/claude/memory/obsidian-export');
    fs.mkdirSync(syncPath, { recursive: true });
    
    // Copy manifest and key files
    fs.copyFileSync(
      path.join(result.exportRoot, 'manifest.json'),
      path.join(syncPath, 'manifest.json')
    );
    printSuccess('Synced to cross-machine repo');
    console.log();
  }

  // Create Obsidian workspace file
  const workspace = {
    workspace: {
      id: 'cortex-atlas',
      name: 'Cortex Atlas',
      tabs: [
        { type: 'graph', path: 'Cortex Atlas/00 Home.md' },
        { type: 'file', path: 'Cortex Atlas/00 Nodes' },
        { type: 'file', path: 'Cortex Atlas/10 Records' },
      ],
    },
  };
  
  fs.writeFileSync(
    path.join(result.exportRoot, 'cortex-atlas.workspace'),
    JSON.stringify(workspace, null, 2)
  );
  printSuccess('Workspace file created for Obsidian');
  console.log();

  state.step = 5;
  return state;
}

// =============================================================================
// STEP 6: ONGOING SYNC
// =============================================================================

async function stepSync(state) {
  printHeader(' STEP 6: ONGOING SYNC ');
  console.log();

  printSection('Setting up continuous sync...');

  // Create sync daemon script
  const syncScript = `#!/bin/bash
# Cortex-Obsidian Sync Daemon
# Runs every 5 minutes to sync new memories to Obsidian vault

CORTEX_HOME="${CORTEX_HOME}"
OBSIDIAN_VAULT="${state.obsidianVaultPath}"
SYNC_REPO="${SYNC_REPO}"

while true; do
  # Check for new memories
  NEW_COUNT=$(wc -l "$CORTEX_HOME/data/memories/working.jsonl" 2>/dev/null | cut -d' ' -f1)
  
  if [ "$NEW_COUNT" -gt 0 ]; then
    echo "Running Cortex export..."
    node "$CORTEX_HOME/bin/cortex.cjs" export-vault --vault-path "$OBSIDIAN_VAULT" --root-folder "Cortex Atlas"
    
    # Commit to sync repo
    cd "$SYNC_REPO"
    git add universal/claude/memory/
    git commit -m "[universal] Cortex Obsidian sync: $NEW_COUNT new memories"
    git push
  fi
  
  sleep 300
done
`;

  const daemonPath = path.join(CORTEX_HOME, 'scripts', 'obsidian-sync-daemon.sh');
  fs.mkdirSync(path.dirname(daemonPath), { recursive: true });
  fs.writeFileSync(daemonPath, syncScript);
  fs.chmodSync(daemonPath, 0o755);
  printSuccess(`Sync daemon created: ${daemonPath}`);
  console.log();

  // systemd service for Linux
  const platform = os.platform();
  if (platform === 'linux') {
    const systemdService = `[Unit]
Description=Cortex-Obsidian Sync Daemon
After=network.target

[Service]
Type=simple
ExecStart=${daemonPath}
Restart=always
RestartSec=60

[Install]
WantedBy=default.target
`;

    const systemdPath = path.join(CORTEX_HOME, 'scripts', 'obsidian-sync.service');
    fs.writeFileSync(systemdPath, systemdService);
    printSuccess('systemd service file created');
    printInfo('To install: systemctl --user link ' + systemdPath);
    console.log();
  }

  state.step = 6;
  return state;
}

// =============================================================================
// HELPERS
// =============================================================================

function extractEntities(record) {
  const entities = [];
  
  // Extract from tags
  if (record.tags) {
    record.tags.forEach(t => entities.push(`tag:${t}`));
  }
  
  // Extract from content (simple keyword extraction)
  const keywords = ['auth', 'api', 'database', 'test', 'deploy', 'config', 'error', 'fix'];
  const content = (record.content || '').toLowerCase();
  keywords.forEach(k => {
    if (content.includes(k)) entities.push(`concept:${k}`);
  });
  
  // Extract from type
  if (record.type) entities.push(`type:${record.type}`);
  
  // Extract from source
  if (record._source) entities.push(`source:${record._source}`);
  
  return entities;
}

function detectPatterns(records) {
  const patterns = [];
  
  // Pattern: Repeated debugging sessions
  const debugRecords = records.filter(r => 
    (r.intent === 'debugging') || 
    (r.content && r.content.toLowerCase().includes('debug'))
  );
  if (debugRecords.length > 3) {
    patterns.push({
      type: 'debugging-cycle',
      description: 'Repeated debugging sessions detected',
      confidence: 0.7 + (debugRecords.length / 100),
      recordCount: debugRecords.length,
    });
  }
  
  // Pattern: Learning progression
  const learningRecords = records.filter(r => r.type === 'learning');
  if (learningRecords.length > 5) {
    patterns.push({
      type: 'learning-acceleration',
      description: 'Active learning pattern with multiple insights',
      confidence: 0.6 + (learningRecords.length / 50),
      recordCount: learningRecords.length,
    });
  }
  
  // Pattern: Project focus
  const projectRecords = records.filter(r => r.projectHash);
  if (projectRecords.length > 10) {
    patterns.push({
      type: 'project-intensity',
      description: 'High focus on specific project(s)',
      confidence: 0.5 + (projectRecords.length / 100),
      recordCount: projectRecords.length,
    });
  }
  
  return patterns;
}

function checkObsidianInstalled() {
  // Check common Obsidian locations
  const paths = [
    '/usr/bin/obsidian',
    '/usr/local/bin/obsidian',
    '/opt/Obsidian/Obsidian',
    path.join(os.homedir(), '.local/bin/obsidian'),
  ];
  
  for (const p of paths) {
    if (fs.existsSync(p)) return true;
  }
  
  // Check if flatpak installed
  try {
    const { execSync } = require('child_process');
    execSync('flatpak list | grep -i obsidian', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// MAIN CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const state = new CortexCLIState();
  
  // Parse args
  if (args.includes('--verbose') || args.includes('-v')) {
    state.verbose = true;
  }
  if (args.includes('--no-sync')) {
    state.syncEnabled = false;
  }
  if (args.includes('--vault-path')) {
    const idx = args.indexOf('--vault-path');
    state.obsidianVaultPath = args[idx + 1] || OBSIDIAN_VAULT_PATH;
  }
  
  printHeader(' CORTEX OBSIDIAN INTEGRATION CLI ');
  console.log();
  printInfo('This CLI guides you through importing memories, processing them,');
  printInfo('analyzing patterns, and integrating with Obsidian for visualization.');
  console.log();
  
  try {
    await stepImport(state);
    await sleep(500);
    
    await stepProcess(state);
    await sleep(500);
    
    await stepAnalyze(state);
    await sleep(500);
    
    await stepVisualize(state);
    await sleep(500);
    
    await stepObsidian(state);
    await sleep(500);
    
    await stepSync(state);
    
    printHeader(' COMPLETE ');
    console.log();
    printSuccess('Cortex-Obsidian integration complete!');
    console.log();
    console.log('Next steps:');
    console.log(`  1. Open Obsidian and load vault: ${state.obsidianVaultPath}`);
    console.log(`  2. Install Obsidian plugins: Graph View, Dataview, Canvas`);
    console.log(`  3. Open Cortex Atlas workspace: ${path.join(state.obsidianVaultPath, 'Cortex Atlas', 'cortex-atlas.workspace')}`);
    console.log();
    
    if (state.syncEnabled) {
      printInfo('Continuous sync enabled. New memories will auto-export to Obsidian.');
    }
    
  } catch (error) {
    printError(`Error: ${error.message}`);
    if (state.verbose) {
      console.error(error);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { CortexCLIState, stepImport, stepProcess, stepAnalyze, stepVisualize, stepObsidian, stepSync };