# Cortex CLI Renderer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the decorative `neural-visuals.cjs` (1066 lines) with a data-driven `CortexRenderer` class that shows real per-adapter timing, token budget usage, streaming progress, error states, and gradient accents — zero external dependencies.

**Architecture:** New `hooks/cli-renderer.cjs` exports a `CortexRenderer` class with pure ANSI escape codes. Session-start hook uses it instead of `ProgressDisplay`/`NeuralProgressDisplay`. `AdapterRegistry.queryAll()` gains an `onAdapterComplete` callback so results stream to the renderer as they arrive.

**Tech Stack:** Node.js CommonJS, ANSI escape codes (true-color), Unicode block characters, braille spinners.

**Design doc:** `docs/plans/2026-02-25-cortex-cli-renderer-design.md`

---

### Task 1: Create CortexRenderer — Static Helpers

**Files:**
- Create: `hooks/cli-renderer.cjs`
- Create: `tests/test-cli-renderer.cjs`

**Step 1: Write failing tests for static helpers**

Create `tests/test-cli-renderer.cjs`:

```javascript
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
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

console.log('\n  CortexRenderer — Static Helpers\n');

// --- gradient ---

test('gradient returns plain text when noColor is true', () => {
  const result = CortexRenderer.gradient('HELLO', [0, 200, 255], [120, 80, 255], true);
  assert.strictEqual(result, 'HELLO');
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
  // Should have 10 ░ chars
  assert.strictEqual((bar.match(/░/g) || []).length, 10);
  assert.strictEqual((bar.match(/█/g) || []).length, 0);
});

test('progressBar at 100% returns all filled', () => {
  const bar = CortexRenderer.progressBar(100, 100, 10, true);
  assert.strictEqual((bar.match(/█/g) || []).length, 10);
  assert.strictEqual((bar.match(/░/g) || []).length, 0);
});

test('progressBar at 50% returns half filled', () => {
  const bar = CortexRenderer.progressBar(50, 100, 10, true);
  assert.strictEqual((bar.match(/█/g) || []).length, 5);
  assert.strictEqual((bar.match(/░/g) || []).length, 5);
});

test('progressBar handles value > max (clamps to 100%)', () => {
  const bar = CortexRenderer.progressBar(200, 100, 10, true);
  assert.strictEqual((bar.match(/█/g) || []).length, 10);
});

test('progressBar handles max = 0 (all empty)', () => {
  const bar = CortexRenderer.progressBar(0, 0, 10, true);
  assert.strictEqual((bar.match(/░/g) || []).length, 10);
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
  // 500/4000 = 12.5% → should use green (\x1b[32m)
  assert.ok(result.includes('\x1b[32m'), 'Should be green under 70%');
});

test('formatTokenBudget yellow when 70-90%', () => {
  const result = CortexRenderer.formatTokenBudget(3200, 4000, 12, true);
  // 3200/4000 = 80% → should use yellow (\x1b[33m)
  assert.ok(result.includes('\x1b[33m'), 'Should be yellow at 70-90%');
});

test('formatTokenBudget red when > 90%', () => {
  const result = CortexRenderer.formatTokenBudget(3800, 4000, 12, true);
  // 3800/4000 = 95% → should use red (\x1b[31m)
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
  const input = '\x1b[32m✓\x1b[0m hello \x1b[38;2;0;200;255mworld\x1b[0m';
  const result = CortexRenderer.stripAnsi(input);
  assert.strictEqual(result, '✓ hello world');
});

// =========================================================================
// Version
// =========================================================================

console.log('\n  CortexRenderer — Version\n');

test('version is read from package.json', () => {
  const pkg = JSON.parse(require('fs').readFileSync(
    path.join(__dirname, '..', 'package.json'), 'utf8'
  ));
  const renderer = new CortexRenderer({ stream: new (require('stream').Writable)({ write() {} }) });
  assert.strictEqual(renderer.version, pkg.version);
});

// =========================================================================
// Summary
// =========================================================================

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
```

**Step 2: Run tests to verify they fail**

Run: `node tests/test-cli-renderer.cjs`
Expected: FAIL — `Cannot find module '../hooks/cli-renderer.cjs'`

**Step 3: Create `hooks/cli-renderer.cjs` with static helpers**

Create `hooks/cli-renderer.cjs`:

```javascript
#!/usr/bin/env node
/**
 * Cortex - Claude's Cognitive Layer - CLI Renderer
 *
 * Gradient Clack design: Clack-style vertical flow with true-color
 * gradient accents and inline progress bars. Zero external dependencies.
 *
 * Replaces: neural-visuals.cjs (1066 lines of decorative ASCII themes)
 *
 * @version 1.0.0
 * @see Design: ../docs/plans/2026-02-25-cortex-cli-renderer-design.md
 */

'use strict';

const fs = require('fs');
const path = require('path');

// =============================================================================
// ANSI PRIMITIVES (zero dependencies)
// =============================================================================

const RST    = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const GRAY   = '\x1b[90m';
const WHITE  = '\x1b[97m';

const rgb = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_LINE  = '\x1b[2K';

const SYNC_START = '\x1b[?2026h';
const SYNC_END   = '\x1b[?2026l';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Gradient palette
const GRADIENT_FROM = [0, 200, 255];    // cyan
const GRADIENT_TO   = [120, 80, 255];   // purple

// =============================================================================
// CORTEX RENDERER
// =============================================================================

class CortexRenderer {
  /**
   * @param {Object} options
   * @param {'full'|'compact'|'quiet'} [options.verbosity='full']
   * @param {WritableStream} [options.stream=process.stderr]
   * @param {boolean} [options.noColor] - Override: disable all ANSI
   * @param {number} [options.tokenBudget=2000] - Max token budget
   */
  constructor(options = {}) {
    this.stream = options.stream || process.stderr;
    this.verbosity = options.verbosity || 'full';
    this.tokenBudget = options.tokenBudget || 2000;

    // Detect interactive terminal
    this._isInteractive = (options.noColor === true)
      ? false
      : (this.stream.isTTY && !process.env.NO_COLOR);

    // Adaptive bar width
    const columns = this.stream.columns || 80;
    this._barWidth = Math.max(6, Math.min(20, columns - 50));

    // Read version from package.json
    try {
      const pkg = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'package.json'), 'utf8'
      ));
      this.version = pkg.version;
    } catch {
      this.version = '?.?.?';
    }

    // Spinner state
    this._spinnerFrame = 0;
    this._spinnerInterval = null;

    // Track max adapter count for proportional bars
    this._maxAdapterRecords = 0;
  }

  // ---------------------------------------------------------------------------
  // STATIC HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Per-character true-color gradient
   * @param {string} text
   * @param {number[]} from - [r, g, b]
   * @param {number[]} to - [r, g, b]
   * @param {boolean} noColor - If true, return plain text
   * @returns {string}
   */
  static gradient(text, from, to, noColor = false) {
    if (noColor || !text.length) return text + RST;

    let out = '';
    for (let i = 0; i < text.length; i++) {
      const t = text.length > 1 ? i / (text.length - 1) : 0;
      const r = Math.round(from[0] + (to[0] - from[0]) * t);
      const g = Math.round(from[1] + (to[1] - from[1]) * t);
      const b = Math.round(from[2] + (to[2] - from[2]) * t);
      out += rgb(r, g, b) + text[i];
    }
    return out + RST;
  }

  /**
   * Format milliseconds to human-readable time
   * @param {number} ms
   * @returns {string}
   */
  static formatTime(ms) {
    if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  /**
   * Unicode block progress bar
   * @param {number} value
   * @param {number} max
   * @param {number} width - Character width
   * @param {boolean} useColor - Use ANSI colors
   * @returns {string}
   */
  static progressBar(value, max, width = 12, useColor = true) {
    const pct = max > 0 ? Math.min(1, value / max) : 0;
    const filled = Math.round(pct * width);
    const empty = width - filled;

    if (useColor) {
      return CYAN + '█'.repeat(filled) + GRAY + '░'.repeat(empty) + RST;
    }
    return '[' + '#'.repeat(filled) + '.'.repeat(empty) + ']';
  }

  /**
   * Token budget bar with color thresholds
   * @param {number} used
   * @param {number} total
   * @param {number} width
   * @param {boolean} useColor
   * @returns {string}
   */
  static formatTokenBudget(used, total, width = 12, useColor = true) {
    const usedStr = used.toLocaleString();
    const totalStr = total.toLocaleString();
    const pct = total > 0 ? Math.min(1, used / total) : 0;
    const filled = Math.round(pct * width);
    const empty = width - filled;

    if (useColor) {
      let barColor = GREEN;
      if (pct > 0.9) barColor = RED;
      else if (pct > 0.7) barColor = YELLOW;

      const bar = barColor + '█'.repeat(filled) + DIM + GRAY + '░'.repeat(empty) + RST;
      return `${usedStr} / ${totalStr} tokens ${bar}`;
    }

    const bar = '[' + '#'.repeat(filled) + '.'.repeat(empty) + ']';
    return `${usedStr} / ${totalStr} tokens ${bar}`;
  }

  /**
   * Strip ANSI escape codes from string
   * @param {string} str
   * @returns {string}
   */
  static stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  }

  // ---------------------------------------------------------------------------
  // LIFECYCLE
  // ---------------------------------------------------------------------------

  /**
   * Show gradient banner header
   */
  banner() {
    if (this.verbosity === 'quiet') return;

    const bannerText = '  C O R T E X';
    const gradientBanner = this._isInteractive
      ? BOLD + CortexRenderer.gradient(bannerText, GRADIENT_FROM, GRADIENT_TO)
      : bannerText;

    this._writeln('');
    this._writeln(gradientBanner);
    this._writeln(`  ${this._dim(`Claude's Cognitive Layer · v${this.version}`)}`);
    this._writeln('');
  }

  /**
   * Open the vertical pipe
   */
  begin() {
    if (this.verbosity !== 'full') return;
    this._writeln(this._gray(' ┌'));
  }

  /**
   * Close the vertical pipe with summary footer
   * @param {Object} stats
   * @param {number} stats.memoriesSelected
   * @param {number} stats.estimatedTokens
   * @param {number} stats.duration
   * @param {Object} [stats.bySource]
   * @param {boolean} [stats.hydeExpanded]
   * @param {number} [stats.hydeMs]
   * @param {number} [stats.totalQueried]
   * @param {number} [stats.rankingMs]
   */
  end(stats) {
    if (this.verbosity !== 'full') return;

    this._stopSpinner();

    // HyDE indicator
    if (stats.hydeExpanded) {
      this._writeln(this._gray(' │'));
      const time = CortexRenderer.formatTime(stats.hydeMs || 0);
      this._writeln(`${this._gray(' │')}  ${this._cyan('◇')}  HyDE expanded query ${this._dim(time)}`);
    }

    // Ranking summary
    if (stats.totalQueried && stats.memoriesSelected !== undefined) {
      const rankTime = stats.rankingMs ? CortexRenderer.formatTime(stats.rankingMs) : '';
      this._writeln(`${this._gray(' │')}  ${this._green('✓')}  Selected ${stats.memoriesSelected} of ${stats.totalQueried} ${this._dim(rankTime)}`);
    }

    // Gradient accent line
    this._writeln(this._gray(' │'));
    const accentLine = this._isInteractive
      ? ' ' + CortexRenderer.gradient('━'.repeat(Math.max(20, this._barWidth + 15)), GRADIENT_FROM, GRADIENT_TO)
      : ' ' + '━'.repeat(35);
    this._writeln(accentLine);

    // Footer
    const tokenInfo = CortexRenderer.formatTokenBudget(
      stats.estimatedTokens || 0,
      this.tokenBudget,
      this._barWidth,
      this._isInteractive
    );
    const duration = CortexRenderer.formatTime(stats.duration || 0);

    this._writeln(
      `${this._green(' └')}  ${WHITE}${BOLD}${stats.memoriesSelected || 0}${RST} memories ${this._gray('·')} ` +
      `${tokenInfo} ${this._gray('·')} ${this._dim(duration)}`
    );
    this._writeln('');
  }

  // ---------------------------------------------------------------------------
  // PHASES
  // ---------------------------------------------------------------------------

  /**
   * Start a phase with spinner animation
   * @param {string} name
   */
  phaseStart(name) {
    if (this.verbosity !== 'full') return;

    this._currentPhase = name;
    this._phaseStartTime = Date.now();

    if (this._isInteractive) {
      this._startSpinner(name);
    } else {
      this._writeln(`${this._gray(' │')}  ... ${name}`);
    }
  }

  /**
   * Mark a phase as complete
   * @param {string} name
   * @param {number} [ms] - Duration (auto-computed if phaseStart was called)
   */
  phaseDone(name, ms) {
    if (this.verbosity !== 'full') return;

    this._stopSpinner();
    const elapsed = ms || (this._phaseStartTime ? Date.now() - this._phaseStartTime : 0);
    const time = CortexRenderer.formatTime(elapsed);
    this._writeln(`${this._gray(' │')}  ${this._green('✓')}  ${name} ${this._dim(time)}`);
    this._writeln(this._gray(' │'));
  }

  // ---------------------------------------------------------------------------
  // ADAPTER RESULTS (streamed)
  // ---------------------------------------------------------------------------

  /**
   * Show a successful adapter result
   * @param {Object} adapter
   * @param {string} adapter.name
   * @param {number} adapter.totalRecords
   * @param {number} adapter.lastQueryTime
   * @param {boolean} [adapter.wasColdStart]
   */
  adapterResult(adapter) {
    if (this.verbosity !== 'full') return;

    this._stopSpinner();

    // Track max for proportional bars
    if (adapter.totalRecords > this._maxAdapterRecords) {
      this._maxAdapterRecords = adapter.totalRecords;
    }

    const name = adapter.name.padEnd(18);
    const count = String(adapter.totalRecords).padStart(4);
    const time = CortexRenderer.formatTime(adapter.lastQueryTime);
    const bar = CortexRenderer.progressBar(
      adapter.totalRecords,
      this._maxAdapterRecords || adapter.totalRecords,
      this._barWidth,
      this._isInteractive
    );
    const cold = adapter.wasColdStart ? '  ❄' : '';

    this._writeln(
      `${this._gray(' │')}  ${this._green('✓')} ${name} ${bar} ${this._white(count)} ${this._dim(time)}${cold}`
    );
  }

  /**
   * Show an adapter error/timeout
   * @param {Object} adapter
   * @param {string} adapter.name
   * @param {string} adapter.error
   * @param {number} adapter.lastQueryTime
   */
  adapterError(adapter) {
    if (this.verbosity !== 'full') return;

    this._stopSpinner();

    const name = adapter.name.padEnd(18);
    const time = CortexRenderer.formatTime(adapter.lastQueryTime);
    const reason = adapter.error === 'Timeout' ? 'timeout' : adapter.error || 'unavailable';

    this._writeln(
      `${this._gray(' │')}  ${this._red('✗')} ${name} ${this._dim('─ ' + reason)} ${this._dim(time)}`
    );
  }

  // ---------------------------------------------------------------------------
  // COMPACT / QUIET
  // ---------------------------------------------------------------------------

  /**
   * Single-line compact output for subsequent queries
   * @param {Object} stats
   */
  compact(stats) {
    const tokenInfo = stats.estimatedTokens
      ? `${(stats.estimatedTokens).toLocaleString()} / ${this.tokenBudget.toLocaleString()} tokens`
      : '';
    const time = CortexRenderer.formatTime(stats.duration || 0);
    const count = stats.memoriesSelected || 0;

    this._writeln(
      ` ${this._cyan('◇')} Cortex: ${count} memories ${this._gray('·')} ${tokenInfo} ${this._gray('·')} ${time}`
    );
  }

  /**
   * Minimal quiet output for hook mode
   * @param {Object} stats
   */
  quiet(stats) {
    const count = stats.memoriesSelected || 0;
    const tokens = stats.estimatedTokens || 0;

    if (count > 0) {
      this._write(`✓ Cortex: ${count} memories (${tokens.toLocaleString()} tokens)\n`);
    } else {
      this._write('✓ Cortex: Ready\n');
    }
  }

  // ---------------------------------------------------------------------------
  // SPINNER
  // ---------------------------------------------------------------------------

  /** @private */
  _startSpinner(label) {
    if (!this._isInteractive) return;

    this._spinnerLabel = label;
    this._write(HIDE_CURSOR);
    this._spinnerInterval = setInterval(() => {
      const frame = SPINNER[this._spinnerFrame % SPINNER.length];
      this._spinnerFrame++;
      const elapsed = this._phaseStartTime ? CortexRenderer.formatTime(Date.now() - this._phaseStartTime) : '';
      this._write(`\r${CLEAR_LINE}${this._gray(' │')}  ${CYAN}${frame}${RST}  ${this._spinnerLabel} ${this._dim(elapsed)}`);
    }, 80);
  }

  /** @private */
  _stopSpinner() {
    if (this._spinnerInterval) {
      clearInterval(this._spinnerInterval);
      this._spinnerInterval = null;
      this._write(`\r${CLEAR_LINE}`);
      this._write(SHOW_CURSOR);
    }
  }

  // ---------------------------------------------------------------------------
  // WRITE HELPERS
  // ---------------------------------------------------------------------------

  /** @private */
  _write(s) { this.stream.write(s); }

  /** @private */
  _writeln(s) { this.stream.write((s || '') + '\n'); }

  /** @private */
  _green(s) { return this._isInteractive ? GREEN + s + RST : s; }

  /** @private */
  _red(s) { return this._isInteractive ? RED + s + RST : s; }

  /** @private */
  _cyan(s) { return this._isInteractive ? CYAN + s + RST : s; }

  /** @private */
  _gray(s) { return this._isInteractive ? GRAY + s + RST : s; }

  /** @private */
  _dim(s) { return this._isInteractive ? DIM + s + RST : s; }

  /** @private */
  _white(s) { return this._isInteractive ? WHITE + s + RST : s; }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  CortexRenderer,
  // Re-export constants for testing
  _ANSI: { RST, BOLD, DIM, GREEN, YELLOW, RED, CYAN, GRAY, WHITE, rgb,
           HIDE_CURSOR, SHOW_CURSOR, CLEAR_LINE, SYNC_START, SYNC_END, SPINNER },
  _GRADIENT: { FROM: GRADIENT_FROM, TO: GRADIENT_TO },
};
```

**Step 4: Run tests to verify they pass**

Run: `node tests/test-cli-renderer.cjs`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add hooks/cli-renderer.cjs tests/test-cli-renderer.cjs
git commit -m "feat: add CortexRenderer with static helpers and unit tests"
```

---

### Task 2: CortexRenderer — Instance Methods Tests

**Files:**
- Modify: `tests/test-cli-renderer.cjs`

**Step 1: Add tests for instance methods (banner, begin, end, phases, adapter results)**

Append to `tests/test-cli-renderer.cjs` before the summary section:

```javascript
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

console.log('\n  CortexRenderer — Instance Methods\n');

// --- banner ---

test('banner shows gradient CORTEX and version', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.banner();
  const out = getOutput();
  assert.ok(out.includes('C O R T E X'), 'Should contain CORTEX text');
  assert.ok(out.includes(r.version), 'Should contain version');
  assert.ok(out.includes('Cognitive Layer'), 'Should contain tagline');
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
  assert.ok(getOutput().includes('┌'), 'Should write opening pipe');
});

// --- phaseDone ---

test('phaseDone shows checkmark with time', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.phaseDone('Initialized', 300);
  const out = getOutput();
  assert.ok(out.includes('✓'), 'Should have checkmark');
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
  assert.ok(out.includes('█'), 'Should have bar chars');
});

test('adapterResult shows cold start indicator', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.adapterResult({ name: 'vector', totalRecords: 189, lastQueryTime: 3200, wasColdStart: true });
  const out = getOutput();
  assert.ok(out.includes('❄'), 'Should have cold start indicator');
});

test('adapterResult without cold start has no ❄', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.adapterResult({ name: 'vector', totalRecords: 189, lastQueryTime: 500, wasColdStart: false });
  const out = getOutput();
  assert.ok(!out.includes('❄'), 'Should NOT have cold start indicator');
});

// --- adapterError ---

test('adapterError shows error with red cross', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.adapterError({ name: 'episodic-memory', error: 'Timeout', lastQueryTime: 500 });
  const out = getOutput();
  assert.ok(out.includes('✗'), 'Should have red cross');
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
  assert.ok(out.includes('━'), 'Should have accent line');
  assert.ok(out.includes('└'), 'Should have closing pipe');
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
  assert.ok(out.includes('◇'), 'Should have diamond marker');
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
  assert.ok(out.includes('✓'), 'Should have checkmark');
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
  const { stream } = createCapture();
  stream.columns = 80;
  const r80 = new CortexRenderer({ stream });
  stream.columns = 120;
  const r120 = new CortexRenderer({ stream });
  stream.columns = 200;
  const r200 = new CortexRenderer({ stream });

  assert.ok(r80._barWidth >= 6, 'Min bar width is 6');
  assert.ok(r120._barWidth > r80._barWidth, '120-col wider than 80-col');
  assert.ok(r200._barWidth <= 20, 'Max bar width is 20');
});
```

**Step 2: Run tests to verify they pass**

Run: `node tests/test-cli-renderer.cjs`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add tests/test-cli-renderer.cjs
git commit -m "test: add CortexRenderer instance method tests"
```

---

### Task 3: Add `onAdapterComplete` Callback to AdapterRegistry

**Files:**
- Modify: `adapters/index.cjs:141-195` — `queryAll()` method
- Modify: `tests/test-adapters.cjs` — add callback tests

**Step 1: Write failing test for onAdapterComplete callback**

Add to `tests/test-adapters.cjs` in the `queryAll` test section:

```javascript
test('queryAll fires onAdapterComplete for each adapter', async () => {
  const registry = createDefaultRegistry({ basePath: TEST_DIR, verbose: false });
  // Disable all MCP-based and heavy adapters
  registry.setEnabled('episodic-memory', false);
  registry.setEnabled('knowledge-graph', false);
  registry.setEnabled('vector', false);
  registry.setEnabled('warp-sqlite', false);

  const context = { tags: ['test'], domains: [], intent: 'testing', intentConfidence: 0.8 };
  const completed = [];

  await registry.queryAll(context, {
    onAdapterComplete: (result) => {
      completed.push(result);
    },
  });

  // Should have callbacks for each enabled adapter
  assert.ok(completed.length > 0, 'Should have at least one callback');
  for (const c of completed) {
    assert.ok(c.name, 'Callback should have adapter name');
    assert.ok(typeof c.totalRecords === 'number', 'Should have totalRecords');
    assert.ok(typeof c.lastQueryTime === 'number', 'Should have lastQueryTime');
    assert.ok(typeof c.wasColdStart === 'boolean', 'Should have wasColdStart');
  }
});

test('queryAll onAdapterComplete fires on error with error field', async () => {
  const registry = new AdapterRegistry();
  // Register a mock adapter that throws
  class FailAdapter extends BaseAdapter {
    constructor() { super({ name: 'fail-test', priority: 0.5, timeout: 100, enabled: true }); }
    async query() { throw new Error('Test failure'); }
    normalize(d) { return d; }
  }
  registry.register(new FailAdapter());

  const completed = [];
  await registry.queryAll({}, {
    onAdapterComplete: (result) => completed.push(result),
  });

  assert.strictEqual(completed.length, 1, 'Should callback on failure too');
  assert.strictEqual(completed[0].name, 'fail-test');
  assert.ok(completed[0].error, 'Should have error message');
  assert.strictEqual(completed[0].totalRecords, 0, 'Failed adapter has 0 records');
});
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-adapters.cjs`
Expected: FAIL — `onAdapterComplete` is not called (not implemented yet)

**Step 3: Modify `adapters/index.cjs:141-195` to add callback**

Replace the `queryAll` method:

```javascript
  async queryAll(context, options = {}) {
    const enabledAdapters = this.getEnabled();
    const stats = {};
    const { onAdapterComplete } = options;

    // Query all adapters in parallel with individual timeouts
    const promises = enabledAdapters.map(async adapter => {
      const startTime = Date.now();
      // Track cold start for vector adapter
      const wasColdStart = adapter.name === 'vector' && !adapter._provider?.initialized;

      try {
        // Race between query and timeout
        const results = await Promise.race([
          adapter.query(context, options),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), adapter.timeout)
          ),
        ]);

        const adapterStat = {
          name: adapter.name,
          available: true,
          totalRecords: results.length,
          lastQueryTime: Date.now() - startTime,
          cacheHitRate: adapter._calculateCacheHitRate?.() || 0,
          errorCount: 0,
          wasColdStart,
        };

        stats[adapter.name] = adapterStat;

        // Stream callback
        if (onAdapterComplete) {
          onAdapterComplete({
            name: adapter.name,
            totalRecords: results.length,
            lastQueryTime: adapterStat.lastQueryTime,
            wasColdStart,
            error: null,
          });
        }

        return results;
      } catch (error) {
        if (this._verbose) {
          console.error(`[AdapterRegistry] ${adapter.name} failed:`, error.message);
        }

        const adapterStat = {
          name: adapter.name,
          available: false,
          totalRecords: 0,
          lastQueryTime: Date.now() - startTime,
          cacheHitRate: 0,
          errorCount: 1,
          error: error.message,
          wasColdStart,
        };

        stats[adapter.name] = adapterStat;

        // Stream callback on error too
        if (onAdapterComplete) {
          onAdapterComplete({
            name: adapter.name,
            totalRecords: 0,
            lastQueryTime: adapterStat.lastQueryTime,
            wasColdStart,
            error: error.message,
          });
        }

        return [];
      }
    });

    const resultsArrays = await Promise.all(promises);
    const allResults = resultsArrays.flat();

    return {
      results: allResults,
      stats,
    };
  }
```

**Step 4: Run tests to verify they pass**

Run: `node tests/test-adapters.cjs`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add adapters/index.cjs tests/test-adapters.cjs
git commit -m "feat: add onAdapterComplete streaming callback to AdapterRegistry.queryAll()"
```

---

### Task 4: Integrate CortexRenderer into SessionStart Hook

**Files:**
- Modify: `hooks/session-start.cjs:36,86-91,365-405`
- Modify: `hooks/injection-formatter.cjs:16-28,91-226`

**Step 1: Modify `hooks/session-start.cjs` to import CortexRenderer**

At line 36, replace:
```javascript
  ({ ProgressDisplay, InjectionFormatter } = require('./injection-formatter.cjs'));
```
With:
```javascript
  ({ InjectionFormatter } = require('./injection-formatter.cjs'));
  ({ CortexRenderer } = require('./cli-renderer.cjs'));
```

**Step 2: Replace ProgressDisplay usage in main() (lines 365-405)**

Replace the `main()` function:

```javascript
async function main() {
  const compactMode = process.env.CORTEX_COMPACT === 'true' ||
                      process.argv.includes('--compact') ||
                      process.argv.includes('-c');

  const hook = new SessionStartHook();

  // Initialize renderer
  const renderer = new CortexRenderer({
    verbosity: compactMode ? 'quiet' : 'full',
    tokenBudget: hook.config.get('sessionStart.slots.maxTokens') || 2000,
  });

  if (!compactMode) {
    renderer.banner();
    renderer.begin();
    renderer.phaseStart('Initializing');
  }

  const result = await hook.execute();

  if (!compactMode) {
    if (result.success && result.enabled) {
      renderer.phaseDone('Initialized', result.stats?.duration);

      // Show per-adapter results if available
      const adapterStats = result.stats?.byAdapter || result.stats?.bySource || {};
      for (const [name, stat] of Object.entries(adapterStats)) {
        if (typeof stat === 'object' && stat.lastQueryTime !== undefined) {
          if (stat.available !== false && stat.error === undefined) {
            renderer.adapterResult({
              name,
              totalRecords: stat.totalRecords || 0,
              lastQueryTime: stat.lastQueryTime || 0,
              wasColdStart: stat.wasColdStart || false,
            });
          } else {
            renderer.adapterError({
              name,
              error: stat.error || 'unavailable',
              lastQueryTime: stat.lastQueryTime || 0,
            });
          }
        }
      }

      renderer.end({
        memoriesSelected: result.stats.memoriesSelected || result.stats.totalSelected || 0,
        estimatedTokens: result.stats.estimatedTokens || 0,
        duration: result.stats.duration || 0,
        totalQueried: result.stats.memoriesQueried || result.stats.totalQueried || 0,
        bySource: result.stats.bySource,
        hydeExpanded: result.stats.semantic?.hydeExpanded || false,
        hydeMs: result.stats.semantic?.hydeMs || 0,
      });
    } else if (!result.enabled) {
      renderer.phaseDone('Cortex disabled in config', 0);
    } else {
      renderer.phaseDone('Error: ' + (result.error || 'Unknown'), 0);
    }
  } else {
    if (result.success && result.enabled) {
      renderer.quiet({
        memoriesSelected: result.stats?.memoriesSelected || result.stats?.totalSelected || 0,
        estimatedTokens: result.stats?.estimatedTokens || 0,
        wipItems: result.wipItems || 0,
      });
    } else {
      renderer.quiet({ memoriesSelected: 0, estimatedTokens: 0 });
    }
  }

  // Output in Claude Code hook format (unchanged)
  const hookOutput = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: result.injection || '',
    },
    _cortex: {
      success: result.success,
      enabled: result.enabled,
      wipDetected: result.wipDetected,
      wipItems: result.wipItems,
      stats: result.stats,
    },
  };

  console.log(JSON.stringify(hookOutput, null, 2));
}
```

**Step 3: Run session-start hook to verify integration**

Run: `node hooks/session-start.cjs 2>/dev/null | head -5`
Expected: Valid JSON output (stderr has the visual output)

Run: `node hooks/session-start.cjs 2>&1 1>/dev/null | head -20`
Expected: See "C O R T E X" banner and adapter results on stderr

**Step 4: Commit**

```bash
git add hooks/session-start.cjs
git commit -m "feat: integrate CortexRenderer into session-start hook"
```

---

### Task 5: Clean Up injection-formatter.cjs — Remove Neural Visuals

**Files:**
- Modify: `hooks/injection-formatter.cjs:1-29,91-226,667-688`

**Step 1: Remove neural-visuals imports (lines 16-28)**

Replace the neural-visuals import block:

```javascript
// Import neural visuals system
let NeuralProgressDisplay, NeuralFormatter, NeuralAnimator, ThemeManager;
try {
  ({
    NeuralProgressDisplay,
    NeuralFormatter,
    NeuralAnimator,
    ThemeManager,
  } = require('./neural-visuals.cjs'));
} catch (e) {
  // Neural visuals not available, will use fallback
  NeuralProgressDisplay = null;
  NeuralFormatter = null;
}
```

With:

```javascript
// CLI renderer (replaces neural-visuals.cjs)
let CortexRenderer;
try {
  ({ CortexRenderer } = require('./cli-renderer.cjs'));
} catch {
  CortexRenderer = null;
}
```

**Step 2: Remove the ProgressDisplay class (lines 91-226)**

Delete the entire `ProgressDisplay` class. It's been replaced by `CortexRenderer`.

**Step 3: Remove NeuralFormatter references in InjectionFormatter**

In the `InjectionFormatter` constructor (~line 250), remove the neural formatter creation:

```javascript
    // Create neural formatter if available and requested
    if (this.formatType === 'neural' && NeuralFormatter) {
      this.neuralFormatter = new NeuralFormatter({
        theme: this.theme,
        includeColors: true,
      });
    }
```

Replace with:

```javascript
    // 'neural' format type falls through to 'rich' (neural-visuals.cjs removed)
```

In `formatMemories()`, remove the neural case (lines 271-274):

```javascript
      case 'neural':
        if (this.neuralFormatter) {
          return this.neuralFormatter.formatMemories(memories, context, stats);
        }
        // Fall through to rich if neural not available
```

Replace with:

```javascript
      case 'neural':  // Falls through to 'rich' (backward compatible)
```

**Step 4: Update exports (lines 667-688)**

Replace:

```javascript
module.exports = {
  // Core classes
  ProgressDisplay,
  InjectionFormatter,

  // Neural visuals (re-exported for convenience)
  NeuralProgressDisplay,
  NeuralFormatter,
  NeuralAnimator,
  ThemeManager,

  // Constants
  ICONS,
  TYPE_LABELS,
  SOURCE_LABELS,
  VERSION,
};
```

With:

```javascript
module.exports = {
  // Core classes
  InjectionFormatter,
  CortexRenderer,

  // Constants
  ICONS: MARKERS,
  MARKERS,
  TYPE_LABELS,
  SOURCE_LABELS,
  VERSION,
};
```

**Step 5: Run existing hook tests to verify nothing broke**

Run: `node tests/test-hooks.cjs`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add hooks/injection-formatter.cjs
git commit -m "refactor: remove ProgressDisplay and neural-visuals imports from injection-formatter"
```

---

### Task 6: Delete neural-visuals.cjs

**Files:**
- Delete: `hooks/neural-visuals.cjs`
- Modify: `tests/test-hooks.cjs` — remove any neural-visuals tests

**Step 1: Check for other references to neural-visuals**

Run: `grep -r 'neural-visuals' --include='*.cjs' --include='*.js' .`

Expected: Only hits in `scripts/demo-neural-visuals.cjs` (demo script) and possibly test files.

**Step 2: Delete the file**

```bash
rm hooks/neural-visuals.cjs
```

**Step 3: Delete or update demo script**

```bash
rm scripts/demo-neural-visuals.cjs
```

**Step 4: Remove any neural-visuals test references**

Search `tests/test-hooks.cjs` for any tests that import or test `NeuralProgressDisplay`, `NeuralFormatter`, `ThemeManager`, etc. Remove those test blocks.

**Step 5: Run all tests**

Run: `node tests/test-core.cjs && node tests/test-hooks.cjs && node tests/test-lads.cjs && node tests/test-hyde.cjs && node tests/test-adapters.cjs && node tests/test-cli-renderer.cjs`
Expected: All PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete neural-visuals.cjs (replaced by cli-renderer.cjs)"
```

---

### Task 7: Pass `byAdapter` Stats Through QueryOrchestrator

**Files:**
- Modify: `hooks/query-orchestrator.cjs:163-183`

Currently `QueryOrchestrator.query()` returns `stats.byAdapter` which contains per-adapter stats from `AdapterRegistry.queryAll()`. But the session-start hook needs these stats to feed into the renderer. Verify the data flows through.

**Step 1: Verify the stats flow**

Read `hooks/query-orchestrator.cjs:163` — confirm `byAdapter: adapterStats` is in the return value.

The return already has:
```javascript
return {
  context,
  memories: finalMemories,
  stats: {
    totalQueried: allMemories.length,
    totalDeduplicated: dedupedMemories.length,
    totalSelected: finalMemories.length,
    bySource: this._countBySource(finalMemories),
    byAdapter: adapterStats,   // ← This is already here
    estimatedTokens: this._estimateTokens(finalMemories),
    semantic: ...,
  },
};
```

**Step 2: Verify session-start hook passes `byAdapter` to renderer**

In Task 4 we already added code to iterate `result.stats.byAdapter`. Verify it works by running:

Run: `node hooks/session-start.cjs 2>&1 1>/dev/null`
Expected: See per-adapter lines with timing and record counts

**Step 3: Add onAdapterComplete callback to QueryOrchestrator for streaming**

Modify `hooks/query-orchestrator.cjs:133-138`. Pass the callback through to the registry:

Replace:
```javascript
      const { results: allMemories, stats: adapterStats } = await this.registry.queryAll(
        context,
        queryOptions
      );
```

With:
```javascript
      const { results: allMemories, stats: adapterStats } = await this.registry.queryAll(
        context,
        { ...queryOptions, onAdapterComplete: input.onAdapterComplete }
      );
```

**Step 4: Commit**

```bash
git add hooks/query-orchestrator.cjs
git commit -m "feat: pass onAdapterComplete callback through QueryOrchestrator to AdapterRegistry"
```

---

### Task 8: Wire Streaming Callbacks in Session-Start Hook

**Files:**
- Modify: `hooks/session-start.cjs:168-172`

**Step 1: Pass renderer callback into orchestrator query**

In `SessionStartHook.execute()`, modify the query call (~line 168):

Replace:
```javascript
      const queryResult = await this.orchestrator.query({
        prompt: initialPrompt,
        recentFiles: this._getRecentFiles(workingDir),
      });
```

With:
```javascript
      const queryResult = await this.orchestrator.query({
        prompt: initialPrompt,
        recentFiles: this._getRecentFiles(workingDir),
        onAdapterComplete: this._onAdapterComplete,
      });
```

**Step 2: Store renderer reference in constructor and add callback**

In `main()`, before `hook.execute()`, set the callback:

```javascript
  // Wire streaming adapter results to renderer
  if (!compactMode) {
    hook._onAdapterComplete = (result) => {
      if (result.error) {
        renderer.adapterError(result);
      } else {
        renderer.adapterResult(result);
      }
    };
  }
```

**Step 3: Remove the post-hoc adapter stats loop from Task 4's main()**

Now that adapters stream results as they complete, remove the loop that iterated `result.stats.byAdapter` after the fact. The renderer already got each result via the callback.

**Step 4: Run the hook end-to-end**

Run: `node hooks/session-start.cjs 2>&1 1>/dev/null`
Expected: Adapter results appear in real-time as they complete (fast ones first)

**Step 5: Commit**

```bash
git add hooks/session-start.cjs
git commit -m "feat: wire streaming adapter callbacks to CortexRenderer in session-start"
```

---

### Task 9: Update Demo Script

**Files:**
- Modify: `scripts/demo-cli-designs.cjs`

**Step 1: Rewrite demo to use CortexRenderer**

Replace the entire file to demonstrate the final design using the real `CortexRenderer` class with simulated adapter data:

```javascript
#!/usr/bin/env node
/**
 * Cortex CLI Renderer Demo
 * Shows the final Gradient Clack design using real CortexRenderer class
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

async function main() {
  const renderer = new CortexRenderer({
    verbosity: 'full',
    tokenBudget: 4000,
  });

  renderer.banner();
  renderer.begin();
  renderer.phaseStart('Initializing');
  await sleep(600);
  renderer.phaseDone('Initialized', 300);

  // Stream adapter results with simulated timing
  for (const adapter of ADAPTERS.sort((a, b) => a.lastQueryTime - b.lastQueryTime)) {
    await sleep(200);
    renderer.adapterResult(adapter);
  }

  renderer.end({
    memoriesSelected: 47,
    estimatedTokens: 1545,
    duration: 2300,
    totalQueried: 774,
    hydeExpanded: true,
    hydeMs: 100,
  });
}

main().catch(console.error);
```

**Step 2: Run the demo**

Run: `node scripts/demo-cli-designs.cjs`
Expected: Full animated Gradient Clack output in terminal

**Step 3: Commit**

```bash
git add scripts/demo-cli-designs.cjs
git commit -m "feat: update demo script to use final CortexRenderer design"
```

---

### Task 10: Final Integration Test & Full Test Suite

**Files:**
- Create: `tests/test-cli-renderer-integration.cjs`

**Step 1: Write integration test**

```javascript
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { Writable } = require('stream');
const { CortexRenderer } = require('../hooks/cli-renderer.cjs');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

function createCapture(cols = 100) {
  let output = '';
  const stream = new Writable({
    write(chunk, _enc, cb) { output += chunk.toString(); cb(); },
  });
  stream.columns = cols;
  stream.isTTY = true;
  return { stream, getOutput: () => output };
}

console.log('\n  CortexRenderer — Integration Tests\n');

await test('full render flow produces complete output', async () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full', tokenBudget: 4000 });

  r.banner();
  r.begin();
  r.phaseDone('Initialized', 300);

  r.adapterResult({ name: 'jsonl', totalRecords: 142, lastQueryTime: 95, wasColdStart: false });
  r.adapterResult({ name: 'claudemd', totalRecords: 26, lastQueryTime: 148, wasColdStart: false });
  r.adapterResult({ name: 'vector', totalRecords: 189, lastQueryTime: 1511, wasColdStart: true });
  r.adapterError({ name: 'episodic-memory', error: 'Timeout', lastQueryTime: 500 });

  r.end({
    memoriesSelected: 47,
    estimatedTokens: 1545,
    duration: 2300,
    totalQueried: 357,
    hydeExpanded: true,
    hydeMs: 100,
  });

  const out = getOutput();

  // Verify all required elements present
  assert.ok(out.includes('C O R T E X'), 'Banner');
  assert.ok(out.includes('┌'), 'Opening pipe');
  assert.ok(out.includes('Initialized'), 'Phase');
  assert.ok(out.includes('jsonl'), 'Adapter result');
  assert.ok(out.includes('142'), 'Record count');
  assert.ok(out.includes('❄'), 'Cold start');
  assert.ok(out.includes('✗'), 'Error indicator');
  assert.ok(out.includes('timeout'), 'Error reason');
  assert.ok(out.includes('HyDE'), 'HyDE indicator');
  assert.ok(out.includes('47'), 'Selected count');
  assert.ok(out.includes('357'), 'Queried count');
  assert.ok(out.includes('1,545'), 'Token count');
  assert.ok(out.includes('4,000'), 'Token budget');
  assert.ok(out.includes('━'), 'Accent line');
  assert.ok(out.includes('└'), 'Closing pipe');
  assert.ok(out.includes('2.3s'), 'Duration');
});

await test('proportional bars scale to max adapter count', async () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });

  // First adapter sets the max
  r.adapterResult({ name: 'big', totalRecords: 300, lastQueryTime: 100, wasColdStart: false });
  // Second adapter is smaller — bar should be proportionally smaller
  r.adapterResult({ name: 'small', totalRecords: 30, lastQueryTime: 50, wasColdStart: false });

  const out = getOutput();
  const bigLine = out.split('\n').find(l => l.includes('big'));
  const smallLine = out.split('\n').find(l => l.includes('small'));

  // Count filled blocks in each
  const bigFilled = (CortexRenderer.stripAnsi(bigLine).match(/█/g) || []).length;
  const smallFilled = (CortexRenderer.stripAnsi(smallLine).match(/█/g) || []).length;

  assert.ok(bigFilled > smallFilled, `Big (${bigFilled}) should have more blocks than small (${smallFilled})`);
});

await test('token budget bar colors change at thresholds', async () => {
  // Green: < 70%
  const green = CortexRenderer.formatTokenBudget(500, 4000, 12, true);
  assert.ok(green.includes('\x1b[32m'), 'Green at 12.5%');

  // Yellow: 70-90%
  const yellow = CortexRenderer.formatTokenBudget(3200, 4000, 12, true);
  assert.ok(yellow.includes('\x1b[33m'), 'Yellow at 80%');

  // Red: > 90%
  const red = CortexRenderer.formatTokenBudget(3800, 4000, 12, true);
  assert.ok(red.includes('\x1b[31m'), 'Red at 95%');

  // Exact boundaries
  const at70 = CortexRenderer.formatTokenBudget(2800, 4000, 12, true);
  assert.ok(at70.includes('\x1b[32m'), 'Green at exactly 70%');

  const at71 = CortexRenderer.formatTokenBudget(2840, 4000, 12, true);
  assert.ok(at71.includes('\x1b[33m'), 'Yellow at 71%');

  const at90 = CortexRenderer.formatTokenBudget(3600, 4000, 12, true);
  assert.ok(at90.includes('\x1b[33m'), 'Yellow at exactly 90%');

  const at91 = CortexRenderer.formatTokenBudget(3640, 4000, 12, true);
  assert.ok(at91.includes('\x1b[31m'), 'Red at 91%');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
```

**Step 2: Run integration tests**

Run: `node tests/test-cli-renderer-integration.cjs`
Expected: All PASS

**Step 3: Run full test suite**

Run: `node tests/test-core.cjs && node tests/test-hooks.cjs && node tests/test-lads.cjs && node tests/test-hyde.cjs && node tests/test-adapters.cjs && node tests/test-cli-renderer.cjs && node tests/test-cli-renderer-integration.cjs`
Expected: All suites PASS

**Step 4: Add to package.json test script**

In `package.json`, update the test command to include the new test file.

**Step 5: Commit**

```bash
git add tests/test-cli-renderer-integration.cjs package.json
git commit -m "test: add CLI renderer integration tests, verify full pipeline"
```

---

### Task 11: Cleanup — Remove Theme State, Update Status Script

**Files:**
- Modify: `scripts/status.cjs` — update model/visual section
- Delete: `data/theme-state.json` (if exists at runtime)

**Step 1: Update status script**

In `scripts/status.cjs`, find the "Models" section (~line 228). After the model info, add:

```javascript
  // CLI Renderer
  console.log(`    CLI Renderer:     Gradient Clack v1.0`);
```

**Step 2: Remove theme-state.json references**

Run: `grep -r 'theme-state' --include='*.cjs' .`

Remove any code that reads/writes `data/theme-state.json`.

**Step 3: Run status script**

Run: `node scripts/status.cjs`
Expected: No errors, shows renderer info

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: cleanup theme state references, update status script"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | CortexRenderer static helpers + tests | `hooks/cli-renderer.cjs`, `tests/test-cli-renderer.cjs` |
| 2 | Instance method tests (banner, adapter results, end) | `tests/test-cli-renderer.cjs` |
| 3 | `onAdapterComplete` callback in AdapterRegistry | `adapters/index.cjs` |
| 4 | Integrate renderer into session-start hook | `hooks/session-start.cjs` |
| 5 | Remove neural-visuals from injection-formatter | `hooks/injection-formatter.cjs` |
| 6 | Delete neural-visuals.cjs | `hooks/neural-visuals.cjs` (deleted) |
| 7 | Pass byAdapter stats through QueryOrchestrator | `hooks/query-orchestrator.cjs` |
| 8 | Wire streaming callbacks in session-start | `hooks/session-start.cjs` |
| 9 | Update demo script | `scripts/demo-cli-designs.cjs` |
| 10 | Integration tests + full test suite | `tests/test-cli-renderer-integration.cjs` |
| 11 | Cleanup theme state, update status | `scripts/status.cjs` |
