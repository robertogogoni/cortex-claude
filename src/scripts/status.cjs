#!/usr/bin/env node
/**
 * Cortex Status Script (v3.0.0)
 * Shows the current status of Cortex — Claude's Cognitive Layer
 *
 * Checks: API key, hooks, adapters, memory stats, data health
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CORTEX_DIR = process.env.CORTEX_DIR || path.join(os.homedir(), '.claude', 'memory');
const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');

// =============================================================================
// HELPERS
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

function ok(msg) { return `  \x1b[32m✓\x1b[0m ${msg}`; }
function warn(msg) { return `  \x1b[33m!\x1b[0m ${msg}`; }
function fail(msg) { return `  \x1b[31m✗\x1b[0m ${msg}`; }
function dim(msg) { return `\x1b[2m${msg}\x1b[0m`; }
function bold(msg) { return `\x1b[1m${msg}\x1b[0m`; }

// =============================================================================
// STATUS CHECKS
// =============================================================================

async function showStatus() {
  const pkg = JSON.parse(fs.readFileSync(path.join(CORTEX_DIR, 'package.json'), 'utf8'));
  const version = pkg.version || '?.?.?';

  console.log('');
  console.log(`  ╭──────────────────────────────────────────────╮`);
  console.log(`  │  CORTEX v${version} — Claude's Cognitive Layer   │`);
  console.log(`  ╰──────────────────────────────────────────────╯`);
  console.log('');

  let issues = 0;

  // ─── API KEY ────────────────────────────────────────────────────────
  console.log(bold('  API Key'));
  try {
    const { getDiagnostics } = require('../core/api-key.cjs');
    const diag = getDiagnostics();
    if (diag.available) {
      console.log(ok(`Loaded from ${diag.source}`));
      console.log(`    Key: ${diag.keyPrefix}`);
    } else {
      console.log(fail('No API key found'));
      console.log(`    Add to ${diag.envFilePath}:`);
      console.log(`    ANTHROPIC_API_KEY=sk-ant-...`);
      issues++;
    }
  } catch (e) {
    console.log(fail(`API key module error: ${e.message}`));
    issues++;
  }
  console.log('');

  // ─── HOOKS ──────────────────────────────────────────────────────────
  console.log(bold('  Hooks'));
  const hookTypes = ['SessionStart', 'SessionEnd', 'Stop', 'PreCompact'];
  const hookFiles = {
    SessionStart: 'session-start',
    SessionEnd: 'session-end',
    Stop: 'stop-hook',
    PreCompact: 'pre-compact',
  };
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    for (const type of hookTypes) {
      const registered = settings.hooks?.[type]?.some(h =>
        h.hooks?.some(hh => hh.command?.includes(`memory/hooks/${hookFiles[type]}`))
      );
      if (registered) {
        console.log(ok(`${type}`));
      } else {
        console.log(fail(`${type} — not registered`));
        issues++;
      }
    }
  } catch (e) {
    console.log(fail(`Could not read settings.json: ${e.message}`));
    issues += hookTypes.length;
  }
  console.log('');

  // ─── ADAPTERS ───────────────────────────────────────────────────────
  console.log(bold('  Memory Adapters'));
  try {
    const { createDefaultRegistry } = require('../adapters/index.cjs');
    const registry = createDefaultRegistry({ basePath: CORTEX_DIR, verbose: false });
    const adapters = registry.getAll();

    for (const adapter of adapters) {
      const pct = Math.round(adapter.priority * 100);
      if (adapter.enabled) {
        console.log(ok(`${adapter.name} ${dim(`(${pct}%, ${adapter.timeout}ms)`)}`));
      } else {
        console.log(warn(`${adapter.name} ${dim('(disabled)')}`));
      }
    }
  } catch (e) {
    console.log(fail(`Could not load adapters: ${e.message}`));
    issues++;
  }
  console.log('');

  // ─── MEMORY STATS ──────────────────────────────────────────────────
  console.log(bold('  Memory Statistics'));
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
        console.log(`    ${file.padEnd(22)} ${String(lines).padStart(6)} records  ${formatBytes(stat.size).padStart(10)}`);
      }

      // Skills
      const skillsPath = path.join(CORTEX_DIR, 'data', 'skills', 'index.jsonl');
      if (fs.existsSync(skillsPath)) {
        const skillContent = fs.readFileSync(skillsPath, 'utf8');
        const skillLines = skillContent.trim().split('\n').filter(l => l).length;
        const skillStat = fs.statSync(skillsPath);
        totalMemories += skillLines;
        totalSize += skillStat.size;
        console.log(`    ${'skills/index.jsonl'.padEnd(22)} ${String(skillLines).padStart(6)} records  ${formatBytes(skillStat.size).padStart(10)}`);
      }

      console.log(`    ${'─'.repeat(44)}`);
      console.log(`    ${'TOTAL'.padEnd(22)} ${String(totalMemories).padStart(6)} records  ${formatBytes(totalSize).padStart(10)}`);
    } else {
      console.log(warn('Memories directory not created. Run: node scripts/bootstrap.cjs'));
      issues++;
    }
  } catch (e) {
    console.log(fail(`Error reading memories: ${e.message}`));
  }
  console.log('');

  // ─── EXTERNAL DATA SOURCES ──────────────────────────────────────────
  console.log(bold('  External Data Sources'));

  // Episodic memory DB
  const epDbPath = path.join(os.homedir(), '.config', 'superpowers', 'conversation-index', 'db.sqlite');
  if (fs.existsSync(epDbPath)) {
    const stat = fs.statSync(epDbPath);
    console.log(ok(`Episodic DB: ${formatBytes(stat.size)} ${dim(epDbPath)}`));
  } else {
    console.log(warn(`Episodic DB not found ${dim(epDbPath)}`));
  }

  // Knowledge graph
  try {
    const kgGlob = path.join(os.homedir(), '.npm', '_npx');
    if (fs.existsSync(kgGlob)) {
      const dirs = fs.readdirSync(kgGlob);
      let found = false;
      for (const dir of dirs) {
        const candidate = path.join(kgGlob, dir, 'node_modules', '@modelcontextprotocol', 'server-memory', 'dist', 'memory.jsonl');
        if (fs.existsSync(candidate)) {
          const stat = fs.statSync(candidate);
          console.log(ok(`Knowledge Graph: ${formatBytes(stat.size)} ${dim(candidate)}`));
          found = true;
          break;
        }
      }
      if (!found) console.log(warn('Knowledge Graph JSONL not found in npx cache'));
    }
  } catch { console.log(warn('Could not scan npx cache for knowledge graph')); }

  // Warp SQLite
  const warpPath = path.join(os.homedir(), '.local', 'state', 'warp-terminal', 'warp.sqlite');
  if (fs.existsSync(warpPath)) {
    const stat = fs.statSync(warpPath);
    console.log(ok(`Warp Terminal: ${formatBytes(stat.size)} ${dim(warpPath)}`));
  } else {
    console.log(dim('    Warp Terminal: not installed'));
  }

  // CLAUDE.md
  const claudeMd = path.join(os.homedir(), '.claude', 'CLAUDE.md');
  if (fs.existsSync(claudeMd)) {
    const stat = fs.statSync(claudeMd);
    console.log(ok(`CLAUDE.md: ${formatBytes(stat.size)} ${dim(claudeMd)}`));
  } else {
    console.log(warn('~/.claude/CLAUDE.md not found'));
  }

  // Gemini brain
  const geminiDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
  if (fs.existsSync(geminiDir)) {
    const sessions = fs.readdirSync(geminiDir).filter(f =>
      fs.statSync(path.join(geminiDir, f)).isDirectory()
    ).length;
    console.log(ok(`Gemini Brain: ${sessions} sessions ${dim(geminiDir)}`));
  } else {
    console.log(dim('    Gemini Brain: not installed'));
  }
  console.log('');

  // ─── MODELS ─────────────────────────────────────────────────────────
  console.log(bold('  Models'));
  try {
    // Read model constants from source
    const haikuSrc = fs.readFileSync(path.join(CORTEX_DIR, 'cortex', 'haiku-worker.cjs'), 'utf8');
    const sonnetSrc = fs.readFileSync(path.join(CORTEX_DIR, 'cortex', 'sonnet-thinker.cjs'), 'utf8');
    const haikuMatch = haikuSrc.match(/HAIKU_MODEL\s*=\s*'([^']+)'/);
    const sonnetMatch = sonnetSrc.match(/SONNET_MODEL\s*=\s*'([^']+)'/);
    console.log(`    Worker (Haiku):  ${haikuMatch ? haikuMatch[1] : 'unknown'}`);
    console.log(`    Thinker (Sonnet): ${sonnetMatch ? sonnetMatch[1] : 'unknown'}`);
    console.log(`    Embeddings:       all-MiniLM-L6-v2 (384 dims, local)`);
  } catch {
    console.log(warn('Could not read model configuration'));
  }
  console.log('');

  // ─── VERDICT ────────────────────────────────────────────────────────
  console.log('  ─'.repeat(24));
  if (issues === 0) {
    console.log(`  ${bold('\x1b[32mCortex v' + version + ' is fully operational.\x1b[0m')}`);
  } else {
    console.log(`  ${bold('\x1b[33mCortex has ' + issues + ' issue' + (issues > 1 ? 's' : '') + ' to fix.\x1b[0m')}`);
    console.log(`  Run: ${dim('npm run install-hooks')} to register missing hooks`);
  }
  console.log('');
}

showStatus().catch(console.error);
