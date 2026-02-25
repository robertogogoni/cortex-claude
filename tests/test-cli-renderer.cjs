#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (e) {
    console.log(`  \u2717 ${name}: ${e.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (e) {
    console.log(`  \u2717 ${name}: ${e.message}`);
    failed++;
  }
}

// =========================================================================
// Import
// =========================================================================

const { CortexRenderer } = require('../hooks/cli-renderer.cjs');

// =========================================================================
// Static Helpers
// =========================================================================

console.log('\n  CortexRenderer \u2014 Static Helpers\n');

// --- gradient ---

test('gradient returns plain text when noColor is true', () => {
  const result = CortexRenderer.gradient('HELLO', [0, 200, 255], [120, 80, 255], true);
  assert.strictEqual(result, 'HELLO\x1b[0m');
});

test('gradient contains ANSI true-color sequences when color enabled', () => {
  const result = CortexRenderer.gradient('AB', [0, 200, 255], [120, 80, 255], false);
  // Should contain \x1b[38;2; sequences
  assert.ok(result.includes('\x1b[38;2;'), 'Should contain true-color escape');
  // First char should be cyan-ish (0, 200, 255)
  assert.ok(result.includes('\x1b[38;2;0;200;255m'), 'First char should be [0,200,255]');
  // Last char should be purple-ish (120, 80, 255)
  assert.ok(result.includes('\x1b[38;2;120;80;255m'), 'Last char should be [120,80,255]');
});

test('gradient handles single character', () => {
  const result = CortexRenderer.gradient('X', [0, 0, 0], [255, 255, 255], false);
  assert.ok(result.includes('X'));
  assert.ok(result.includes('\x1b[38;2;0;0;0m'), 'Single char uses from color');
});

test('gradient handles empty string', () => {
  const result = CortexRenderer.gradient('', [0, 0, 0], [255, 255, 255], false);
  assert.strictEqual(result, '\x1b[0m');
});

// --- formatTime ---

test('formatTime formats milliseconds < 1000', () => {
  assert.strictEqual(CortexRenderer.formatTime(300), '0.3s');
  assert.strictEqual(CortexRenderer.formatTime(95), '0.1s');
  assert.strictEqual(CortexRenderer.formatTime(0), '0.0s');
});

test('formatTime formats seconds', () => {
  assert.strictEqual(CortexRenderer.formatTime(1500), '1.5s');
  assert.strictEqual(CortexRenderer.formatTime(2300), '2.3s');
  assert.strictEqual(CortexRenderer.formatTime(59900), '59.9s');
});

test('formatTime formats minutes + seconds', () => {
  assert.strictEqual(CortexRenderer.formatTime(60000), '1m 0s');
  assert.strictEqual(CortexRenderer.formatTime(125000), '2m 5s');
});

// --- progressBar ---

test('progressBar at 0% returns all empty', () => {
  const bar = CortexRenderer.progressBar(0, 100, 10, true);
  // Should have 10 \u2591 chars
  assert.strictEqual((bar.match(/\u2591/g) || []).length, 10);
  assert.strictEqual((bar.match(/\u2588/g) || []).length, 0);
});

test('progressBar at 100% returns all filled', () => {
  const bar = CortexRenderer.progressBar(100, 100, 10, true);
  assert.strictEqual((bar.match(/\u2588/g) || []).length, 10);
  assert.strictEqual((bar.match(/\u2591/g) || []).length, 0);
});

test('progressBar at 50% returns half filled', () => {
  const bar = CortexRenderer.progressBar(50, 100, 10, true);
  assert.strictEqual((bar.match(/\u2588/g) || []).length, 5);
  assert.strictEqual((bar.match(/\u2591/g) || []).length, 5);
});

test('progressBar handles value > max (clamps to 100%)', () => {
  const bar = CortexRenderer.progressBar(200, 100, 10, true);
  assert.strictEqual((bar.match(/\u2588/g) || []).length, 10);
});

test('progressBar handles max = 0 (all empty)', () => {
  const bar = CortexRenderer.progressBar(0, 0, 10, true);
  assert.strictEqual((bar.match(/\u2591/g) || []).length, 10);
});

test('progressBar noColor uses ASCII', () => {
  const bar = CortexRenderer.progressBar(50, 100, 10, false);
  assert.ok(bar.includes('#'), 'Should use # for filled in noColor');
  assert.ok(bar.includes('.'), 'Should use . for empty in noColor');
  assert.ok(!bar.includes('\x1b'), 'No ANSI in noColor mode');
});

// --- formatTokenBudget ---

test('formatTokenBudget shows used/total with bar', () => {
  const result = CortexRenderer.formatTokenBudget(1545, 4000, 12, true);
  assert.ok(result.includes('1,545'), 'Should format used with commas');
  assert.ok(result.includes('4,000'), 'Should format total with commas');
  assert.ok(result.includes('tokens'), 'Should include "tokens" label');
});

test('formatTokenBudget green when < 70%', () => {
  const result = CortexRenderer.formatTokenBudget(500, 4000, 12, true);
  // 500/4000 = 12.5% -> should use green (\x1b[32m)
  assert.ok(result.includes('\x1b[32m'), 'Should be green under 70%');
});

test('formatTokenBudget yellow when 70-90%', () => {
  const result = CortexRenderer.formatTokenBudget(3200, 4000, 12, true);
  // 3200/4000 = 80% -> should use yellow (\x1b[33m)
  assert.ok(result.includes('\x1b[33m'), 'Should be yellow at 70-90%');
});

test('formatTokenBudget red when > 90%', () => {
  const result = CortexRenderer.formatTokenBudget(3800, 4000, 12, true);
  // 3800/4000 = 95% -> should use red (\x1b[31m)
  assert.ok(result.includes('\x1b[31m'), 'Should be red over 90%');
});

test('formatTokenBudget noColor mode has no ANSI', () => {
  const result = CortexRenderer.formatTokenBudget(1545, 4000, 12, false);
  assert.ok(!result.includes('\x1b'), 'No ANSI in noColor');
  assert.ok(result.includes('1,545'), 'Still shows numbers');
  assert.ok(result.includes('['), 'Uses ASCII bar brackets');
});

// --- stripAnsi ---

test('stripAnsi removes all ANSI codes', () => {
  const input = '\x1b[32m\u2713\x1b[0m hello \x1b[38;2;0;200;255mworld\x1b[0m';
  const result = CortexRenderer.stripAnsi(input);
  assert.strictEqual(result, '\u2713 hello world');
});

// =========================================================================
// Version
// =========================================================================

console.log('\n  CortexRenderer \u2014 Version\n');

test('version is read from package.json', () => {
  const pkg = JSON.parse(require('fs').readFileSync(
    path.join(__dirname, '..', 'package.json'), 'utf8'
  ));
  const renderer = new CortexRenderer({ stream: new (require('stream').Writable)({ write() {} }) });
  assert.strictEqual(renderer.version, pkg.version);
});

// =========================================================================
// Instance Methods
// =========================================================================

const { Writable } = require('stream');

function createCapture() {
  let output = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      output += chunk.toString();
      cb();
    },
  });
  stream.columns = 100;  // Simulate 100-col terminal
  stream.isTTY = true;
  return { stream, getOutput: () => output };
}

console.log('\n  CortexRenderer \u2014 Instance Methods\n');

// --- banner ---

test('banner shows gradient CORTEX and version', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.banner();
  const out = getOutput();
  // Gradient injects ANSI codes between chars, so strip first for content check
  const stripped = CortexRenderer.stripAnsi(out);
  assert.ok(stripped.includes('C O R T E X'), 'Should contain CORTEX text');
  assert.ok(stripped.includes(r.version), 'Should contain version');
  assert.ok(stripped.includes('Cognitive Layer'), 'Should contain tagline');
});

test('banner is silent in quiet mode', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'quiet' });
  r.banner();
  assert.strictEqual(getOutput(), '');
});

// --- begin ---

test('begin writes opening pipe', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.begin();
  assert.ok(getOutput().includes('\u250c'), 'Should write opening pipe');
});

// --- phaseDone ---

test('phaseDone shows checkmark with time', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.phaseDone('Initialized', 300);
  const out = getOutput();
  assert.ok(out.includes('\u2713'), 'Should have checkmark');
  assert.ok(out.includes('Initialized'), 'Should have phase name');
  assert.ok(out.includes('0.3s'), 'Should have formatted time');
});

// --- adapterResult ---

test('adapterResult shows name, bar, count, time', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.adapterResult({ name: 'jsonl', totalRecords: 142, lastQueryTime: 95 });
  const out = getOutput();
  assert.ok(out.includes('jsonl'), 'Should have adapter name');
  assert.ok(out.includes('142'), 'Should have record count');
  assert.ok(out.includes('0.1s'), 'Should have time');
  assert.ok(out.includes('\u2588'), 'Should have bar chars');
});

test('adapterResult shows cold start indicator', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.adapterResult({ name: 'vector', totalRecords: 189, lastQueryTime: 3200, wasColdStart: true });
  const out = getOutput();
  assert.ok(out.includes('\u2744'), 'Should have cold start indicator');
});

test('adapterResult without cold start has no snowflake', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.adapterResult({ name: 'vector', totalRecords: 189, lastQueryTime: 500, wasColdStart: false });
  const out = getOutput();
  assert.ok(!out.includes('\u2744'), 'Should NOT have cold start indicator');
});

// --- adapterError ---

test('adapterError shows error with red cross', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.adapterError({ name: 'episodic-memory', error: 'Timeout', lastQueryTime: 500 });
  const out = getOutput();
  assert.ok(out.includes('\u2717'), 'Should have red cross');
  assert.ok(out.includes('episodic-memory'), 'Should have adapter name');
  assert.ok(out.includes('timeout'), 'Should have error reason');
});

// --- end ---

test('end shows footer with memories, tokens, time', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full', tokenBudget: 4000 });
  r.end({
    memoriesSelected: 47,
    estimatedTokens: 1545,
    duration: 2300,
    totalQueried: 774,
  });
  const out = getOutput();
  assert.ok(out.includes('47'), 'Should have memory count');
  assert.ok(out.includes('1,545'), 'Should have token count with comma');
  assert.ok(out.includes('4,000'), 'Should have budget total');
  assert.ok(out.includes('774'), 'Should have queried count');
  assert.ok(out.includes('2.3s'), 'Should have duration');
  assert.ok(out.includes('\u2501'), 'Should have accent line');
  assert.ok(out.includes('\u2514'), 'Should have closing pipe');
});

test('end shows HyDE indicator when expanded', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.end({
    memoriesSelected: 47,
    estimatedTokens: 1545,
    duration: 2300,
    hydeExpanded: true,
    hydeMs: 100,
    totalQueried: 774,
  });
  const out = getOutput();
  assert.ok(out.includes('HyDE'), 'Should mention HyDE');
  assert.ok(out.includes('0.1s'), 'Should have HyDE time');
});

test('end does not show HyDE when not expanded', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.end({
    memoriesSelected: 47,
    estimatedTokens: 1545,
    duration: 2300,
    hydeExpanded: false,
    totalQueried: 774,
  });
  const out = getOutput();
  assert.ok(!out.includes('HyDE'), 'Should NOT mention HyDE');
});

// --- compact ---

test('compact shows single-line summary', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, tokenBudget: 4000 });
  r.compact({
    memoriesSelected: 47,
    estimatedTokens: 1545,
    duration: 2300,
  });
  const out = getOutput();
  assert.ok(out.includes('\u25c7'), 'Should have diamond marker');
  assert.ok(out.includes('47'), 'Should have count');
  assert.ok(out.includes('1,545'), 'Should have tokens');
  assert.ok(out.includes('2.3s'), 'Should have time');
  // Should be a single line
  const lines = out.trim().split('\n');
  assert.strictEqual(lines.length, 1, 'Should be single line');
});

// --- quiet ---

test('quiet shows minimal output', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream });
  r.quiet({ memoriesSelected: 47, estimatedTokens: 1545 });
  const out = getOutput();
  assert.ok(out.includes('\u2713'), 'Should have checkmark');
  assert.ok(out.includes('47'), 'Should have count');
  assert.ok(out.includes('1,545'), 'Should have tokens');
});

// --- NO_COLOR mode ---

test('NO_COLOR disables all ANSI codes', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, noColor: true, verbosity: 'full', tokenBudget: 4000 });
  r.banner();
  r.begin();
  r.phaseDone('Initialized', 300);
  r.adapterResult({ name: 'jsonl', totalRecords: 142, lastQueryTime: 95 });
  r.end({ memoriesSelected: 47, estimatedTokens: 1545, duration: 2300, totalQueried: 774 });
  const out = getOutput();
  // Strip should be identical to original
  assert.strictEqual(out, CortexRenderer.stripAnsi(out), 'Should have zero ANSI codes');
  // But still has content
  assert.ok(out.includes('C O R T E X'), 'Should still have content');
  assert.ok(out.includes('jsonl'), 'Should still have adapter name');
});

// --- Adaptive bar width ---

test('bar width adapts to terminal columns', () => {
  // Formula: Math.max(6, Math.min(20, columns - 50))
  // Min=6 at cols<=56, Max=20 at cols>=70, linear in between
  function makeStream(cols) {
    const s = new Writable({ write(_c, _e, cb) { cb(); } });
    s.columns = cols;
    s.isTTY = true;
    return s;
  }
  const rNarrow = new CortexRenderer({ stream: makeStream(52) });  // 52-50=2, clamped to 6
  const rMid = new CortexRenderer({ stream: makeStream(60) });     // 60-50=10
  const rWide = new CortexRenderer({ stream: makeStream(200) });   // 200-50=150, clamped to 20

  assert.strictEqual(rNarrow._barWidth, 6, 'Narrow terminal clamps to min 6');
  assert.strictEqual(rMid._barWidth, 10, 'Mid terminal gets columns-50');
  assert.strictEqual(rWide._barWidth, 20, 'Wide terminal clamps to max 20');
  assert.ok(rMid._barWidth > rNarrow._barWidth, 'Mid wider than narrow');
  assert.ok(rWide._barWidth > rMid._barWidth, 'Wide wider than mid');
});

// --- Verbosity modes silencing ---

test('begin/phaseDone/adapterResult are silent in compact mode', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'compact' });
  r.begin();
  r.phaseDone('Test', 100);
  r.adapterResult({ name: 'test', totalRecords: 10, lastQueryTime: 50 });
  r.adapterError({ name: 'test2', error: 'fail', lastQueryTime: 50 });
  r.end({ memoriesSelected: 10, estimatedTokens: 500, duration: 200 });
  assert.strictEqual(getOutput(), '', 'Compact mode should silence full output methods');
});

test('begin/phaseDone/adapterResult are silent in quiet mode', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'quiet' });
  r.begin();
  r.phaseDone('Test', 100);
  r.adapterResult({ name: 'test', totalRecords: 10, lastQueryTime: 50 });
  r.end({ memoriesSelected: 10, estimatedTokens: 500, duration: 200 });
  assert.strictEqual(getOutput(), '', 'Quiet mode should silence full output methods');
});

// --- Edge cases ---

test('end with zero memories and tokens', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full', tokenBudget: 2000 });
  r.end({ memoriesSelected: 0, estimatedTokens: 0, duration: 0 });
  const out = getOutput();
  assert.ok(out.includes('0'), 'Should show 0 memories');
  assert.ok(out.includes('\u2514'), 'Should still have closing pipe');
});

test('quiet with zero memories shows Ready', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream });
  r.quiet({ memoriesSelected: 0, estimatedTokens: 0 });
  const out = getOutput();
  assert.ok(out.includes('Ready'), 'Should show Ready when no memories');
});

test('adapterResult tracks max for proportional bars', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.adapterResult({ name: 'small', totalRecords: 10, lastQueryTime: 50 });
  r.adapterResult({ name: 'large', totalRecords: 100, lastQueryTime: 100 });
  assert.strictEqual(r._maxAdapterRecords, 100, 'Should track max records');
});

test('gradient midpoint interpolation is correct', () => {
  const result = CortexRenderer.gradient('ABC', [0, 0, 0], [200, 200, 200], false);
  // Midpoint B should be (100, 100, 100)
  assert.ok(result.includes('\x1b[38;2;100;100;100m'), 'Midpoint should interpolate correctly');
});

test('formatTokenBudget at exactly 70% uses yellow', () => {
  // 70% of 1000 = 700, but > 0.7 triggers yellow
  const result = CortexRenderer.formatTokenBudget(701, 1000, 12, true);
  assert.ok(result.includes('\x1b[33m'), 'Should be yellow at >70%');
});

test('formatTokenBudget at exactly 90% uses yellow', () => {
  // 90% exactly: 0.9 is NOT > 0.9, so should be yellow
  const result = CortexRenderer.formatTokenBudget(900, 1000, 12, true);
  assert.ok(result.includes('\x1b[33m'), 'Should be yellow at exactly 90%');
});

test('formatTokenBudget just above 90% uses red', () => {
  const result = CortexRenderer.formatTokenBudget(901, 1000, 12, true);
  assert.ok(result.includes('\x1b[31m'), 'Should be red above 90%');
});

// =========================================================================
// Summary
// =========================================================================

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
