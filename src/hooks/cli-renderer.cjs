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
        path.join(__dirname, '..', '..', 'package.json'), 'utf8'
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

    // Phase timing
    this._currentPhase = null;
    this._phaseStartTime = null;
    this._spinnerLabel = null;
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

    const memCount = this._isInteractive
      ? `${WHITE}${BOLD}${stats.memoriesSelected || 0}${RST}`
      : String(stats.memoriesSelected || 0);

    this._writeln(
      `${this._green(' └')}  ${memCount} memories ${this._gray('·')} ` +
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
