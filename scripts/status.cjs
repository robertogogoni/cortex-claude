#!/usr/bin/env node
/**
 * Cortex Status Script (v1.1.0)
 * Shows the current status of Cortex - Claude's Cognitive Layer
 * Including adapter status and memory statistics
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CORTEX_DIR = process.env.CORTEX_DIR || path.join(os.homedir(), '.claude', 'memory');
const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatNumber(num) {
  return num.toLocaleString();
}

// =============================================================================
// STATUS CHECKS
// =============================================================================

async function showStatus() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     Cortex - Claude\'s Cognitive Layer - Status (v2.0.0)          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  // Check installation
  console.log('📁 Installation:');
  console.log(`   Location: ${CORTEX_DIR}`);
  console.log(`   Exists: ${fs.existsSync(CORTEX_DIR) ? '✅ Yes' : '❌ No'}`);
  console.log();

  // Check hooks
  console.log('🪝 Hooks:');
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const sessionStart = settings.hooks?.SessionStart?.some(h =>
      h.hooks?.some(hh => hh.command?.includes('memory/hooks/session-start'))
    );
    const sessionEnd = settings.hooks?.SessionEnd?.some(h =>
      h.hooks?.some(hh => hh.command?.includes('memory/hooks/session-end'))
    );

    console.log(`   SessionStart: ${sessionStart ? '✅ Registered' : '❌ Not registered'}`);
    console.log(`   SessionEnd: ${sessionEnd ? '✅ Registered' : '❌ Not registered'}`);
  } catch (e) {
    console.log('   ❌ Could not read settings.json');
  }
  console.log();

  // Check adapters
  console.log('🔌 Memory Adapters:');
  try {
    const { createDefaultRegistry } = require('../adapters/index.cjs');
    const registry = createDefaultRegistry({ basePath: CORTEX_DIR });
    const adapters = registry.getAll();

    for (const adapter of adapters) {
      const status = adapter.enabled ? '✅' : '⏸️';
      const priority = (adapter.priority * 100).toFixed(0) + '%';
      console.log(`   ${status} ${adapter.name} (priority: ${priority}, timeout: ${adapter.timeout}ms)`);
    }
  } catch (e) {
    console.log(`   ❌ Could not load adapters: ${e.message}`);
  }
  console.log();

  // Check data directories
  console.log('💾 Data Directories:');
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
    console.log(`   ${dir}: ${exists ? '✅' : '❌'}`);
  }
  console.log();

  // Check memory files with detailed stats
  console.log('📊 Memory Statistics:');
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

        const icon = lines > 0 ? '📄' : '📭';
        console.log(`   ${icon} ${file}: ${formatNumber(lines)} memories (${formatBytes(stat.size)})`);
      }

      // Skills
      const skillsPath = path.join(CORTEX_DIR, 'data', 'skills', 'index.jsonl');
      if (fs.existsSync(skillsPath)) {
        const skillContent = fs.readFileSync(skillsPath, 'utf8');
        const skillLines = skillContent.trim().split('\n').filter(l => l).length;
        const skillStat = fs.statSync(skillsPath);
        totalMemories += skillLines;
        totalSize += skillStat.size;
        console.log(`   📄 skills/index.jsonl: ${formatNumber(skillLines)} skills (${formatBytes(skillStat.size)})`);
      }

      console.log(`   ─────────────────────────────────`);
      console.log(`   📈 Total: ${formatNumber(totalMemories)} records (${formatBytes(totalSize)})`);

      if (totalMemories === 0) {
        console.log('   💡 Tip: Run bootstrap --seed to populate from CLAUDE.md');
      }
    } else {
      console.log('   ❌ Memories directory not created yet');
      console.log('   💡 Tip: Run bootstrap.cjs to initialize');
    }
  } catch (e) {
    console.log(`   ❌ Error reading memories: ${e.message}`);
  }
  console.log();

  // Check CLAUDE.md files (via adapter)
  console.log('📖 CLAUDE.md Sources:');
  try {
    // Default paths - users can add custom paths via adapter config
    const claudeMdPaths = [
      path.join(os.homedir(), '.claude', 'CLAUDE.md'),
      '.claude/CLAUDE.md',
      './CLAUDE.md',
    ];

    let found = 0;
    for (const p of claudeMdPaths) {
      const resolved = p.startsWith('~/')
        ? path.join(os.homedir(), p.slice(2))
        : p.startsWith('./')
          ? path.resolve(process.cwd(), p)
          : p;

      if (fs.existsSync(resolved)) {
        const stat = fs.statSync(resolved);
        console.log(`   ✅ ${p} (${formatBytes(stat.size)})`);
        found++;
      } else {
        console.log(`   ⏸️ ${p} (not found)`);
      }
    }

    if (found === 0) {
      console.log('   ⚠️ No CLAUDE.md files found');
    }
  } catch (e) {
    console.log(`   ❌ Error checking CLAUDE.md: ${e.message}`);
  }
  console.log();

  // Check MCP servers
  console.log('🌐 MCP Server Configuration:');
  try {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json');
    if (fs.existsSync(claudeJsonPath)) {
      const claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
      const mcpServers = claudeJson.mcpServers || {};

      // Check for memory-related MCP servers
      const memoryMcp = mcpServers['memory'];
      const episodicMcp = Object.keys(mcpServers).find(k =>
        k.includes('episodic') || mcpServers[k].command?.includes('episodic')
      );

      console.log(`   Memory MCP: ${memoryMcp ? '✅ Configured' : '❌ Not configured'}`);
      console.log(`   Episodic Memory: ${episodicMcp ? '✅ Configured' : '❌ Not configured'}`);

      if (!memoryMcp) {
        console.log('   💡 Tip: Add @modelcontextprotocol/server-memory to ~/.claude.json');
      }
    } else {
      console.log('   ❌ ~/.claude.json not found');
    }
  } catch (e) {
    console.log(`   ❌ Error checking MCP config: ${e.message}`);
  }
  console.log();

  // Check config
  console.log('⚙️  Configuration:');
  try {
    const configPath = path.join(CORTEX_DIR, 'data', 'configs', 'current.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log(`   Version: ${config.version || 'unknown'}`);
      console.log(`   Max slots: ${config.sessionStart?.slots?.maxTotal || 'N/A'}`);
      console.log(`   Quality threshold: ${config.sessionEnd?.qualityThreshold || 'N/A'}`);
      console.log(`   LADS evolution: ${config.ladsCore?.evolutionEnabled ? '✅ enabled' : '⏸️ disabled'}`);
    } else {
      console.log('   ⚠️ No custom configuration (using defaults)');
    }
  } catch (e) {
    console.log(`   ❌ Error: ${e.message}`);
  }
  console.log();

  // Overall status
  const coreInstalled = fs.existsSync(CORTEX_DIR);
  const adaptersOk = fs.existsSync(path.join(CORTEX_DIR, 'adapters', 'index.cjs'));
  const hasMemories = fs.existsSync(path.join(CORTEX_DIR, 'data', 'memories'));

  console.log('═'.repeat(62));
  if (coreInstalled && adaptersOk && hasMemories) {
    console.log('✅ Cortex v2.0.0 is installed and ready!');
    console.log('   Multi-source memory integration active.');
  } else if (coreInstalled) {
    console.log('⚠️ Cortex is partially installed.');
    if (!adaptersOk) console.log('   - Run bootstrap to complete adapter setup');
    if (!hasMemories) console.log('   - Run bootstrap --seed to initialize memories');
  } else {
    console.log('❌ Cortex needs to be installed.');
    console.log('   Run: node scripts/bootstrap.cjs --seed');
  }
}

// Run
showStatus().catch(console.error);
