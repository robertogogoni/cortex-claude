#!/usr/bin/env node
/**
 * Cortex Memory System - End-to-End Data Flow Test
 *
 * Tests the complete data flow of the Cortex memory system:
 * 1. SessionStart hook - context injection from adapters
 * 2. SessionEnd hook - extraction from mock transcripts
 * 3. Tier Promotion - working -> short-term -> long-term
 * 4. CLI commands - status and search
 *
 * Run: node tests/test-e2e-flow.cjs
 *
 * @version 1.0.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

const CORTEX_DIR = path.dirname(__dirname);
const TEST_DIR = path.join(os.tmpdir(), 'cortex-e2e-test-' + Date.now());
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const icons = {
  check: '\u2714',
  cross: '\u2718',
  warning: '\u26A0',
  info: '\u2139',
  arrow: '\u2192',
};

// =============================================================================
// TEST UTILITIES
// =============================================================================

function c(text, ...styles) {
  const codes = styles.map(s => COLORS[s] || '').join('');
  return `${codes}${text}${COLORS.reset}`;
}

function printHeader(title) {
  console.log();
  console.log(c('='.repeat(70), 'dim'));
  console.log(`  ${c(title, 'bold', 'cyan')}`);
  console.log(c('='.repeat(70), 'dim'));
  console.log();
}

function printSection(title) {
  console.log();
  console.log(c(`  ${title}`, 'bold'));
  console.log(c('  ' + '-'.repeat(50), 'dim'));
}

function printResult(name, passed, details = '') {
  const icon = passed ? c(icons.check, 'green') : c(icons.cross, 'red');
  const status = passed ? c('PASS', 'green') : c('FAIL', 'red');
  console.log(`    ${icon} ${name}: ${status}`);
  if (details) {
    console.log(c(`       ${details}`, 'dim'));
  }
}

function printWarning(message) {
  console.log(`    ${c(icons.warning, 'yellow')} ${c(message, 'yellow')}`);
}

function printInfo(message) {
  console.log(`    ${c(icons.info, 'blue')} ${message}`);
}

/**
 * Run a command and capture output
 * @param {string} command
 * @param {Object} options
 * @returns {{success: boolean, stdout: string, stderr: string, error?: Error}}
 */
function runCommand(command, options = {}) {
  try {
    const stdout = execSync(command, {
      encoding: 'utf8',
      cwd: options.cwd || CORTEX_DIR,
      timeout: options.timeout || 30000,
      env: { ...process.env, ...options.env },
      stdio: options.stdio || ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, stdout, stderr: '' };
  } catch (error) {
    return {
      success: false,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      error,
    };
  }
}

/**
 * Run a command with stdin input
 * @param {string} command
 * @param {string} stdin
 * @param {Object} options
 * @returns {Promise<{success: boolean, stdout: string, stderr: string}>}
 */
function runCommandWithStdin(command, stdin, options = {}) {
  return new Promise((resolve) => {
    const args = command.split(' ');
    const proc = spawn(args[0], args.slice(1), {
      cwd: options.cwd || CORTEX_DIR,
      env: { ...process.env, ...options.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      resolve({ success: code === 0, stdout, stderr, code });
    });

    proc.on('error', (error) => {
      resolve({ success: false, stdout, stderr, error: error.message });
    });

    // Write stdin and close
    proc.stdin.write(stdin);
    proc.stdin.end();

    // Timeout
    setTimeout(() => {
      proc.kill();
      resolve({ success: false, stdout, stderr, error: 'Timeout' });
    }, options.timeout || 30000);
  });
}

function setup() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'memories'), { recursive: true });
}

function cleanup() {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// TEST 1: SESSION START HOOK
// =============================================================================

async function testSessionStart() {
  printSection('1. SessionStart Hook');

  const results = {
    hookRuns: false,
    outputsValidJson: false,
    hasInjectionField: false,
    adaptersQueried: [],
    adapterResults: {},
  };

  // Run the session-start hook
  printInfo('Running hooks/session-start.cjs...');

  const hookPath = path.join(CORTEX_DIR, 'hooks', 'session-start.cjs');

  if (!fs.existsSync(hookPath)) {
    printResult('session-start.cjs exists', false, 'File not found');
    return results;
  }

  const envVars = {
    CORTEX_WORKING_DIR: CORTEX_DIR,
    CORTEX_SESSION_ID: 'test-session-' + Date.now(),
    CORTEX_PROMPT: 'test query about memory system',
    CORTEX_COMPACT: 'true',  // Suppress progress display
  };

  const { success, stdout, stderr } = runCommand(`node ${hookPath} --compact`, { env: envVars });

  results.hookRuns = true;  // It ran (even if it failed)

  // Check if output is valid JSON
  let output;
  try {
    // The hook outputs JSON to stdout
    output = JSON.parse(stdout);
    results.outputsValidJson = true;
    printResult('Hook outputs valid JSON', true);
  } catch (error) {
    results.outputsValidJson = false;
    printResult('Hook outputs valid JSON', false, `Parse error: ${error.message}`);
    if (stderr) {
      printWarning(`stderr: ${stderr.slice(0, 200)}`);
    }
    printInfo(`stdout sample: ${stdout.slice(0, 300)}`);
    return results;
  }

  // Check for injection field (new format: hookSpecificOutput.additionalContext)
  const additionalContext = output.hookSpecificOutput?.additionalContext;
  results.hasInjectionField = !!additionalContext && additionalContext.length > 0;
  printResult('Has additionalContext', results.hasInjectionField,
    results.hasInjectionField ? `Length: ${additionalContext?.length || 0} chars` : 'Missing');

  // Check success/enabled status (new format: _cortex object)
  const cortex = output._cortex || {};
  const hookSuccess = cortex.success === true;
  const hookEnabled = cortex.enabled === true;
  printResult('Hook success status', hookSuccess, cortex.success === false ? `Error: ${cortex.error}` : '');
  printResult('Hook enabled', hookEnabled, !hookEnabled && cortex.stats?.reason ? cortex.stats.reason : '');

  // Check adapter results from stats (new format: _cortex.stats)
  if (cortex.stats?.bySource) {
    printInfo('Adapters queried:');
    for (const [source, count] of Object.entries(cortex.stats.bySource)) {
      results.adaptersQueried.push(source);
      results.adapterResults[source] = count;
      console.log(c(`       - ${source}: ${count} records`, 'dim'));
    }
  } else {
    printWarning('No adapter stats in output (bySource missing)');
  }

  // Summary stats
  if (cortex.stats) {
    printInfo(`Total memories queried: ${cortex.stats.memoriesQueried || 0}`);
    printInfo(`Total memories selected: ${cortex.stats.memoriesSelected || 0}`);
    printInfo(`Estimated tokens: ${cortex.stats.estimatedTokens || 0}`);
    printInfo(`Duration: ${cortex.stats.duration || 0}ms`);
  }

  // Check which adapters actually returned data
  // Note: Adapter sources may have format like "jsonl:working", "jsonl:long-term", "gemini", "warp-sqlite"
  printInfo('Adapter availability summary:');
  const adapterPrefixes = ['jsonl', 'claudemd', 'episodic-memory', 'knowledge-graph', 'gemini', 'warp'];
  for (const prefix of adapterPrefixes) {
    // Check if any source starts with this prefix (e.g., "jsonl:working" starts with "jsonl")
    const matchingSources = results.adaptersQueried.filter(s => s.startsWith(prefix) || s === prefix);
    const totalCount = matchingSources.reduce((sum, s) => sum + (results.adapterResults[s] || 0), 0);
    if (matchingSources.length > 0) {
      const sources = matchingSources.map(s => `${s}:${results.adapterResults[s]}`).join(', ');
      console.log(c(`       ${icons.check} ${prefix}: ${totalCount} records (${sources})`, 'green'));
    } else {
      console.log(c(`       ${icons.cross} ${prefix}: not queried or no results`, 'dim'));
    }
  }

  return results;
}

// =============================================================================
// TEST 2: SESSION END HOOK (Extraction)
// =============================================================================

async function testSessionEnd() {
  printSection('2. SessionEnd Hook (Extraction)');

  const results = {
    hookRuns: false,
    outputsValidJson: false,
    extractedCount: 0,
    extractionTypes: [],
    savedToWorking: false,
  };

  // Create a mock transcript with extractable content
  const mockTranscriptPath = path.join(TEST_DIR, 'mock-transcript.jsonl');
  const mockMessages = [
    {
      role: 'user',
      content: 'How do I fix the git error "fatal: refusing to merge unrelated histories"?'
    },
    {
      role: 'assistant',
      content: `To fix the "fatal: refusing to merge unrelated histories" error, here's how you can solve it:

**The command to use:**
\`\`\`bash
git pull origin main --allow-unrelated-histories
\`\`\`

**Important note:** This error happens when you try to merge two repositories that don't share a common ancestor. The \`--allow-unrelated-histories\` flag tells git to proceed anyway.

**Gotcha:** Be careful with this - it can lead to duplicate files if both repos have files with the same name. Always review the merge carefully.

The reason this error occurs is that Git 2.9+ is stricter about merging repositories without common history. This is a safety feature.

**Best practice pattern:** Whenever you create a new repo on GitHub with a README, then try to push an existing local repo, you'll hit this. The solution is to either:
1. Use --allow-unrelated-histories
2. Or don't initialize the remote repo with any files

I decided to use the flag approach because it's simpler for one-time merges.`
    },
    {
      role: 'user',
      content: 'That worked perfectly, thanks!'
    },
    {
      role: 'assistant',
      content: 'Great! Glad it worked. Remember: this is a common git issue when mixing local and remote repos that were initialized separately.'
    },
  ];

  // Write mock transcript
  const transcriptContent = mockMessages.map(m => JSON.stringify(m)).join('\n');
  fs.writeFileSync(mockTranscriptPath, transcriptContent);
  printInfo(`Created mock transcript at: ${mockTranscriptPath}`);
  printInfo(`Transcript has ${mockMessages.length} messages`);

  // Check if hook exists
  const hookPath = path.join(CORTEX_DIR, 'hooks', 'session-end.cjs');
  if (!fs.existsSync(hookPath)) {
    printResult('session-end.cjs exists', false, 'File not found');
    return results;
  }

  // Prepare stdin JSON
  const stdinJson = JSON.stringify({
    session_id: 'test-extraction-' + Date.now(),
    transcript_path: mockTranscriptPath,
    cwd: CORTEX_DIR,
    hook_event_name: 'SessionEnd',
    reason: 'test',
  });

  printInfo('Running hooks/session-end.cjs with mock transcript...');

  const { success, stdout, stderr, code } = await runCommandWithStdin(
    `node ${hookPath}`,
    stdinJson,
    { env: { CORTEX_DEBUG: 'false' } }
  );

  results.hookRuns = true;

  // Parse output
  let output;
  try {
    output = JSON.parse(stdout);
    results.outputsValidJson = true;
    printResult('Hook outputs valid JSON', true);
  } catch (error) {
    results.outputsValidJson = false;
    printResult('Hook outputs valid JSON', false, `Parse error: ${error.message}`);
    if (stderr) {
      printWarning(`stderr: ${stderr.slice(0, 300)}`);
    }
    printInfo(`stdout sample: ${stdout.slice(0, 400)}`);
    return results;
  }

  // Check success status
  const hookSuccess = output.success === true;
  const hookEnabled = output.enabled === true;
  printResult('Hook success status', hookSuccess, output.success === false ? `Error: ${output.error}` : '');
  printResult('Hook enabled', hookEnabled, !hookEnabled && output.stats?.reason ? output.stats.reason : '');

  // Check extractions
  if (output.extracted && Array.isArray(output.extracted)) {
    results.extractedCount = output.extracted.length;
    printResult('Extractions found', results.extractedCount > 0,
      `${results.extractedCount} memories extracted`);

    // Get unique types
    const types = new Set(output.extracted.map(e => e.type));
    results.extractionTypes = [...types];
    printInfo(`Extraction types: ${results.extractionTypes.join(', ') || 'none'}`);

    // Show sample extractions
    if (output.extracted.length > 0) {
      printInfo('Sample extractions:');
      for (const ext of output.extracted.slice(0, 3)) {
        const summary = (ext.summary || ext.content || '').slice(0, 60);
        console.log(c(`       - [${ext.type}] ${summary}...`, 'dim'));
      }
    }
  } else {
    printResult('Extractions found', false, 'No extracted array in output');
  }

  // Check stats
  if (output.stats) {
    printInfo(`Messages processed: ${output.stats.messageCount || 0}`);
    printInfo(`Candidates found: ${output.stats.candidatesFound || 0}`);
    printInfo(`After dedup: ${output.stats.afterDedup || 0}`);
    printInfo(`Persisted: ${output.stats.persisted || 0}`);
    printInfo(`Duration: ${output.stats.duration || 0}ms`);
  }

  // Check if extractions were saved to working memory
  const workingPath = path.join(CORTEX_DIR, 'data', 'memories', 'working.jsonl');
  if (fs.existsSync(workingPath)) {
    const workingContent = fs.readFileSync(workingPath, 'utf8');
    const workingLines = workingContent.trim().split('\n').filter(l => l);
    printInfo(`Working memory now has: ${workingLines.length} records`);
    results.savedToWorking = output.stats?.persisted > 0 || workingLines.length > 0;
    printResult('Saved to working.jsonl', results.savedToWorking);
  } else {
    printWarning('working.jsonl does not exist yet');
  }

  return results;
}

// =============================================================================
// TEST 3: TIER PROMOTION
// =============================================================================

async function testTierPromotion() {
  printSection('3. Tier Promotion');

  const results = {
    storesLoad: false,
    workingRecords: 0,
    shortTermRecords: 0,
    longTermRecords: 0,
    promotionWorks: false,
  };

  // First, check if we can load the stores
  try {
    const { JSONLStore } = require(path.join(CORTEX_DIR, 'core', 'storage.cjs'));
    const { getTimestamp } = require(path.join(CORTEX_DIR, 'core', 'types.cjs'));

    const workingPath = path.join(CORTEX_DIR, 'data', 'memories', 'working.jsonl');
    const shortTermPath = path.join(CORTEX_DIR, 'data', 'memories', 'short-term.jsonl');
    const longTermPath = path.join(CORTEX_DIR, 'data', 'memories', 'long-term.jsonl');

    // Load stores
    const workingStore = new JSONLStore(workingPath);
    const shortTermStore = new JSONLStore(shortTermPath);
    const longTermStore = new JSONLStore(longTermPath);

    await Promise.all([
      workingStore.load(),
      shortTermStore.load(),
      longTermStore.load(),
    ]);

    results.storesLoad = true;
    printResult('Storage modules load', true);

    // Get current counts
    results.workingRecords = workingStore.getAll().length;
    results.shortTermRecords = shortTermStore.getAll().length;
    results.longTermRecords = longTermStore.getAll().length;

    printInfo(`Current state:`);
    printInfo(`  Working: ${results.workingRecords} records`);
    printInfo(`  Short-term: ${results.shortTermRecords} records`);
    printInfo(`  Long-term: ${results.longTermRecords} records`);

    // Add test records with old timestamps to working memory for promotion testing
    printInfo('Adding test records with old timestamps...');

    const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
    const testRecord = {
      id: 'test-promotion-' + Date.now(),
      type: 'insight',
      content: 'Test record for tier promotion e2e test',
      summary: 'Test tier promotion',
      createdAt: oldTimestamp,
      status: 'active',
    };

    await workingStore.append(testRecord);
    printInfo(`Added test record with timestamp: ${oldTimestamp}`);

    // Now run the promote command with --dry-run
    const { success, stdout, stderr } = runCommand(
      `node ${path.join(CORTEX_DIR, 'bin', 'cortex.cjs')} promote --dry-run`,
      { timeout: 60000 }
    );

    if (success) {
      printResult('Promote command (dry-run)', true);
      results.promotionWorks = true;

      // Check if it found records to promote
      if (stdout.includes('would be promoted') || stdout.includes('records promoted')) {
        printInfo('Promotion logic is working');
      }
      if (stdout.includes('No records ready')) {
        printInfo('No records met promotion criteria (this is OK if working memory is new)');
      }
    } else {
      printResult('Promote command (dry-run)', false, stderr.slice(0, 200));
    }

    // Show a snippet of output
    if (stdout) {
      const lines = stdout.split('\n').filter(l => l.trim()).slice(0, 10);
      for (const line of lines) {
        console.log(c(`       ${line}`, 'dim'));
      }
    }

  } catch (error) {
    results.storesLoad = false;
    printResult('Storage modules load', false, error.message);
  }

  return results;
}

// =============================================================================
// TEST 4: CLI COMMANDS
// =============================================================================

async function testCLI() {
  printSection('4. CLI Commands');

  const results = {
    statusWorks: false,
    searchWorks: false,
    statusOutput: '',
    searchOutput: '',
  };

  const cliPath = path.join(CORTEX_DIR, 'bin', 'cortex.cjs');

  if (!fs.existsSync(cliPath)) {
    printResult('cortex.cjs exists', false, 'File not found');
    return results;
  }

  // Test status command
  printInfo('Running: node bin/cortex.cjs status');
  const statusResult = runCommand(`node ${cliPath} status`, { timeout: 30000 });

  if (statusResult.success) {
    results.statusWorks = true;
    results.statusOutput = statusResult.stdout;
    printResult('status command', true);

    // Check for expected sections in output
    const hasInstallation = statusResult.stdout.includes('Installation');
    const hasHooks = statusResult.stdout.includes('Hooks');
    const hasAdapters = statusResult.stdout.includes('Adapters') || statusResult.stdout.includes('adapters');
    const hasMemories = statusResult.stdout.includes('Memor') || statusResult.stdout.includes('records');

    printInfo(`  Has Installation section: ${hasInstallation ? 'yes' : 'no'}`);
    printInfo(`  Has Hooks section: ${hasHooks ? 'yes' : 'no'}`);
    printInfo(`  Has Adapters section: ${hasAdapters ? 'yes' : 'no'}`);
    printInfo(`  Has Memory stats: ${hasMemories ? 'yes' : 'no'}`);

    // Show snippet of status output
    const lines = statusResult.stdout.split('\n').slice(0, 15);
    for (const line of lines) {
      if (line.trim()) {
        console.log(c(`       ${line}`, 'dim'));
      }
    }
  } else {
    results.statusWorks = false;
    printResult('status command', false, statusResult.stderr?.slice(0, 200) || 'No output');
  }

  // Test search command
  printInfo('Running: node bin/cortex.cjs search "test"');
  const searchResult = runCommand(`node ${cliPath} search "test"`, { timeout: 30000 });

  if (searchResult.success || searchResult.stdout.includes('Search') || searchResult.stdout.includes('Results')) {
    results.searchWorks = true;
    results.searchOutput = searchResult.stdout;
    printResult('search command', true);

    // Check search output
    const hasQuery = searchResult.stdout.includes('Query:') || searchResult.stdout.includes('test');
    const hasResults = searchResult.stdout.includes('Results') || searchResult.stdout.includes('matching');

    printInfo(`  Shows query: ${hasQuery ? 'yes' : 'no'}`);
    printInfo(`  Shows results section: ${hasResults ? 'yes' : 'no'}`);

    // Show snippet
    const lines = searchResult.stdout.split('\n').slice(0, 10);
    for (const line of lines) {
      if (line.trim()) {
        console.log(c(`       ${line}`, 'dim'));
      }
    }
  } else {
    results.searchWorks = false;
    printResult('search command', false, searchResult.stderr?.slice(0, 200) || 'No output');
  }

  return results;
}

// =============================================================================
// TEST 5: ADAPTER HEALTH CHECK
// =============================================================================

async function testAdapterHealth() {
  printSection('5. Adapter Health Check');

  const results = {
    adaptersLoaded: false,
    adapterStatus: {},
  };

  try {
    const { createDefaultRegistry } = require(path.join(CORTEX_DIR, 'adapters', 'index.cjs'));

    const registry = createDefaultRegistry({
      basePath: CORTEX_DIR,
      verbose: false,
    });

    results.adaptersLoaded = true;
    printResult('Adapter registry loads', true);

    const adapters = registry.getAll();
    printInfo(`Registered adapters: ${adapters.length}`);

    for (const adapter of adapters) {
      const status = {
        name: adapter.name,
        enabled: adapter.enabled,
        priority: adapter.priority,
        canQuery: false,
        error: null,
      };

      // Try to get stats or query
      try {
        const stats = await adapter.getStats?.();
        status.canQuery = true;
        status.stats = stats;
      } catch (error) {
        status.error = error.message;
      }

      results.adapterStatus[adapter.name] = status;

      const icon = status.enabled ? (status.canQuery ? icons.check : icons.warning) : '-';
      const color = status.enabled ? (status.canQuery ? 'green' : 'yellow') : 'dim';
      const enabledStr = status.enabled ? 'enabled' : 'disabled';
      const errorStr = status.error ? ` (${status.error.slice(0, 40)})` : '';

      console.log(c(`    ${icon} ${adapter.name}: ${enabledStr}, priority ${(adapter.priority * 100).toFixed(0)}%${errorStr}`, color));
    }

  } catch (error) {
    results.adaptersLoaded = false;
    printResult('Adapter registry loads', false, error.message);
  }

  return results;
}

// =============================================================================
// SUMMARY
// =============================================================================

function printSummary(allResults) {
  printHeader('Test Summary');

  const tests = [
    { name: 'SessionStart Hook', results: allResults.sessionStart },
    { name: 'SessionEnd Hook', results: allResults.sessionEnd },
    { name: 'Tier Promotion', results: allResults.tierPromotion },
    { name: 'CLI Commands', results: allResults.cli },
    { name: 'Adapter Health', results: allResults.adapters },
  ];

  let totalPassed = 0;
  let totalFailed = 0;
  const issues = [];

  for (const test of tests) {
    const r = test.results;
    let passed = true;
    let failReason = '';

    switch (test.name) {
      case 'SessionStart Hook':
        passed = r.hookRuns && r.outputsValidJson && r.hasInjectionField;
        if (!passed) failReason = !r.outputsValidJson ? 'Invalid JSON' : 'Missing injection';
        if (r.adaptersQueried.length === 0) {
          issues.push('SessionStart: No adapters returned data');
        }
        break;
      case 'SessionEnd Hook':
        passed = r.hookRuns && r.outputsValidJson;
        if (!passed) failReason = !r.outputsValidJson ? 'Invalid JSON' : 'Hook failed';
        if (r.extractedCount === 0) {
          issues.push('SessionEnd: No extractions from mock transcript');
        }
        break;
      case 'Tier Promotion':
        passed = r.storesLoad && r.promotionWorks;
        if (!passed) failReason = !r.storesLoad ? 'Storage failed' : 'Promotion failed';
        break;
      case 'CLI Commands':
        passed = r.statusWorks;
        if (!passed) failReason = 'Status command failed';
        if (!r.searchWorks) {
          issues.push('CLI: Search command not fully working');
        }
        break;
      case 'Adapter Health':
        passed = r.adaptersLoaded;
        if (!passed) failReason = 'Adapters failed to load';
        // Check for adapters with errors
        for (const [name, status] of Object.entries(r.adapterStatus || {})) {
          if (status.enabled && status.error) {
            issues.push(`Adapter ${name}: ${status.error.slice(0, 50)}`);
          }
        }
        break;
    }

    if (passed) {
      totalPassed++;
      console.log(`  ${c(icons.check, 'green')} ${test.name}: ${c('WORKING', 'green')}`);
    } else {
      totalFailed++;
      console.log(`  ${c(icons.cross, 'red')} ${test.name}: ${c('BROKEN', 'red')} - ${failReason}`);
    }
  }

  console.log();
  console.log(c('  ' + '-'.repeat(50), 'dim'));
  console.log(`  Total: ${c(totalPassed + '/' + tests.length, totalFailed === 0 ? 'green' : 'yellow')} tests passing`);

  if (issues.length > 0) {
    console.log();
    console.log(c('  Known Issues:', 'yellow'));
    for (const issue of issues) {
      console.log(`    ${c(icons.warning, 'yellow')} ${issue}`);
    }
  }

  // Overall verdict
  console.log();
  console.log(c('='.repeat(70), 'dim'));
  if (totalFailed === 0 && issues.length === 0) {
    console.log(`  ${c('All systems operational!', 'green', 'bold')}`);
  } else if (totalFailed === 0) {
    console.log(`  ${c('Core systems working, but some issues detected.', 'yellow', 'bold')}`);
  } else {
    console.log(`  ${c('Some core systems are broken. See details above.', 'red', 'bold')}`);
  }
  console.log();

  return { passed: totalPassed, failed: totalFailed, issues };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  printHeader('Cortex Memory System - End-to-End Test');

  console.log(`  ${c('Base path:', 'bold')} ${CORTEX_DIR}`);
  console.log(`  ${c('Test dir:', 'bold')} ${TEST_DIR}`);
  console.log(`  ${c('Node:', 'bold')} ${process.version}`);
  console.log(`  ${c('Platform:', 'bold')} ${process.platform}`);

  setup();

  const allResults = {
    sessionStart: null,
    sessionEnd: null,
    tierPromotion: null,
    cli: null,
    adapters: null,
  };

  try {
    // Run all tests
    allResults.sessionStart = await testSessionStart();
    allResults.sessionEnd = await testSessionEnd();
    allResults.tierPromotion = await testTierPromotion();
    allResults.cli = await testCLI();
    allResults.adapters = await testAdapterHealth();

  } catch (error) {
    console.error(`\n${c('Test runner error:', 'red')} ${error.message}`);
    console.error(error.stack);
  } finally {
    cleanup();
  }

  // Print summary
  const { passed, failed } = printSummary(allResults);

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
main().catch(error => {
  console.error('Fatal error:', error);
  cleanup();
  process.exit(1);
});
