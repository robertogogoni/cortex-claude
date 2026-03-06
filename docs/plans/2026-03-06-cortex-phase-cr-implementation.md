# Cortex Phase CR: CortexRenderer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Evolve the existing `hooks/cli-renderer.cjs` (CortexRenderer, 477 lines, 44 tests) into a full-featured streaming CLI visual layer with box drawing, tables, color theming, memory cards, adapter dashboards, query result views, session banners, health reports, and backward-compatible integration into the existing hook system.

**Architecture:** `hooks/cli-renderer.cjs` gains new component classes (BoxRenderer, TableRenderer, etc.) that compose via the existing CortexRenderer base. All rendering is hand-crafted with ANSI escape codes -- zero external dependencies. Tests use the project's existing `test()`/`asyncTest()` pattern with `assert`, not node:test (matching all other test files in the repo).

**Tech Stack:** Node.js CommonJS (.cjs), ANSI escape codes (true-color), Unicode box-drawing characters, braille spinners. Zero external dependencies for the rendering layer.

**Design docs:**
- `docs/plans/2026-02-25-cortex-cli-renderer-design.md` -- Visual design
- `docs/plans/2026-02-25-cortex-cli-renderer-plan.md` -- Original task breakdown
- `docs/plans/2026-03-06-cortex-phases-b-cr-d-design-decisions.md` -- Revised decisions

**Dependencies:** None. Phase CR runs in parallel with B-D (no dependency chain).

**Current state:** CortexRenderer v1.0 already exists with static helpers (gradient, progressBar, formatTokenBudget, formatTime, stripAnsi), lifecycle methods (banner, begin, end), phase tracking, adapter result streaming, compact/quiet modes, spinner animation, and NO_COLOR support. This phase extends it with 11 new component capabilities.

**Version:** v3.0.0 (no version bump -- these are additive features to the existing renderer)
**Tasks:** 11 (CR1-CR11)
**Estimated Effort:** ~4 days

**See also:**
- [Unified Roadmap (Phases H-K)](2026-03-02-cortex-unified-roadmap-phases-h-k.md) -- dependency graph
- [Master Implementation Index](2026-03-02-cortex-implementation-index.md) -- links to all phase plans

---

## Phase CR: CortexRenderer (v3.0.0)

### Task CR1: CortexRenderer Base Class -- Streaming Output Engine

**Files:**
- Modify: `hooks/cli-renderer.cjs` (add buffer management, write/writeLine/flush, line width detection)
- Modify: `tests/test-cli-renderer.cjs` (add streaming output tests)

The existing CortexRenderer already has `_write()` and `_writeln()`. CR1 extends it with a proper buffered output engine: `write()`, `writeLine()`, `flush()`, buffer management for synchronized rendering, and line-width-aware text truncation.

**Step 1: Write failing tests for streaming output engine**

Append to `tests/test-cli-renderer.cjs` (before the Summary section):

```javascript
// =========================================================================
// CR1: Streaming Output Engine
// =========================================================================

console.log('\n  CortexRenderer -- CR1: Streaming Output Engine\n');

test('write() appends to buffer without flushing', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.write('hello');
  r.write(' world');
  // Nothing written yet (buffered)
  assert.strictEqual(getOutput(), '');
  r.flush();
  assert.strictEqual(getOutput(), 'hello world');
});

test('writeLine() appends line with newline to buffer', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.writeLine('line 1');
  r.writeLine('line 2');
  r.flush();
  assert.strictEqual(getOutput(), 'line 1\nline 2\n');
});

test('flush() writes buffer to stream and clears it', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.write('data');
  r.flush();
  assert.strictEqual(getOutput(), 'data');
  // Second flush writes nothing extra
  r.flush();
  assert.strictEqual(getOutput(), 'data');
});

test('flush() wraps output in sync sequences when interactive', () => {
  const { stream, getOutput } = createCapture();
  stream.isTTY = true;
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.write('content');
  r.flush();
  const out = getOutput();
  assert.ok(out.includes('\x1b[?2026h'), 'Should have sync start');
  assert.ok(out.includes('\x1b[?2026l'), 'Should have sync end');
  assert.ok(out.includes('content'), 'Should have content');
});

test('flush() does not use sync sequences when not interactive', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full', noColor: true });
  r.write('content');
  r.flush();
  const out = getOutput();
  assert.ok(!out.includes('\x1b[?2026h'), 'No sync start in non-interactive');
  assert.strictEqual(out, 'content');
});

test('getColumns() returns stream columns or default 80', () => {
  const { stream } = createCapture();
  stream.columns = 120;
  const r = new CortexRenderer({ stream });
  assert.strictEqual(r.getColumns(), 120);

  const s2 = new Writable({ write(_c, _e, cb) { cb(); } });
  const r2 = new CortexRenderer({ stream: s2 });
  assert.strictEqual(r2.getColumns(), 80);
});

test('truncate() cuts text at width with ellipsis', () => {
  const r = new CortexRenderer({ stream: new Writable({ write(_c, _e, cb) { cb(); } }) });
  assert.strictEqual(CortexRenderer.truncate('hello world', 8), 'hello...');
  assert.strictEqual(CortexRenderer.truncate('short', 10), 'short');
  assert.strictEqual(CortexRenderer.truncate('ab', 2), 'ab');
  assert.strictEqual(CortexRenderer.truncate('abc', 2), '..');
});

test('pad() pads text to width with alignment', () => {
  assert.strictEqual(CortexRenderer.pad('hi', 6, 'left'), 'hi    ');
  assert.strictEqual(CortexRenderer.pad('hi', 6, 'right'), '    hi');
  assert.strictEqual(CortexRenderer.pad('hi', 6, 'center'), '  hi  ');
  assert.strictEqual(CortexRenderer.pad('hello world', 5, 'left'), 'hello world'); // no truncation
});

test('visibleLength() counts characters without ANSI codes', () => {
  assert.strictEqual(CortexRenderer.visibleLength('\x1b[32mhello\x1b[0m'), 5);
  assert.strictEqual(CortexRenderer.visibleLength('plain'), 5);
  assert.strictEqual(CortexRenderer.visibleLength(''), 0);
});
```

**Step 2: Run tests to verify they fail**

Run: `node tests/test-cli-renderer.cjs`
Expected: FAIL -- `r.write is not a function` (public write/writeLine/flush don't exist yet)

**Step 3: Implementation -- add streaming engine to CortexRenderer**

Add these methods and statics to the `CortexRenderer` class in `hooks/cli-renderer.cjs`:

```javascript
  // ---------------------------------------------------------------------------
  // CR1: STREAMING OUTPUT ENGINE (buffered writes with sync rendering)
  // ---------------------------------------------------------------------------

  /**
   * Append raw text to the output buffer (no newline)
   * @param {string} text
   */
  write(text) {
    this._buffer += text;
  }

  /**
   * Append a line to the output buffer (with trailing newline)
   * @param {string} text
   */
  writeLine(text) {
    this._buffer += (text || '') + '\n';
  }

  /**
   * Flush the buffer to the output stream.
   * Wraps in synchronized rendering sequences when interactive.
   */
  flush() {
    if (this._buffer.length === 0) return;

    if (this._isInteractive) {
      this.stream.write(SYNC_START);
      this.stream.write(this._buffer);
      this.stream.write(SYNC_END);
    } else {
      this.stream.write(this._buffer);
    }
    this._buffer = '';
  }

  /**
   * Get terminal column width
   * @returns {number}
   */
  getColumns() {
    return this.stream.columns || 80;
  }

  // ---------------------------------------------------------------------------
  // CR1: STATIC TEXT UTILITIES
  // ---------------------------------------------------------------------------

  /**
   * Truncate text to maxWidth with ellipsis
   * @param {string} text
   * @param {number} maxWidth
   * @returns {string}
   */
  static truncate(text, maxWidth) {
    if (maxWidth < 3) {
      return '.'.repeat(maxWidth);
    }
    if (text.length <= maxWidth) return text;
    return text.slice(0, maxWidth - 3) + '...';
  }

  /**
   * Pad text to width with alignment
   * @param {string} text
   * @param {number} width
   * @param {'left'|'right'|'center'} align
   * @returns {string}
   */
  static pad(text, width, align = 'left') {
    if (text.length >= width) return text;
    const gap = width - text.length;
    switch (align) {
      case 'right': return ' '.repeat(gap) + text;
      case 'center': {
        const left = Math.floor(gap / 2);
        const right = gap - left;
        return ' '.repeat(left) + text + ' '.repeat(right);
      }
      default: return text + ' '.repeat(gap);
    }
  }

  /**
   * Count visible characters (excluding ANSI escape codes)
   * @param {string} str
   * @returns {number}
   */
  static visibleLength(str) {
    return CortexRenderer.stripAnsi(str).length;
  }
```

Also add `this._buffer = '';` to the constructor.

**Step 4: Run tests to verify they pass**

Run: `node tests/test-cli-renderer.cjs`
Expected: All tests PASS (existing 44 + 10 new = 54 total)

**Step 5: Commit**

```bash
git add hooks/cli-renderer.cjs tests/test-cli-renderer.cjs
git commit -m "feat(CR1): add streaming output engine with buffer, flush, truncate, pad, visibleLength"
```

---

### Task CR2: Box Drawing System

**Files:**
- Modify: `hooks/cli-renderer.cjs` (add BoxRenderer component)
- Modify: `tests/test-cli-renderer.cjs` (add box drawing tests)

**Step 1: Write failing tests for box drawing**

Append to `tests/test-cli-renderer.cjs`:

```javascript
// =========================================================================
// CR2: Box Drawing System
// =========================================================================

console.log('\n  CortexRenderer -- CR2: Box Drawing System\n');

const { BoxRenderer } = require('../hooks/cli-renderer.cjs');

test('BoxRenderer exists and can be instantiated', () => {
  const box = new BoxRenderer();
  assert.ok(box);
});

test('rounded style uses correct unicode chars', () => {
  const box = new BoxRenderer({ style: 'rounded' });
  const result = box.render({ content: 'hello' });
  const stripped = CortexRenderer.stripAnsi(result);
  assert.ok(stripped.includes('\u256d'), 'Should have rounded top-left corner');
  assert.ok(stripped.includes('\u256e'), 'Should have rounded top-right corner');
  assert.ok(stripped.includes('\u2570'), 'Should have rounded bottom-left corner');
  assert.ok(stripped.includes('\u256f'), 'Should have rounded bottom-right corner');
  assert.ok(stripped.includes('hello'), 'Should contain content');
});

test('sharp style uses box-drawing chars', () => {
  const box = new BoxRenderer({ style: 'sharp' });
  const result = box.render({ content: 'test' });
  const stripped = CortexRenderer.stripAnsi(result);
  assert.ok(stripped.includes('\u250c'), 'Should have sharp top-left');
  assert.ok(stripped.includes('\u2510'), 'Should have sharp top-right');
  assert.ok(stripped.includes('\u2514'), 'Should have sharp bottom-left');
  assert.ok(stripped.includes('\u2518'), 'Should have sharp bottom-right');
});

test('double style uses double-line chars', () => {
  const box = new BoxRenderer({ style: 'double' });
  const result = box.render({ content: 'test' });
  const stripped = CortexRenderer.stripAnsi(result);
  assert.ok(stripped.includes('\u2554'), 'Should have double top-left');
  assert.ok(stripped.includes('\u2557'), 'Should have double top-right');
});

test('heavy style uses heavy box chars', () => {
  const box = new BoxRenderer({ style: 'heavy' });
  const result = box.render({ content: 'test' });
  const stripped = CortexRenderer.stripAnsi(result);
  assert.ok(stripped.includes('\u250f'), 'Should have heavy top-left');
  assert.ok(stripped.includes('\u2513'), 'Should have heavy top-right');
});

test('box with header shows header section', () => {
  const box = new BoxRenderer({ style: 'rounded' });
  const result = box.render({ header: 'Title', content: 'body text' });
  const stripped = CortexRenderer.stripAnsi(result);
  assert.ok(stripped.includes('Title'), 'Should contain header');
  assert.ok(stripped.includes('body text'), 'Should contain content');
  // Header separator
  assert.ok(stripped.includes('\u2502') || stripped.includes('\u2551') || stripped.includes('\u2503'),
    'Should have vertical borders');
});

test('box with footer shows footer section', () => {
  const box = new BoxRenderer({ style: 'rounded' });
  const result = box.render({ content: 'main', footer: 'status bar' });
  const stripped = CortexRenderer.stripAnsi(result);
  assert.ok(stripped.includes('main'), 'Should contain content');
  assert.ok(stripped.includes('status bar'), 'Should contain footer');
});

test('box with header and footer', () => {
  const box = new BoxRenderer({ style: 'rounded' });
  const result = box.render({ header: 'HEAD', content: 'BODY', footer: 'FOOT' });
  const stripped = CortexRenderer.stripAnsi(result);
  assert.ok(stripped.includes('HEAD'));
  assert.ok(stripped.includes('BODY'));
  assert.ok(stripped.includes('FOOT'));
});

test('box wraps multi-line content', () => {
  const box = new BoxRenderer({ style: 'rounded', width: 30 });
  const result = box.render({ content: 'line one\nline two\nline three' });
  const stripped = CortexRenderer.stripAnsi(result);
  assert.ok(stripped.includes('line one'), 'Should have line one');
  assert.ok(stripped.includes('line two'), 'Should have line two');
  assert.ok(stripped.includes('line three'), 'Should have line three');
});

test('box respects width option', () => {
  const box = new BoxRenderer({ style: 'rounded', width: 20 });
  const result = box.render({ content: 'hello' });
  const lines = CortexRenderer.stripAnsi(result).split('\n').filter(l => l.length > 0);
  // All lines should be exactly 20 chars wide
  for (const line of lines) {
    assert.strictEqual(line.length, 20, `Line "${line}" should be 20 chars, got ${line.length}`);
  }
});

test('box with padding adds inner spacing', () => {
  const box = new BoxRenderer({ style: 'rounded', width: 20, padding: 1 });
  const result = box.render({ content: 'hi' });
  const stripped = CortexRenderer.stripAnsi(result);
  // Content line should have padding space before content
  const contentLine = stripped.split('\n').find(l => l.includes('hi'));
  assert.ok(contentLine, 'Should find content line');
  // The content should not be flush against the border
  const afterBorder = contentLine.indexOf('hi');
  assert.ok(afterBorder > 2, 'Content should have padding from border');
});

test('noColor box has no ANSI sequences', () => {
  const box = new BoxRenderer({ style: 'rounded', noColor: true });
  const result = box.render({ header: 'Test', content: 'body' });
  assert.ok(!result.includes('\x1b'), 'Should have no ANSI codes');
  assert.ok(result.includes('Test'), 'Should have header content');
  assert.ok(result.includes('body'), 'Should have body content');
});

test('nested box renders inner box inside outer', () => {
  const outer = new BoxRenderer({ style: 'rounded', width: 40 });
  const inner = new BoxRenderer({ style: 'sharp', width: 30, noColor: true });
  const innerResult = inner.render({ content: 'nested' });
  const result = outer.render({ content: innerResult });
  const stripped = CortexRenderer.stripAnsi(result);
  assert.ok(stripped.includes('nested'), 'Should contain nested content');
  // Should have both rounded AND sharp corners
  assert.ok(stripped.includes('\u256d'), 'Should have outer rounded corner');
  assert.ok(stripped.includes('\u250c'), 'Should have inner sharp corner');
});
```

**Step 2: Run tests to verify they fail**

Run: `node tests/test-cli-renderer.cjs`
Expected: FAIL -- `BoxRenderer is not a function`

**Step 3: Implementation -- BoxRenderer class**

Add to `hooks/cli-renderer.cjs` before the exports:

```javascript
// =============================================================================
// CR2: BOX DRAWING SYSTEM
// =============================================================================

const BOX_STYLES = {
  rounded: {
    tl: '\u256d', tr: '\u256e', bl: '\u2570', br: '\u256f',
    h: '\u2500', v: '\u2502',
    teeL: '\u251c', teeR: '\u2524',
  },
  sharp: {
    tl: '\u250c', tr: '\u2510', bl: '\u2514', br: '\u2518',
    h: '\u2500', v: '\u2502',
    teeL: '\u251c', teeR: '\u2524',
  },
  double: {
    tl: '\u2554', tr: '\u2557', bl: '\u255a', br: '\u255d',
    h: '\u2550', v: '\u2551',
    teeL: '\u2560', teeR: '\u2563',
  },
  heavy: {
    tl: '\u250f', tr: '\u2513', bl: '\u2517', br: '\u251b',
    h: '\u2501', v: '\u2503',
    teeL: '\u2523', teeR: '\u252b',
  },
};

class BoxRenderer {
  /**
   * @param {Object} options
   * @param {'rounded'|'sharp'|'double'|'heavy'} [options.style='rounded']
   * @param {number} [options.width] - Fixed width (auto if not set)
   * @param {number} [options.padding=1] - Inner horizontal padding
   * @param {boolean} [options.noColor=false]
   * @param {string} [options.borderColor] - ANSI color code for border
   * @param {string} [options.headerColor] - ANSI color code for header
   */
  constructor(options = {}) {
    this.style = BOX_STYLES[options.style] || BOX_STYLES.rounded;
    this.width = options.width || 0; // 0 = auto
    this.padding = options.padding !== undefined ? options.padding : 1;
    this.noColor = options.noColor || false;
    this.borderColor = options.borderColor || GRAY;
    this.headerColor = options.headerColor || (BOLD + WHITE);
  }

  /**
   * Render a box with optional header, content, and footer
   * @param {Object} parts
   * @param {string} [parts.header]
   * @param {string} parts.content
   * @param {string} [parts.footer]
   * @returns {string}
   */
  render(parts) {
    const { header, content, footer } = parts;
    const s = this.style;

    // Determine width
    const contentLines = (content || '').split('\n');
    const allText = [
      ...(header ? [header] : []),
      ...contentLines,
      ...(footer ? [footer] : []),
    ];
    const maxContentWidth = allText.reduce((max, line) => {
      const len = CortexRenderer.visibleLength(line);
      return len > max ? len : max;
    }, 0);

    const innerWidth = this.width
      ? this.width - 2 // subtract borders
      : maxContentWidth + (this.padding * 2);
    const totalWidth = innerWidth + 2; // add borders

    const lines = [];
    const bc = this.noColor ? '' : this.borderColor;
    const rst = this.noColor ? '' : RST;
    const hc = this.noColor ? '' : this.headerColor;

    // Top border
    lines.push(`${bc}${s.tl}${s.h.repeat(innerWidth)}${s.tr}${rst}`);

    // Header
    if (header) {
      const padded = this._padLine(header, innerWidth);
      lines.push(`${bc}${s.v}${rst}${hc}${padded}${rst}${bc}${s.v}${rst}`);
      // Header separator
      lines.push(`${bc}${s.teeL}${s.h.repeat(innerWidth)}${s.teeR}${rst}`);
    }

    // Content lines
    for (const line of contentLines) {
      const padded = this._padLine(line, innerWidth);
      lines.push(`${bc}${s.v}${rst}${padded}${bc}${s.v}${rst}`);
    }

    // Footer separator + footer
    if (footer) {
      lines.push(`${bc}${s.teeL}${s.h.repeat(innerWidth)}${s.teeR}${rst}`);
      const padded = this._padLine(footer, innerWidth);
      lines.push(`${bc}${s.v}${rst}${padded}${bc}${s.v}${rst}`);
    }

    // Bottom border
    lines.push(`${bc}${s.bl}${s.h.repeat(innerWidth)}${s.br}${rst}`);

    return lines.join('\n');
  }

  /**
   * Pad a line to fill the inner width with horizontal padding
   * @private
   */
  _padLine(text, innerWidth) {
    const visLen = CortexRenderer.visibleLength(text);
    const paddedText = ' '.repeat(this.padding) + text;
    const paddedLen = this.padding + visLen;
    const remaining = innerWidth - paddedLen;
    return paddedText + (remaining > 0 ? ' '.repeat(remaining) : '');
  }
}
```

Add `BoxRenderer` to the exports:

```javascript
module.exports = {
  CortexRenderer,
  BoxRenderer,
  // Re-export constants for testing
  _ANSI: { RST, BOLD, DIM, GREEN, YELLOW, RED, CYAN, GRAY, WHITE, rgb,
           HIDE_CURSOR, SHOW_CURSOR, CLEAR_LINE, SYNC_START, SYNC_END, SPINNER },
  _GRADIENT: { FROM: GRADIENT_FROM, TO: GRADIENT_TO },
};
```

**Step 4: Run tests to verify they pass**

Run: `node tests/test-cli-renderer.cjs`
Expected: All tests PASS (54 + 13 new = 67 total)

**Step 5: Commit**

```bash
git add hooks/cli-renderer.cjs tests/test-cli-renderer.cjs
git commit -m "feat(CR2): add BoxRenderer with rounded/sharp/double/heavy styles, header/footer, nesting"
```

---

### Task CR3: Color System

**Files:**
- Modify: `hooks/cli-renderer.cjs` (add ColorSystem and Theme)
- Modify: `tests/test-cli-renderer.cjs` (add color system tests)

**Step 1: Write failing tests for color system**

Append to `tests/test-cli-renderer.cjs`:

```javascript
// =========================================================================
// CR3: Color System
// =========================================================================

console.log('\n  CortexRenderer -- CR3: Color System\n');

const { ColorSystem } = require('../hooks/cli-renderer.cjs');

test('ColorSystem exists', () => {
  assert.ok(ColorSystem);
});

test('ColorSystem.rgb returns correct ANSI true-color sequence', () => {
  const result = ColorSystem.rgb(255, 100, 50);
  assert.strictEqual(result, '\x1b[38;2;255;100;50m');
});

test('ColorSystem.bgRgb returns correct background color', () => {
  const result = ColorSystem.bgRgb(255, 100, 50);
  assert.strictEqual(result, '\x1b[48;2;255;100;50m');
});

test('ColorSystem.ansi256 returns correct 256-color sequence', () => {
  const result = ColorSystem.ansi256(196);
  assert.strictEqual(result, '\x1b[38;5;196m');
});

test('ColorSystem.bgAnsi256 returns background 256-color', () => {
  const result = ColorSystem.bgAnsi256(33);
  assert.strictEqual(result, '\x1b[48;5;33m');
});

test('ColorSystem.detectColorSupport returns a valid level', () => {
  const level = ColorSystem.detectColorSupport();
  assert.ok([0, 1, 2, 3].includes(level),
    `Level should be 0-3, got ${level}`);
});

test('ColorSystem.colorize wraps text with color and reset', () => {
  const result = ColorSystem.colorize('hello', '\x1b[32m');
  assert.strictEqual(result, '\x1b[32mhello\x1b[0m');
});

test('ColorSystem.colorize with noColor returns plain text', () => {
  const result = ColorSystem.colorize('hello', '\x1b[32m', true);
  assert.strictEqual(result, 'hello');
});

test('ColorSystem has standard named colors', () => {
  assert.ok(ColorSystem.colors.red, 'Should have red');
  assert.ok(ColorSystem.colors.green, 'Should have green');
  assert.ok(ColorSystem.colors.cyan, 'Should have cyan');
  assert.ok(ColorSystem.colors.gray, 'Should have gray');
  assert.ok(ColorSystem.colors.yellow, 'Should have yellow');
  assert.ok(ColorSystem.colors.white, 'Should have white');
});

test('Theme neural has correct palette', () => {
  const theme = ColorSystem.getTheme('neural');
  assert.ok(theme, 'Should return a theme');
  assert.ok(theme.primary, 'Should have primary color');
  assert.ok(theme.secondary, 'Should have secondary color');
  assert.ok(theme.success, 'Should have success color');
  assert.ok(theme.warning, 'Should have warning color');
  assert.ok(theme.error, 'Should have error color');
  assert.ok(theme.muted, 'Should have muted color');
});

test('Theme ocean has different colors than neural', () => {
  const neural = ColorSystem.getTheme('neural');
  const ocean = ColorSystem.getTheme('ocean');
  assert.ok(ocean, 'Should return ocean theme');
  // At least the primary should differ
  assert.notStrictEqual(neural.primary, ocean.primary, 'Themes should have different primaries');
});

test('getTheme with unknown name returns neural as default', () => {
  const theme = ColorSystem.getTheme('nonexistent');
  const neural = ColorSystem.getTheme('neural');
  assert.strictEqual(theme.primary, neural.primary, 'Unknown theme should default to neural');
});

test('graceful degradation: level 0 strips all color', () => {
  const result = ColorSystem.applyWithLevel('hello', '\x1b[38;2;255;0;0m', 0);
  assert.strictEqual(result, 'hello');
});

test('graceful degradation: level 1 converts true-color to basic', () => {
  // Level 1 = basic 16 colors. True-color should fall back.
  const result = ColorSystem.applyWithLevel('hello', '\x1b[38;2;255;0;0m', 1);
  // Should use basic red (\x1b[31m) or similar
  assert.ok(!result.includes('\x1b[38;2;'), 'Should not contain true-color at level 1');
  assert.ok(result.includes('\x1b['), 'Should still have ANSI codes at level 1');
});
```

**Step 2: Run tests to verify they fail**

Run: `node tests/test-cli-renderer.cjs`
Expected: FAIL -- `ColorSystem is not a function`

**Step 3: Implementation -- ColorSystem class**

Add to `hooks/cli-renderer.cjs` before the exports:

```javascript
// =============================================================================
// CR3: COLOR SYSTEM
// =============================================================================

const THEMES = {
  neural: {
    primary: rgb(0, 200, 255),      // cyan
    secondary: rgb(120, 80, 255),   // purple
    success: GREEN,
    warning: YELLOW,
    error: RED,
    muted: GRAY,
    text: WHITE,
    dim: DIM,
    gradientFrom: [0, 200, 255],
    gradientTo: [120, 80, 255],
  },
  ocean: {
    primary: rgb(0, 150, 200),      // deep teal
    secondary: rgb(0, 80, 180),     // navy
    success: rgb(0, 200, 120),      // sea green
    warning: rgb(255, 180, 50),     // amber
    error: rgb(255, 80, 80),        // coral
    muted: rgb(100, 120, 140),      // steel
    text: WHITE,
    dim: DIM,
    gradientFrom: [0, 150, 200],
    gradientTo: [0, 80, 180],
  },
  ember: {
    primary: rgb(255, 120, 50),     // orange
    secondary: rgb(200, 50, 80),    // crimson
    success: rgb(120, 200, 50),     // lime
    warning: rgb(255, 200, 0),      // gold
    error: rgb(255, 50, 50),        // bright red
    muted: rgb(140, 120, 100),      // warm gray
    text: WHITE,
    dim: DIM,
    gradientFrom: [255, 120, 50],
    gradientTo: [200, 50, 80],
  },
  monochrome: {
    primary: WHITE,
    secondary: GRAY,
    success: WHITE,
    warning: WHITE,
    error: WHITE,
    muted: GRAY,
    text: WHITE,
    dim: DIM,
    gradientFrom: [200, 200, 200],
    gradientTo: [120, 120, 120],
  },
};

// Mapping from true-color to basic 16-color fallback
const TRUE_COLOR_TO_BASIC = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

class ColorSystem {
  /**
   * Generate true-color (24-bit) foreground ANSI sequence
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @returns {string}
   */
  static rgb(r, g, b) {
    return `\x1b[38;2;${r};${g};${b}m`;
  }

  /**
   * Generate true-color (24-bit) background ANSI sequence
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @returns {string}
   */
  static bgRgb(r, g, b) {
    return `\x1b[48;2;${r};${g};${b}m`;
  }

  /**
   * Generate 256-color foreground sequence
   * @param {number} code - 0-255
   * @returns {string}
   */
  static ansi256(code) {
    return `\x1b[38;5;${code}m`;
  }

  /**
   * Generate 256-color background sequence
   * @param {number} code - 0-255
   * @returns {string}
   */
  static bgAnsi256(code) {
    return `\x1b[48;5;${code}m`;
  }

  /**
   * Detect terminal color support level
   * @returns {number} 0=none, 1=basic(16), 2=256, 3=truecolor(16M)
   */
  static detectColorSupport() {
    if (process.env.NO_COLOR) return 0;
    if (process.env.FORCE_COLOR) {
      const fc = parseInt(process.env.FORCE_COLOR, 10);
      if (fc >= 0 && fc <= 3) return fc;
    }
    if (process.env.COLORTERM === 'truecolor' || process.env.COLORTERM === '24bit') return 3;
    if (process.env.TERM_PROGRAM === 'iTerm.app') return 3;
    if (process.env.TERM_PROGRAM === 'Hyper') return 3;
    if (process.env.TERM && process.env.TERM.includes('256color')) return 2;
    if (process.stdout.isTTY) return 1;
    return 0;
  }

  /**
   * Wrap text in ANSI color code
   * @param {string} text
   * @param {string} color - ANSI escape code
   * @param {boolean} [noColor=false]
   * @returns {string}
   */
  static colorize(text, color, noColor = false) {
    if (noColor) return text;
    return color + text + RST;
  }

  /**
   * Apply color with level-appropriate degradation
   * @param {string} text
   * @param {string} color - ANSI sequence (may be true-color)
   * @param {number} level - 0-3
   * @returns {string}
   */
  static applyWithLevel(text, color, level) {
    if (level === 0) return text;
    if (level >= 3 || !color.includes('\x1b[38;2;')) {
      return color + text + RST;
    }
    // Level 1-2: degrade true-color to nearest basic color
    const match = color.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
    if (!match) return color + text + RST;
    const [, r, g, b] = match.map(Number);
    const fallback = ColorSystem._nearestBasic(r, g, b);
    return fallback + text + RST;
  }

  /**
   * Find nearest basic ANSI color for given RGB
   * @private
   */
  static _nearestBasic(r, g, b) {
    if (r > 180 && g < 100 && b < 100) return '\x1b[31m'; // red
    if (r < 100 && g > 150 && b < 100) return '\x1b[32m'; // green
    if (r > 180 && g > 150 && b < 80)  return '\x1b[33m'; // yellow
    if (r < 100 && g < 100 && b > 150) return '\x1b[34m'; // blue
    if (r > 150 && g < 100 && b > 150) return '\x1b[35m'; // magenta
    if (r < 100 && g > 150 && b > 150) return '\x1b[36m'; // cyan
    if (r > 150 && g > 150 && b > 150) return '\x1b[37m'; // white
    return '\x1b[90m'; // gray (default fallback)
  }

  /**
   * Get a named theme
   * @param {string} name
   * @returns {Object}
   */
  static getTheme(name) {
    return THEMES[name] || THEMES.neural;
  }

  /**
   * Standard named colors (basic ANSI)
   */
  static get colors() {
    return {
      red: RED,
      green: GREEN,
      yellow: YELLOW,
      cyan: CYAN,
      gray: GRAY,
      white: WHITE,
      bold: BOLD,
      dim: DIM,
      reset: RST,
    };
  }
}
```

Add `ColorSystem` to exports.

**Step 4: Run tests to verify they pass**

Run: `node tests/test-cli-renderer.cjs`
Expected: All tests PASS (67 + 15 new = 82 total)

**Step 5: Commit**

```bash
git add hooks/cli-renderer.cjs tests/test-cli-renderer.cjs
git commit -m "feat(CR3): add ColorSystem with themes (neural/ocean/ember/monochrome), 256-color, true-color, graceful degradation"
```

---

### Task CR4: Progress Indicators

**Files:**
- Modify: `hooks/cli-renderer.cjs` (add ProgressIndicators)
- Modify: `tests/test-cli-renderer.cjs` (add progress tests)

**Step 1: Write failing tests**

Append to `tests/test-cli-renderer.cjs`:

```javascript
// =========================================================================
// CR4: Progress Indicators
// =========================================================================

console.log('\n  CortexRenderer -- CR4: Progress Indicators\n');

const { ProgressIndicators } = require('../hooks/cli-renderer.cjs');

test('ProgressIndicators exists', () => {
  assert.ok(ProgressIndicators);
});

test('spinner has at least 12 animation frames', () => {
  const frames = ProgressIndicators.spinnerFrames();
  assert.ok(frames.length >= 12, `Expected >=12 frames, got ${frames.length}`);
  // All frames should be single-character-width
  for (const frame of frames) {
    assert.ok(frame.length >= 1, 'Frame should be at least 1 char');
  }
});

test('spinner frame cycles through all frames', () => {
  const frames = ProgressIndicators.spinnerFrames();
  for (let i = 0; i < frames.length * 2; i++) {
    const frame = ProgressIndicators.spinnerFrame(i);
    assert.strictEqual(frame, frames[i % frames.length]);
  }
});

test('renderProgressBar returns correct structure', () => {
  const bar = ProgressIndicators.renderProgressBar(50, 100, { width: 20, useColor: false });
  assert.ok(bar.includes('#'), 'Should have filled chars');
  assert.ok(bar.includes('.'), 'Should have empty chars');
  assert.ok(!bar.includes('\x1b'), 'No ANSI when useColor is false');
});

test('renderProgressBar at 0% shows no fill', () => {
  const bar = ProgressIndicators.renderProgressBar(0, 100, { width: 10, useColor: false });
  const hashes = (bar.match(/#/g) || []).length;
  assert.strictEqual(hashes, 0);
});

test('renderProgressBar at 100% shows full fill', () => {
  const bar = ProgressIndicators.renderProgressBar(100, 100, { width: 10, useColor: false });
  const hashes = (bar.match(/#/g) || []).length;
  assert.strictEqual(hashes, 10);
});

test('renderProgressBar with percentage label', () => {
  const bar = ProgressIndicators.renderProgressBar(75, 100, {
    width: 10, useColor: false, showPercent: true
  });
  assert.ok(bar.includes('75%'), 'Should include percentage');
});

test('renderProgressBar with color uses ANSI', () => {
  const bar = ProgressIndicators.renderProgressBar(50, 100, { width: 10, useColor: true });
  assert.ok(bar.includes('\x1b'), 'Should include ANSI when color enabled');
});

test('renderStepIndicator shows current/total format', () => {
  const step = ProgressIndicators.renderStepIndicator(2, 5, { useColor: false });
  assert.ok(step.includes('2'), 'Should include current step');
  assert.ok(step.includes('5'), 'Should include total steps');
});

test('renderStepIndicator with label', () => {
  const step = ProgressIndicators.renderStepIndicator(3, 10, {
    useColor: false, label: 'Processing'
  });
  assert.ok(step.includes('Processing'), 'Should include label');
  assert.ok(step.includes('3'), 'Should include step number');
});

test('renderStepIndicator with color', () => {
  const step = ProgressIndicators.renderStepIndicator(1, 5, { useColor: true });
  assert.ok(step.includes('\x1b'), 'Should include ANSI when color enabled');
});

test('renderStepIndicator marks completed steps', () => {
  const step1 = ProgressIndicators.renderStepIndicator(1, 3, { useColor: false });
  const step3 = ProgressIndicators.renderStepIndicator(3, 3, { useColor: false });
  // Last step should have completion indicator
  assert.ok(step3.includes('3/3') || step3.includes('\u2713'), 'Should show completion');
});

test('dots spinner frames are different from braille', () => {
  const braille = ProgressIndicators.spinnerFrames('braille');
  const dots = ProgressIndicators.spinnerFrames('dots');
  assert.notStrictEqual(braille[0], dots[0], 'Different spinner types should have different frames');
});

test('spinner frame at negative index wraps', () => {
  const frame = ProgressIndicators.spinnerFrame(-1);
  assert.ok(frame, 'Should return a valid frame');
});
```

**Step 2: Run tests to verify they fail**

Run: `node tests/test-cli-renderer.cjs`
Expected: FAIL -- `ProgressIndicators is not a function`

**Step 3: Implementation -- ProgressIndicators class**

Add to `hooks/cli-renderer.cjs`:

```javascript
// =============================================================================
// CR4: PROGRESS INDICATORS
// =============================================================================

const SPINNER_TYPES = {
  braille: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  dots: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
  line: ['|', '/', '-', '\\'],
  circle: ['◐', '◓', '◑', '◒'],
  arc: ['◜', '◝', '◞', '◟'],
  bounce: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
  pulse: ['█', '▓', '▒', '░', '▒', '▓'],
  arrow: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
  moon: ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'],
  star: ['✶', '✸', '✹', '✺', '✹', '✸'],
  grow: ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█', '▉', '▊', '▋', '▌', '▍', '▎'],
  neural: ['⟐', '⟑', '⟐', '◇', '◆', '◇'],
};

class ProgressIndicators {
  /**
   * Get spinner animation frames
   * @param {string} [type='braille']
   * @returns {string[]}
   */
  static spinnerFrames(type = 'braille') {
    return SPINNER_TYPES[type] || SPINNER_TYPES.braille;
  }

  /**
   * Get a single spinner frame by index (wraps around)
   * @param {number} index
   * @param {string} [type='braille']
   * @returns {string}
   */
  static spinnerFrame(index, type = 'braille') {
    const frames = ProgressIndicators.spinnerFrames(type);
    const i = ((index % frames.length) + frames.length) % frames.length;
    return frames[i];
  }

  /**
   * Render a progress bar
   * @param {number} current - Current value
   * @param {number} total - Maximum value
   * @param {Object} [options]
   * @param {number} [options.width=20] - Bar width in characters
   * @param {boolean} [options.useColor=true]
   * @param {boolean} [options.showPercent=false] - Show percentage label
   * @param {string} [options.fillChar='█'] - Character for filled portion
   * @param {string} [options.emptyChar='░'] - Character for empty portion
   * @returns {string}
   */
  static renderProgressBar(current, total, options = {}) {
    const width = options.width || 20;
    const useColor = options.useColor !== false;
    const showPercent = options.showPercent || false;
    const fillChar = options.fillChar || (useColor ? '█' : '#');
    const emptyChar = options.emptyChar || (useColor ? '░' : '.');

    const pct = total > 0 ? Math.min(1, current / total) : 0;
    const filled = Math.round(pct * width);
    const empty = width - filled;

    let bar;
    if (useColor) {
      // Color based on percentage
      let color = GREEN;
      if (pct > 0.9) color = RED;
      else if (pct > 0.7) color = YELLOW;

      bar = color + fillChar.repeat(filled) + GRAY + emptyChar.repeat(empty) + RST;
    } else {
      bar = '[' + fillChar.repeat(filled) + emptyChar.repeat(empty) + ']';
    }

    if (showPercent) {
      const pctStr = `${Math.round(pct * 100)}%`;
      bar += ' ' + (useColor ? DIM + pctStr + RST : pctStr);
    }

    return bar;
  }

  /**
   * Render a step indicator (e.g., "Step 2/5 — Processing")
   * @param {number} current
   * @param {number} total
   * @param {Object} [options]
   * @param {boolean} [options.useColor=true]
   * @param {string} [options.label] - Optional step label
   * @returns {string}
   */
  static renderStepIndicator(current, total, options = {}) {
    const useColor = options.useColor !== false;
    const label = options.label || '';

    const isDone = current >= total;
    const marker = isDone ? '✓' : `${current}/${total}`;

    let result;
    if (useColor) {
      const markerColor = isDone ? GREEN : CYAN;
      result = `${markerColor}${marker}${RST}`;
      if (label) {
        result += ` ${WHITE}${label}${RST}`;
      }
    } else {
      result = marker;
      if (label) {
        result += ` ${label}`;
      }
    }

    return result;
  }
}
```

Add `ProgressIndicators` to exports.

**Step 4: Run tests to verify they pass**

Run: `node tests/test-cli-renderer.cjs`
Expected: All tests PASS (82 + 16 new = 98 total)

**Step 5: Commit**

```bash
git add hooks/cli-renderer.cjs tests/test-cli-renderer.cjs
git commit -m "feat(CR4): add ProgressIndicators with 12 spinner types, progress bars, step indicators"
```

---

### Task CR5: Table Renderer

**Files:**
- Modify: `hooks/cli-renderer.cjs` (add TableRenderer)
- Modify: `tests/test-cli-renderer.cjs` (add table tests)

**Step 1: Write failing tests**

Append to `tests/test-cli-renderer.cjs`:

```javascript
// =========================================================================
// CR5: Table Renderer
// =========================================================================

console.log('\n  CortexRenderer -- CR5: Table Renderer\n');

const { TableRenderer } = require('../hooks/cli-renderer.cjs');

test('TableRenderer exists', () => {
  assert.ok(TableRenderer);
});

test('basic table with headers and rows', () => {
  const table = new TableRenderer({
    columns: [
      { key: 'name', header: 'Name', width: 10 },
      { key: 'value', header: 'Value', width: 8 },
    ],
    noColor: true,
  });
  const result = table.render([
    { name: 'foo', value: '42' },
    { name: 'bar', value: '99' },
  ]);
  assert.ok(result.includes('Name'), 'Should have header');
  assert.ok(result.includes('Value'), 'Should have header');
  assert.ok(result.includes('foo'), 'Should have row data');
  assert.ok(result.includes('42'), 'Should have row data');
  assert.ok(result.includes('bar'), 'Should have row data');
  assert.ok(result.includes('99'), 'Should have row data');
});

test('table left-aligns by default', () => {
  const table = new TableRenderer({
    columns: [{ key: 'x', header: 'X', width: 10 }],
    noColor: true,
  });
  const result = table.render([{ x: 'hi' }]);
  const lines = result.split('\n');
  const dataLine = lines.find(l => l.includes('hi'));
  assert.ok(dataLine, 'Should find data line');
  // 'hi' should be followed by spaces (left-aligned)
  const pos = dataLine.indexOf('hi');
  assert.ok(pos < 5, 'Text should be near the left');
});

test('table right-aligns numeric columns', () => {
  const table = new TableRenderer({
    columns: [{ key: 'n', header: 'Num', width: 10, align: 'right' }],
    noColor: true,
  });
  const result = table.render([{ n: '42' }]);
  const lines = result.split('\n');
  const dataLine = lines.find(l => l.includes('42'));
  assert.ok(dataLine);
  // '42' should be near the right side
  const pos = dataLine.indexOf('42');
  assert.ok(pos >= 5, `Expected right-aligned, position was ${pos}`);
});

test('table center-aligns when specified', () => {
  const table = new TableRenderer({
    columns: [{ key: 'c', header: 'Center', width: 20, align: 'center' }],
    noColor: true,
  });
  const result = table.render([{ c: 'mid' }]);
  const lines = result.split('\n');
  const dataLine = lines.find(l => l.includes('mid'));
  assert.ok(dataLine);
  const pos = dataLine.indexOf('mid');
  assert.ok(pos > 3 && pos < 14, `Expected centered, position was ${pos}`);
});

test('auto-width calculation from data', () => {
  const table = new TableRenderer({
    columns: [
      { key: 'a', header: 'Column A' },  // no width specified
      { key: 'b', header: 'B' },
    ],
    noColor: true,
  });
  const result = table.render([
    { a: 'short', b: 'x' },
    { a: 'longer value here', b: 'yy' },
  ]);
  // Should not crash and should contain all data
  assert.ok(result.includes('longer value here'), 'Should contain longest value');
  assert.ok(result.includes('Column A'), 'Should contain header');
});

test('truncation with ellipsis when content exceeds width', () => {
  const table = new TableRenderer({
    columns: [{ key: 'text', header: 'Text', width: 8 }],
    noColor: true,
  });
  const result = table.render([{ text: 'this is too long for column' }]);
  assert.ok(result.includes('...'), 'Should truncate with ellipsis');
  assert.ok(!result.includes('this is too long for column'), 'Should not show full text');
});

test('header separator row present', () => {
  const table = new TableRenderer({
    columns: [{ key: 'x', header: 'X', width: 10 }],
    noColor: true,
  });
  const result = table.render([{ x: 'data' }]);
  const lines = result.split('\n');
  // Should have a separator line with dashes
  const sepLine = lines.find(l => l.includes('─') || l.includes('-'));
  assert.ok(sepLine, 'Should have header separator');
});

test('empty data shows header only', () => {
  const table = new TableRenderer({
    columns: [{ key: 'x', header: 'X', width: 10 }],
    noColor: true,
  });
  const result = table.render([]);
  assert.ok(result.includes('X'), 'Should still show header');
  const lines = result.split('\n').filter(l => l.trim());
  assert.ok(lines.length >= 2, 'Should have header + separator');
});

test('table with color includes ANSI codes', () => {
  const table = new TableRenderer({
    columns: [{ key: 'x', header: 'Name', width: 10 }],
  });
  const result = table.render([{ x: 'test' }]);
  assert.ok(result.includes('\x1b'), 'Should include ANSI codes');
});

test('table with color noColor has no ANSI', () => {
  const table = new TableRenderer({
    columns: [{ key: 'x', header: 'Name', width: 10 }],
    noColor: true,
  });
  const result = table.render([{ x: 'test' }]);
  assert.ok(!result.includes('\x1b'), 'Should have no ANSI');
});

test('compact table mode omits borders', () => {
  const table = new TableRenderer({
    columns: [
      { key: 'a', header: 'A', width: 6 },
      { key: 'b', header: 'B', width: 6 },
    ],
    noColor: true,
    compact: true,
  });
  const result = table.render([{ a: '1', b: '2' }]);
  assert.ok(!result.includes('│'), 'Compact mode should not have vertical borders');
});
```

**Step 2: Run tests to verify they fail**

Expected: FAIL -- `TableRenderer is not a function`

**Step 3: Implementation -- TableRenderer class**

```javascript
// =============================================================================
// CR5: TABLE RENDERER
// =============================================================================

class TableRenderer {
  /**
   * @param {Object} options
   * @param {Object[]} options.columns - Column definitions
   * @param {string} options.columns[].key - Data key
   * @param {string} options.columns[].header - Header label
   * @param {number} [options.columns[].width] - Fixed width (auto if omitted)
   * @param {'left'|'right'|'center'} [options.columns[].align='left']
   * @param {boolean} [options.noColor=false]
   * @param {boolean} [options.compact=false] - Omit vertical borders
   * @param {number} [options.colGap=2] - Gap between columns
   */
  constructor(options = {}) {
    this.columns = options.columns || [];
    this.noColor = options.noColor || false;
    this.compact = options.compact || false;
    this.colGap = options.colGap !== undefined ? options.colGap : 2;
  }

  /**
   * Render a table from data rows
   * @param {Object[]} rows
   * @returns {string}
   */
  render(rows) {
    const cols = this._computeWidths(rows);
    const lines = [];

    const bc = this.noColor ? '' : GRAY;
    const hc = this.noColor ? '' : (BOLD + WHITE);
    const rst = this.noColor ? '' : RST;
    const dc = this.noColor ? '' : DIM;

    // Header row
    const headerParts = cols.map(col => {
      const padded = CortexRenderer.pad(col.header, col.computedWidth, col.align || 'left');
      return `${hc}${padded}${rst}`;
    });
    lines.push(this.compact
      ? headerParts.join(' '.repeat(this.colGap))
      : headerParts.join(`${bc} \u2502 ${rst}`)
    );

    // Separator
    const sepParts = cols.map(col => (this.noColor ? '-' : '\u2500').repeat(col.computedWidth));
    lines.push(this.compact
      ? sepParts.join(' '.repeat(this.colGap))
      : sepParts.join(`${bc}\u2500\u253c\u2500${rst}`)
    );

    // Data rows
    for (const row of rows) {
      const cellParts = cols.map(col => {
        const raw = String(row[col.key] || '');
        const truncated = raw.length > col.computedWidth
          ? CortexRenderer.truncate(raw, col.computedWidth)
          : raw;
        return CortexRenderer.pad(truncated, col.computedWidth, col.align || 'left');
      });
      lines.push(this.compact
        ? cellParts.join(' '.repeat(this.colGap))
        : cellParts.join(`${dc} \u2502 ${rst}`)
      );
    }

    return lines.join('\n');
  }

  /**
   * Compute column widths from data when not specified
   * @private
   */
  _computeWidths(rows) {
    return this.columns.map(col => {
      if (col.width) {
        return { ...col, computedWidth: col.width };
      }
      // Auto-width: max of header and all data values
      let maxWidth = col.header.length;
      for (const row of rows) {
        const val = String(row[col.key] || '');
        if (val.length > maxWidth) maxWidth = val.length;
      }
      return { ...col, computedWidth: maxWidth };
    });
  }
}
```

Add `TableRenderer` to exports.

**Step 4: Run tests to verify they pass**

Run: `node tests/test-cli-renderer.cjs`
Expected: All tests PASS (98 + 12 new = 110 total)

**Step 5: Commit**

```bash
git add hooks/cli-renderer.cjs tests/test-cli-renderer.cjs
git commit -m "feat(CR5): add TableRenderer with auto-width, alignment, truncation, compact mode"
```

---

### Task CR6: Memory Card Component

**Files:**
- Modify: `hooks/cli-renderer.cjs` (add MemoryCard)
- Modify: `tests/test-cli-renderer.cjs` (add memory card tests)

**Step 1: Write failing tests**

```javascript
// =========================================================================
// CR6: Memory Card Component
// =========================================================================

console.log('\n  CortexRenderer -- CR6: Memory Card Component\n');

const { MemoryCard } = require('../hooks/cli-renderer.cjs');

test('MemoryCard exists', () => {
  assert.ok(MemoryCard);
});

test('compact view shows single line with type and summary', () => {
  const card = MemoryCard.compact({
    type: 'learning',
    summary: 'Use --force flag carefully',
    tags: ['git', 'safety'],
    source: 'jsonl',
  }, { noColor: true });
  assert.ok(card.includes('learning') || card.includes('learn'), 'Should show type');
  assert.ok(card.includes('Use --force'), 'Should show summary');
  const lines = card.split('\n').filter(l => l.trim());
  assert.strictEqual(lines.length, 1, 'Compact should be single line');
});

test('expanded view shows full content with box', () => {
  const card = MemoryCard.expanded({
    type: 'pattern',
    summary: 'Always validate inputs',
    content: 'When building CLI tools, always validate all user inputs\nbefore processing them.',
    tags: ['cli', 'validation', 'best-practice'],
    source: 'jsonl',
    relevanceScore: 0.92,
    createdAt: '2026-02-15T10:30:00Z',
  }, { noColor: true });
  assert.ok(card.includes('pattern') || card.includes('PATTERN'), 'Should show type');
  assert.ok(card.includes('Always validate'), 'Should show summary');
  assert.ok(card.includes('validate all user'), 'Should show content');
  assert.ok(card.includes('cli'), 'Should show tags');
  assert.ok(card.includes('0.92') || card.includes('92'), 'Should show relevance');
  const lines = card.split('\n').filter(l => l.trim());
  assert.ok(lines.length > 3, 'Expanded should be multi-line');
});

test('compact view with color includes ANSI', () => {
  const card = MemoryCard.compact({
    type: 'skill',
    summary: 'Git rebase workflow',
    tags: ['git'],
    source: 'claudemd',
  }, { noColor: false });
  assert.ok(card.includes('\x1b'), 'Should have ANSI codes');
});

test('expanded view shows source attribution', () => {
  const card = MemoryCard.expanded({
    type: 'correction',
    summary: 'Fix: use npm ci not npm install in CI',
    content: 'npm ci is faster and deterministic for CI environments.',
    tags: ['npm', 'ci'],
    source: 'episodic-memory',
    relevanceScore: 0.85,
  }, { noColor: true });
  assert.ok(card.includes('episodic') || card.includes('episodic-memory'),
    'Should show source');
});

test('compact handles missing optional fields', () => {
  const card = MemoryCard.compact({
    type: 'general',
    summary: 'Some note',
  }, { noColor: true });
  assert.ok(card.includes('Some note'), 'Should still render');
  assert.ok(!card.includes('undefined'), 'No undefined in output');
  assert.ok(!card.includes('null'), 'No null in output');
});

test('expanded handles missing optional fields', () => {
  const card = MemoryCard.expanded({
    type: 'learning',
    summary: 'Brief',
    content: 'Full content here.',
  }, { noColor: true });
  assert.ok(card.includes('Full content'), 'Should show content');
  assert.ok(!card.includes('undefined'), 'No undefined');
});

test('type badge uses correct label for each type', () => {
  const types = ['learning', 'pattern', 'skill', 'correction', 'preference'];
  for (const type of types) {
    const card = MemoryCard.compact({ type, summary: 'test' }, { noColor: true });
    assert.ok(card.length > 0, `Should render for type ${type}`);
  }
});

test('expanded truncates long content', () => {
  const longContent = 'x'.repeat(500);
  const card = MemoryCard.expanded({
    type: 'learning',
    summary: 'Long',
    content: longContent,
  }, { noColor: true, maxContentLines: 5 });
  const lines = card.split('\n');
  // Should not have 500+ chars on one line untruncated
  assert.ok(lines.length < 20, 'Should truncate long content');
});
```

**Step 2: Run tests to verify they fail**

Expected: FAIL -- `MemoryCard is not a function`

**Step 3: Implementation -- MemoryCard class**

```javascript
// =============================================================================
// CR6: MEMORY CARD COMPONENT
// =============================================================================

const TYPE_BADGES = {
  learning: 'LEARN',
  pattern: 'PATTERN',
  skill: 'SKILL',
  correction: 'FIX',
  preference: 'PREF',
  general: 'MEMO',
};

const TYPE_COLORS = {
  learning: CYAN,
  pattern: rgb(120, 80, 255),  // purple
  skill: GREEN,
  correction: YELLOW,
  preference: rgb(255, 120, 50),  // orange
  general: GRAY,
};

class MemoryCard {
  /**
   * Render a compact single-line memory card
   * @param {Object} memory
   * @param {Object} [options]
   * @param {boolean} [options.noColor=false]
   * @returns {string}
   */
  static compact(memory, options = {}) {
    const noColor = options.noColor || false;
    const type = memory.type || 'general';
    const badge = TYPE_BADGES[type] || 'MEMO';
    const summary = memory.summary || '';
    const tags = memory.tags?.length ? ` [${memory.tags.join(', ')}]` : '';
    const source = memory.source ? ` (${memory.source})` : '';

    if (noColor) {
      return `[${badge}] ${summary}${tags}${source}`;
    }

    const color = TYPE_COLORS[type] || GRAY;
    return `${color}[${badge}]${RST} ${WHITE}${summary}${RST}${DIM}${tags}${source}${RST}`;
  }

  /**
   * Render an expanded multi-line memory card with box
   * @param {Object} memory
   * @param {Object} [options]
   * @param {boolean} [options.noColor=false]
   * @param {number} [options.maxContentLines=10]
   * @param {number} [options.width=60]
   * @returns {string}
   */
  static expanded(memory, options = {}) {
    const noColor = options.noColor || false;
    const maxLines = options.maxContentLines || 10;
    const width = options.width || 60;

    const type = memory.type || 'general';
    const badge = TYPE_BADGES[type] || 'MEMO';
    const summary = memory.summary || '';
    const content = memory.content || '';
    const tags = memory.tags || [];
    const source = memory.source || '';
    const relevance = memory.relevanceScore;
    const date = memory.createdAt;

    const lines = [];

    // Header: type badge + summary
    if (noColor) {
      lines.push(`[${badge}] ${summary}`);
    } else {
      const color = TYPE_COLORS[type] || GRAY;
      lines.push(`${color}${BOLD}[${badge}]${RST} ${WHITE}${BOLD}${summary}${RST}`);
    }

    // Separator
    lines.push(noColor ? '-'.repeat(Math.min(width, 40)) : `${GRAY}${'─'.repeat(Math.min(width, 40))}${RST}`);

    // Content (truncated by lines)
    const contentLines = content.split('\n');
    const displayLines = contentLines.slice(0, maxLines);
    for (const line of displayLines) {
      const truncated = line.length > width - 4
        ? CortexRenderer.truncate(line, width - 4)
        : line;
      lines.push(`  ${truncated}`);
    }
    if (contentLines.length > maxLines) {
      const remaining = contentLines.length - maxLines;
      lines.push(noColor
        ? `  ... (${remaining} more lines)`
        : `  ${DIM}... (${remaining} more lines)${RST}`);
    }

    // Metadata line
    const metaParts = [];
    if (tags.length > 0) {
      metaParts.push(`tags: ${tags.join(', ')}`);
    }
    if (source) {
      metaParts.push(`source: ${source}`);
    }
    if (relevance !== undefined && relevance !== null) {
      metaParts.push(`relevance: ${(relevance * 100).toFixed(0)}%`);
    }
    if (date) {
      metaParts.push(`date: ${date.split('T')[0]}`);
    }

    if (metaParts.length > 0) {
      lines.push('');
      const metaLine = metaParts.join(' \u00b7 ');
      lines.push(noColor ? metaLine : `${DIM}${metaLine}${RST}`);
    }

    return lines.join('\n');
  }
}
```

Add `MemoryCard` to exports.

**Step 4: Run tests to verify they pass**

Run: `node tests/test-cli-renderer.cjs`
Expected: All tests PASS (110 + 8 new = 118 total)

**Step 5: Commit**

```bash
git add hooks/cli-renderer.cjs tests/test-cli-renderer.cjs
git commit -m "feat(CR6): add MemoryCard component with compact/expanded views, type badges, source attribution"
```

---

### Task CR7: Adapter Status Dashboard

**Files:**
- Modify: `hooks/cli-renderer.cjs` (add AdapterDashboard)
- Modify: `tests/test-cli-renderer.cjs` (add dashboard tests)

**Step 1: Write failing tests**

```javascript
// =========================================================================
// CR7: Adapter Status Dashboard
// =========================================================================

console.log('\n  CortexRenderer -- CR7: Adapter Status Dashboard\n');

const { AdapterDashboard } = require('../hooks/cli-renderer.cjs');

test('AdapterDashboard exists', () => {
  assert.ok(AdapterDashboard);
});

test('renders all adapters with status', () => {
  const adapters = [
    { name: 'jsonl', available: true, totalRecords: 142, lastQueryTime: 95 },
    { name: 'vector', available: true, totalRecords: 189, lastQueryTime: 1500 },
    { name: 'episodic', available: false, totalRecords: 0, lastQueryTime: 0, error: 'Timeout' },
  ];
  const result = AdapterDashboard.render(adapters, { noColor: true });
  assert.ok(result.includes('jsonl'), 'Should show jsonl');
  assert.ok(result.includes('vector'), 'Should show vector');
  assert.ok(result.includes('episodic'), 'Should show episodic');
  assert.ok(result.includes('142'), 'Should show record count');
});

test('color-coded status: green for ok', () => {
  const adapters = [
    { name: 'test', available: true, totalRecords: 10, lastQueryTime: 50 },
  ];
  const result = AdapterDashboard.render(adapters, { noColor: false });
  assert.ok(result.includes('\x1b[32m'), 'Available adapter should use green');
});

test('color-coded status: red for error', () => {
  const adapters = [
    { name: 'broken', available: false, totalRecords: 0, lastQueryTime: 0, error: 'ENOENT' },
  ];
  const result = AdapterDashboard.render(adapters, { noColor: false });
  assert.ok(result.includes('\x1b[31m'), 'Error adapter should use red');
});

test('color-coded status: yellow for warning (slow)', () => {
  const adapters = [
    { name: 'slow', available: true, totalRecords: 5, lastQueryTime: 3000 },
  ];
  const result = AdapterDashboard.render(adapters, { noColor: false });
  // >2s should show yellow warning
  assert.ok(result.includes('\x1b[33m'), 'Slow adapter should use yellow');
});

test('summary row shows totals', () => {
  const adapters = [
    { name: 'a', available: true, totalRecords: 100, lastQueryTime: 50 },
    { name: 'b', available: true, totalRecords: 200, lastQueryTime: 100 },
    { name: 'c', available: false, totalRecords: 0, lastQueryTime: 0 },
  ];
  const result = AdapterDashboard.render(adapters, { noColor: true });
  assert.ok(result.includes('300') || result.includes('total'), 'Should show total records');
  // Should indicate 2 of 3 available
  assert.ok(result.includes('2') && result.includes('3'), 'Should show availability ratio');
});

test('empty adapter list renders gracefully', () => {
  const result = AdapterDashboard.render([], { noColor: true });
  assert.ok(result.includes('No adapters'), 'Should show no adapters message');
});

test('noColor mode has no ANSI', () => {
  const adapters = [
    { name: 'test', available: true, totalRecords: 10, lastQueryTime: 50 },
  ];
  const result = AdapterDashboard.render(adapters, { noColor: true });
  assert.ok(!result.includes('\x1b'), 'No ANSI in noColor mode');
});
```

**Step 2: Run tests to verify they fail**

Expected: FAIL -- `AdapterDashboard is not a function`

**Step 3: Implementation**

```javascript
// =============================================================================
// CR7: ADAPTER STATUS DASHBOARD
// =============================================================================

class AdapterDashboard {
  /**
   * Render adapter status dashboard
   * @param {Object[]} adapters - Array of adapter stats
   * @param {Object} [options]
   * @param {boolean} [options.noColor=false]
   * @param {number} [options.slowThreshold=2000] - ms threshold for yellow warning
   * @returns {string}
   */
  static render(adapters, options = {}) {
    const noColor = options.noColor || false;
    const slowThreshold = options.slowThreshold || 2000;

    if (!adapters || adapters.length === 0) {
      return noColor ? 'No adapters registered' : `${DIM}No adapters registered${RST}`;
    }

    const table = new TableRenderer({
      columns: [
        { key: 'status', header: 'Status', width: 3 },
        { key: 'name', header: 'Adapter', width: 20 },
        { key: 'records', header: 'Records', width: 8, align: 'right' },
        { key: 'time', header: 'Time', width: 8, align: 'right' },
      ],
      noColor,
    });

    const rows = adapters.map(a => {
      let statusIcon, statusColor;

      if (!a.available) {
        statusIcon = '\u2717';
        statusColor = RED;
      } else if (a.lastQueryTime > slowThreshold) {
        statusIcon = '!';
        statusColor = YELLOW;
      } else {
        statusIcon = '\u2713';
        statusColor = GREEN;
      }

      const status = noColor ? statusIcon : `${statusColor}${statusIcon}${RST}`;
      const records = String(a.totalRecords || 0);
      const time = CortexRenderer.formatTime(a.lastQueryTime || 0);
      const name = a.error ? `${a.name} (${a.error})` : a.name;

      return { status, name, records, time };
    });

    const tableOutput = table.render(rows);

    // Summary row
    const totalRecords = adapters.reduce((sum, a) => sum + (a.totalRecords || 0), 0);
    const available = adapters.filter(a => a.available).length;
    const total = adapters.length;

    const summary = noColor
      ? `\nTotal: ${totalRecords} records, ${available}/${total} adapters available`
      : `\n${DIM}Total: ${WHITE}${totalRecords}${RST}${DIM} records, ${available}/${total} adapters available${RST}`;

    return tableOutput + summary;
  }
}
```

Add `AdapterDashboard` to exports.

**Step 4: Run tests to verify they pass**

Run: `node tests/test-cli-renderer.cjs`
Expected: All tests PASS (118 + 7 new = 125 total)

**Step 5: Commit**

```bash
git add hooks/cli-renderer.cjs tests/test-cli-renderer.cjs
git commit -m "feat(CR7): add AdapterDashboard with color-coded status, summary totals, slow-adapter warnings"
```

---

### Task CR8: Query Results View

**Files:**
- Modify: `hooks/cli-renderer.cjs` (add QueryResultsView)
- Modify: `tests/test-cli-renderer.cjs` (add query results tests)

**Step 1: Write failing tests**

```javascript
// =========================================================================
// CR8: Query Results View
// =========================================================================

console.log('\n  CortexRenderer -- CR8: Query Results View\n');

const { QueryResultsView } = require('../hooks/cli-renderer.cjs');

test('QueryResultsView exists', () => {
  assert.ok(QueryResultsView);
});

test('renders results with relevance scores', () => {
  const results = [
    { summary: 'Use git rebase carefully', relevanceScore: 0.95, source: 'jsonl', type: 'learning' },
    { summary: 'Test before deploy', relevanceScore: 0.82, source: 'claudemd', type: 'pattern' },
  ];
  const view = QueryResultsView.render(results, { noColor: true });
  assert.ok(view.includes('git rebase'), 'Should show first result');
  assert.ok(view.includes('Test before'), 'Should show second result');
  assert.ok(view.includes('95') || view.includes('0.95'), 'Should show relevance');
});

test('groups results by source', () => {
  const results = [
    { summary: 'A', relevanceScore: 0.9, source: 'jsonl', type: 'learning' },
    { summary: 'B', relevanceScore: 0.8, source: 'jsonl', type: 'pattern' },
    { summary: 'C', relevanceScore: 0.7, source: 'claudemd', type: 'skill' },
  ];
  const view = QueryResultsView.render(results, { noColor: true, groupBySource: true });
  assert.ok(view.includes('jsonl'), 'Should show jsonl group header');
  assert.ok(view.includes('claudemd') || view.includes('claude.md'), 'Should show claudemd group');
});

test('pagination shows page info', () => {
  const results = Array.from({ length: 25 }, (_, i) => ({
    summary: `Result ${i + 1}`,
    relevanceScore: 0.9 - i * 0.01,
    source: 'jsonl',
    type: 'learning',
  }));
  const view = QueryResultsView.render(results, {
    noColor: true,
    page: 1,
    pageSize: 10,
  });
  // Should show first 10 results
  assert.ok(view.includes('Result 1'), 'Should show first result on page 1');
  assert.ok(view.includes('Result 10'), 'Should show 10th result');
  assert.ok(!view.includes('Result 11'), 'Should not show 11th result on page 1');
  // Should show page info
  assert.ok(view.includes('1') && view.includes('3'), 'Should show page 1 of 3');
});

test('pagination page 2', () => {
  const results = Array.from({ length: 25 }, (_, i) => ({
    summary: `Result ${i + 1}`,
    relevanceScore: 0.9,
    source: 'jsonl',
    type: 'learning',
  }));
  const view = QueryResultsView.render(results, {
    noColor: true,
    page: 2,
    pageSize: 10,
  });
  assert.ok(view.includes('Result 11'), 'Should show 11th result on page 2');
  assert.ok(!view.includes('Result 1\n'), 'Should not show 1st result');
});

test('empty results shows message', () => {
  const view = QueryResultsView.render([], { noColor: true });
  assert.ok(view.includes('No results') || view.includes('no memories'),
    'Should show empty message');
});

test('noColor has no ANSI', () => {
  const results = [
    { summary: 'Test', relevanceScore: 0.9, source: 'jsonl', type: 'learning' },
  ];
  const view = QueryResultsView.render(results, { noColor: true });
  assert.ok(!view.includes('\x1b'), 'No ANSI in noColor');
});

test('with color has ANSI', () => {
  const results = [
    { summary: 'Test', relevanceScore: 0.9, source: 'jsonl', type: 'learning' },
  ];
  const view = QueryResultsView.render(results, { noColor: false });
  assert.ok(view.includes('\x1b'), 'Should have ANSI with color');
});

test('relevance score rendering with bar', () => {
  const results = [
    { summary: 'High', relevanceScore: 0.95, source: 'jsonl', type: 'learning' },
    { summary: 'Low', relevanceScore: 0.3, source: 'jsonl', type: 'learning' },
  ];
  const view = QueryResultsView.render(results, { noColor: true, showBars: true });
  // Both results should be present
  assert.ok(view.includes('High'));
  assert.ok(view.includes('Low'));
});
```

**Step 2: Run tests to verify they fail**

Expected: FAIL -- `QueryResultsView is not a function`

**Step 3: Implementation**

```javascript
// =============================================================================
// CR8: QUERY RESULTS VIEW
// =============================================================================

class QueryResultsView {
  /**
   * Render query results with relevance scores
   * @param {Object[]} results - Memory results
   * @param {Object} [options]
   * @param {boolean} [options.noColor=false]
   * @param {boolean} [options.groupBySource=false]
   * @param {boolean} [options.showBars=false]
   * @param {number} [options.page=1]
   * @param {number} [options.pageSize=0] - 0 = show all
   * @returns {string}
   */
  static render(results, options = {}) {
    const noColor = options.noColor || false;
    const groupBySource = options.groupBySource || false;
    const showBars = options.showBars || false;
    const page = options.page || 1;
    const pageSize = options.pageSize || 0;

    if (!results || results.length === 0) {
      return noColor ? 'No results found' : `${DIM}No results found${RST}`;
    }

    // Pagination
    let displayResults = results;
    let totalPages = 1;
    if (pageSize > 0) {
      totalPages = Math.ceil(results.length / pageSize);
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      displayResults = results.slice(start, end);
    }

    const lines = [];

    if (groupBySource) {
      // Group by source
      const groups = {};
      for (const r of displayResults) {
        const src = r.source || 'unknown';
        if (!groups[src]) groups[src] = [];
        groups[src].push(r);
      }

      for (const [source, items] of Object.entries(groups)) {
        const header = noColor
          ? `\n${source.toUpperCase()} (${items.length})`
          : `\n${BOLD}${CYAN}${source.toUpperCase()}${RST} ${DIM}(${items.length})${RST}`;
        lines.push(header);
        lines.push(noColor ? '-'.repeat(30) : `${GRAY}${'─'.repeat(30)}${RST}`);

        for (const r of items) {
          lines.push(QueryResultsView._renderResult(r, noColor, showBars));
        }
      }
    } else {
      for (const r of displayResults) {
        lines.push(QueryResultsView._renderResult(r, noColor, showBars));
      }
    }

    // Pagination info
    if (pageSize > 0 && totalPages > 1) {
      lines.push('');
      const pageInfo = `Page ${page}/${totalPages} (${results.length} total)`;
      lines.push(noColor ? pageInfo : `${DIM}${pageInfo}${RST}`);
    }

    return lines.join('\n');
  }

  /**
   * Render a single result line
   * @private
   */
  static _renderResult(r, noColor, showBars) {
    const score = r.relevanceScore !== undefined
      ? Math.round(r.relevanceScore * 100)
      : null;
    const badge = TYPE_BADGES[r.type] || 'MEMO';
    const summary = r.summary || '';

    if (noColor) {
      const scorePart = score !== null ? ` ${score}%` : '';
      const barPart = showBars && score !== null
        ? ' ' + CortexRenderer.progressBar(score, 100, 6, false)
        : '';
      return `  [${badge}]${scorePart}${barPart} ${summary}`;
    }

    const color = TYPE_COLORS[r.type] || GRAY;
    const scorePart = score !== null ? ` ${DIM}${score}%${RST}` : '';
    const barPart = showBars && score !== null
      ? ' ' + CortexRenderer.progressBar(score, 100, 6, true)
      : '';
    return `  ${color}[${badge}]${RST}${scorePart}${barPart} ${WHITE}${summary}${RST}`;
  }
}
```

Add `QueryResultsView` to exports.

**Step 4: Run tests to verify they pass**

Run: `node tests/test-cli-renderer.cjs`
Expected: All tests PASS (125 + 9 new = 134 total)

**Step 5: Commit**

```bash
git add hooks/cli-renderer.cjs tests/test-cli-renderer.cjs
git commit -m "feat(CR8): add QueryResultsView with grouping, pagination, relevance bars"
```

---

### Task CR9: Session Banner

**Files:**
- Modify: `hooks/cli-renderer.cjs` (add SessionBanner)
- Modify: `tests/test-cli-renderer.cjs` (add banner tests)

**Step 1: Write failing tests**

```javascript
// =========================================================================
// CR9: Session Banner
// =========================================================================

console.log('\n  CortexRenderer -- CR9: Session Banner\n');

const { SessionBanner } = require('../hooks/cli-renderer.cjs');

test('SessionBanner exists', () => {
  assert.ok(SessionBanner);
});

test('banner shows CORTEX title and version', () => {
  const result = SessionBanner.render({
    version: '3.0.0',
    adapterCount: 6,
    totalMemories: 462,
  }, { noColor: true });
  assert.ok(result.includes('C O R T E X') || result.includes('CORTEX'),
    'Should show title');
  assert.ok(result.includes('3.0.0'), 'Should show version');
});

test('banner shows adapter count', () => {
  const result = SessionBanner.render({
    version: '3.0.0',
    adapterCount: 7,
    totalMemories: 500,
  }, { noColor: true });
  assert.ok(result.includes('7'), 'Should show adapter count');
});

test('banner shows total memory count', () => {
  const result = SessionBanner.render({
    version: '3.0.0',
    adapterCount: 5,
    totalMemories: 1234,
  }, { noColor: true });
  assert.ok(result.includes('1,234') || result.includes('1234'), 'Should show memory count');
});

test('banner with color has gradient', () => {
  const result = SessionBanner.render({
    version: '3.0.0',
    adapterCount: 5,
    totalMemories: 100,
  }, { noColor: false });
  assert.ok(result.includes('\x1b[38;2;'), 'Should contain true-color gradient');
});

test('banner includes neural phrase', () => {
  const result = SessionBanner.render({
    version: '3.0.0',
    adapterCount: 5,
    totalMemories: 100,
  }, { noColor: true });
  // Should contain the tagline
  assert.ok(
    result.includes('Cognitive Layer') ||
    result.includes('Memory OS') ||
    result.includes('memory'),
    'Should include a descriptive phrase'
  );
});

test('compact banner is single line', () => {
  const result = SessionBanner.renderCompact({
    version: '3.0.0',
    adapterCount: 5,
    totalMemories: 100,
  }, { noColor: true });
  const lines = result.split('\n').filter(l => l.trim());
  assert.ok(lines.length <= 2, 'Compact banner should be 1-2 lines');
  assert.ok(result.includes('Cortex'), 'Should mention Cortex');
});

test('compact banner with narrow terminal', () => {
  const result = SessionBanner.renderCompact({
    version: '3.0.0',
    adapterCount: 5,
    totalMemories: 100,
  }, { noColor: true, columns: 40 });
  // Should not overflow 40 chars per line
  const lines = result.split('\n');
  for (const line of lines) {
    assert.ok(line.length <= 50, `Line should fit narrow terminal: "${line}" (${line.length})`);
  }
});

test('rotating themes produce different gradients', () => {
  const r1 = SessionBanner.render({ version: '1.0', adapterCount: 1, totalMemories: 1 },
    { noColor: false, theme: 'neural' });
  const r2 = SessionBanner.render({ version: '1.0', adapterCount: 1, totalMemories: 1 },
    { noColor: false, theme: 'ocean' });
  // Different themes should produce different color sequences
  assert.notStrictEqual(r1, r2, 'Different themes should produce different output');
});
```

**Step 2: Run tests to verify they fail**

Expected: FAIL -- `SessionBanner is not a function`

**Step 3: Implementation**

```javascript
// =============================================================================
// CR9: SESSION BANNER
// =============================================================================

const NEURAL_PHRASES = [
  "Claude's Cognitive Layer",
  "Memory OS for AI",
  "Persistent Intelligence",
  "Cross-Session Memory",
  "Your AI Remembers",
  "Memory-Augmented Coding",
];

class SessionBanner {
  /**
   * Render full startup banner
   * @param {Object} stats
   * @param {string} stats.version
   * @param {number} stats.adapterCount
   * @param {number} stats.totalMemories
   * @param {Object} [options]
   * @param {boolean} [options.noColor=false]
   * @param {string} [options.theme='neural']
   * @returns {string}
   */
  static render(stats, options = {}) {
    const noColor = options.noColor || false;
    const themeName = options.theme || 'neural';
    const theme = ColorSystem.getTheme(themeName);

    const phrase = NEURAL_PHRASES[Math.floor(Date.now() / 60000) % NEURAL_PHRASES.length];
    const memStr = (stats.totalMemories || 0).toLocaleString();

    const lines = [];
    lines.push('');

    if (noColor) {
      lines.push('  C O R T E X');
      lines.push(`  ${phrase} \u00b7 v${stats.version}`);
    } else {
      const title = CortexRenderer.gradient(
        '  C O R T E X',
        theme.gradientFrom,
        theme.gradientTo
      );
      lines.push(BOLD + title);
      lines.push(`  ${DIM}${phrase} \u00b7 v${stats.version}${RST}`);
    }

    lines.push('');

    const infoLine = `  ${stats.adapterCount} adapters \u00b7 ${memStr} memories`;
    lines.push(noColor ? infoLine : `${DIM}${infoLine}${RST}`);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Render compact single-line banner
   * @param {Object} stats
   * @param {Object} [options]
   * @param {boolean} [options.noColor=false]
   * @param {number} [options.columns=80]
   * @returns {string}
   */
  static renderCompact(stats, options = {}) {
    const noColor = options.noColor || false;
    const memStr = (stats.totalMemories || 0).toLocaleString();

    const line = `Cortex v${stats.version} \u00b7 ${stats.adapterCount} adapters \u00b7 ${memStr} memories`;

    if (noColor) {
      return line;
    }
    return `${CYAN}${BOLD}Cortex${RST} ${DIM}v${stats.version} \u00b7 ${stats.adapterCount} adapters \u00b7 ${memStr} memories${RST}`;
  }
}
```

Add `SessionBanner` to exports.

**Step 4: Run tests to verify they pass**

Run: `node tests/test-cli-renderer.cjs`
Expected: All tests PASS (134 + 9 new = 143 total)

**Step 5: Commit**

```bash
git add hooks/cli-renderer.cjs tests/test-cli-renderer.cjs
git commit -m "feat(CR9): add SessionBanner with gradient themes, neural phrases, compact mode"
```

---

### Task CR10: Health Report View

**Files:**
- Modify: `hooks/cli-renderer.cjs` (add HealthReport)
- Modify: `tests/test-cli-renderer.cjs` (add health report tests)

**Step 1: Write failing tests**

```javascript
// =========================================================================
// CR10: Health Report View
// =========================================================================

console.log('\n  CortexRenderer -- CR10: Health Report View\n');

const { HealthReport } = require('../hooks/cli-renderer.cjs');

test('HealthReport exists', () => {
  assert.ok(HealthReport);
});

test('renders system health with all sections', () => {
  const health = {
    adapters: [
      { name: 'jsonl', available: true, totalRecords: 100, lastQueryTime: 50 },
      { name: 'vector', available: true, totalRecords: 200, lastQueryTime: 500 },
    ],
    rateLimit: {
      remaining: 45,
      total: 50,
      resetIn: '2m 30s',
    },
    cache: {
      hitRate: 0.85,
      size: 1024,
      maxSize: 4096,
    },
  };
  const result = HealthReport.render(health, { noColor: true });
  assert.ok(result.includes('jsonl'), 'Should show adapters');
  assert.ok(result.includes('45'), 'Should show rate limit remaining');
  assert.ok(result.includes('85'), 'Should show cache hit rate');
});

test('rate limit warning when low', () => {
  const health = {
    adapters: [],
    rateLimit: { remaining: 3, total: 50, resetIn: '5m' },
    cache: { hitRate: 0.5, size: 0, maxSize: 0 },
  };
  const result = HealthReport.render(health, { noColor: false });
  // Low remaining should trigger warning color
  assert.ok(result.includes('\x1b[33m') || result.includes('\x1b[31m'),
    'Low rate limit should use warning/error color');
});

test('rate limit ok when plenty remaining', () => {
  const health = {
    adapters: [],
    rateLimit: { remaining: 48, total: 50, resetIn: '10m' },
    cache: { hitRate: 0.9, size: 100, maxSize: 1000 },
  };
  const result = HealthReport.render(health, { noColor: false });
  assert.ok(result.includes('\x1b[32m'), 'Healthy rate limit should use green');
});

test('cache stats shown with bar', () => {
  const health = {
    adapters: [],
    rateLimit: { remaining: 50, total: 50, resetIn: '10m' },
    cache: { hitRate: 0.75, size: 3072, maxSize: 4096 },
  };
  const result = HealthReport.render(health, { noColor: true });
  assert.ok(result.includes('75'), 'Should show hit rate percentage');
  assert.ok(result.includes('3,072') || result.includes('3072'), 'Should show cache size');
});

test('adapter health section shows individual status', () => {
  const health = {
    adapters: [
      { name: 'ok-adapter', available: true, queryErrorCount: 0, writeErrorCount: 0 },
      { name: 'error-adapter', available: true, queryErrorCount: 5, writeErrorCount: 2 },
    ],
    rateLimit: { remaining: 50, total: 50, resetIn: '10m' },
    cache: { hitRate: 0, size: 0, maxSize: 0 },
  };
  const result = HealthReport.render(health, { noColor: true });
  assert.ok(result.includes('ok-adapter'), 'Should show healthy adapter');
  assert.ok(result.includes('error-adapter'), 'Should show error adapter');
  assert.ok(result.includes('5'), 'Should show error count');
});

test('warning highlighting for error counts', () => {
  const health = {
    adapters: [
      { name: 'broken', available: false, queryErrorCount: 10, writeErrorCount: 3, error: 'ENOENT' },
    ],
    rateLimit: { remaining: 50, total: 50, resetIn: '10m' },
    cache: { hitRate: 0, size: 0, maxSize: 0 },
  };
  const result = HealthReport.render(health, { noColor: false });
  assert.ok(result.includes('\x1b[31m'), 'Unavailable adapter should have red');
  assert.ok(result.includes('ENOENT'), 'Should show error message');
});

test('noColor mode has no ANSI', () => {
  const health = {
    adapters: [{ name: 'test', available: true, totalRecords: 10 }],
    rateLimit: { remaining: 50, total: 50, resetIn: '10m' },
    cache: { hitRate: 0.5, size: 100, maxSize: 200 },
  };
  const result = HealthReport.render(health, { noColor: true });
  assert.ok(!result.includes('\x1b'), 'No ANSI in noColor mode');
});

test('handles missing sections gracefully', () => {
  const result = HealthReport.render({}, { noColor: true });
  assert.ok(result.length > 0, 'Should still render something');
  assert.ok(!result.includes('undefined'), 'No undefined in output');
});
```

**Step 2: Run tests to verify they fail**

Expected: FAIL -- `HealthReport is not a function`

**Step 3: Implementation**

```javascript
// =============================================================================
// CR10: HEALTH REPORT VIEW
// =============================================================================

class HealthReport {
  /**
   * Render system health dashboard
   * @param {Object} health
   * @param {Object[]} [health.adapters] - Adapter stats
   * @param {Object} [health.rateLimit] - Rate limiter status
   * @param {Object} [health.cache] - Cache statistics
   * @param {Object} [options]
   * @param {boolean} [options.noColor=false]
   * @returns {string}
   */
  static render(health, options = {}) {
    const noColor = options.noColor || false;
    const sections = [];

    // Title
    if (noColor) {
      sections.push('CORTEX HEALTH REPORT');
      sections.push('='.repeat(40));
    } else {
      sections.push(`${BOLD}${CYAN}CORTEX HEALTH REPORT${RST}`);
      sections.push(`${GRAY}${'═'.repeat(40)}${RST}`);
    }

    // Rate Limit Section
    if (health.rateLimit) {
      sections.push('');
      sections.push(noColor ? 'Rate Limit:' : `${BOLD}Rate Limit:${RST}`);

      const rl = health.rateLimit;
      const pct = rl.total > 0 ? rl.remaining / rl.total : 1;
      let statusColor;
      if (pct < 0.1) statusColor = RED;
      else if (pct < 0.3) statusColor = YELLOW;
      else statusColor = GREEN;

      const bar = CortexRenderer.progressBar(rl.remaining, rl.total, 12, !noColor);
      const remainStr = `${rl.remaining}/${rl.total}`;

      if (noColor) {
        sections.push(`  Remaining: ${remainStr} ${CortexRenderer.progressBar(rl.remaining, rl.total, 12, false)}`);
        sections.push(`  Reset in:  ${rl.resetIn || 'unknown'}`);
      } else {
        sections.push(`  ${DIM}Remaining:${RST} ${statusColor}${remainStr}${RST} ${bar}`);
        sections.push(`  ${DIM}Reset in:${RST}  ${rl.resetIn || 'unknown'}`);
      }
    }

    // Cache Section
    if (health.cache) {
      sections.push('');
      sections.push(noColor ? 'Cache:' : `${BOLD}Cache:${RST}`);

      const c = health.cache;
      const hitPct = Math.round((c.hitRate || 0) * 100);
      const sizeStr = (c.size || 0).toLocaleString();
      const maxStr = (c.maxSize || 0).toLocaleString();

      if (noColor) {
        sections.push(`  Hit rate: ${hitPct}%`);
        sections.push(`  Size:     ${sizeStr} / ${maxStr}`);
      } else {
        const hitColor = hitPct >= 80 ? GREEN : (hitPct >= 50 ? YELLOW : RED);
        sections.push(`  ${DIM}Hit rate:${RST} ${hitColor}${hitPct}%${RST}`);
        sections.push(`  ${DIM}Size:${RST}     ${sizeStr} / ${maxStr}`);
      }
    }

    // Adapters Section
    if (health.adapters && health.adapters.length > 0) {
      sections.push('');
      sections.push(noColor ? 'Adapters:' : `${BOLD}Adapters:${RST}`);

      for (const a of health.adapters) {
        let icon, iconColor;
        if (!a.available) {
          icon = '\u2717';
          iconColor = RED;
        } else if ((a.queryErrorCount || 0) > 0 || (a.writeErrorCount || 0) > 0) {
          icon = '!';
          iconColor = YELLOW;
        } else {
          icon = '\u2713';
          iconColor = GREEN;
        }

        const errors = [];
        if (a.queryErrorCount) errors.push(`${a.queryErrorCount} query errors`);
        if (a.writeErrorCount) errors.push(`${a.writeErrorCount} write errors`);
        if (a.error) errors.push(a.error);
        const errorStr = errors.length > 0 ? ` (${errors.join(', ')})` : '';

        if (noColor) {
          sections.push(`  ${icon} ${a.name}${errorStr}`);
        } else {
          sections.push(`  ${iconColor}${icon}${RST} ${a.name}${DIM}${errorStr}${RST}`);
        }
      }
    }

    return sections.join('\n');
  }
}
```

Add `HealthReport` to exports.

**Step 4: Run tests to verify they pass**

Run: `node tests/test-cli-renderer.cjs`
Expected: All tests PASS (143 + 8 new = 151 total)

**Step 5: Commit**

```bash
git add hooks/cli-renderer.cjs tests/test-cli-renderer.cjs
git commit -m "feat(CR10): add HealthReport with rate limit, cache stats, adapter health, warning highlighting"
```

---

### Task CR11: Integration with Existing Hooks

**Files:**
- Modify: `hooks/cli-renderer.cjs` (add facade methods for backward compatibility)
- Modify: `tests/test-cli-renderer.cjs` (add integration tests)
- Verify: `hooks/session-start.cjs` continues to work unchanged
- Verify: `hooks/injection-formatter.cjs` has no renderer dependencies

This task ensures that all new components compose cleanly with the existing `CortexRenderer` instance methods, and that `session-start.cjs` continues to use the same API it already uses. No breaking changes.

**Step 1: Write failing tests**

```javascript
// =========================================================================
// CR11: Integration with Existing Hooks
// =========================================================================

console.log('\n  CortexRenderer -- CR11: Integration with Hooks\n');

test('CortexRenderer has renderSessionBanner method', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  assert.ok(typeof r.renderSessionBanner === 'function', 'Should have renderSessionBanner');
});

test('renderSessionBanner produces banner output', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.renderSessionBanner({ adapterCount: 5, totalMemories: 300 });
  const out = getOutput();
  const stripped = CortexRenderer.stripAnsi(out);
  assert.ok(stripped.includes('C O R T E X'), 'Should contain CORTEX');
  assert.ok(stripped.includes(r.version), 'Should contain version');
  assert.ok(stripped.includes('5'), 'Should contain adapter count');
  assert.ok(stripped.includes('300'), 'Should contain memory count');
});

test('renderSessionBanner skipped in quiet mode', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'quiet' });
  r.renderSessionBanner({ adapterCount: 5, totalMemories: 300 });
  assert.strictEqual(getOutput(), '', 'Should be silent in quiet mode');
});

test('renderHealthReport produces health output', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.renderHealthReport({
    adapters: [{ name: 'jsonl', available: true, totalRecords: 100 }],
    rateLimit: { remaining: 45, total: 50, resetIn: '2m' },
    cache: { hitRate: 0.85, size: 100, maxSize: 200 },
  });
  const out = getOutput();
  assert.ok(out.includes('jsonl'), 'Should show adapter');
  assert.ok(out.includes('45'), 'Should show rate limit');
});

test('renderAdapterDashboard produces dashboard output', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.renderAdapterDashboard([
    { name: 'jsonl', available: true, totalRecords: 142, lastQueryTime: 95 },
    { name: 'vector', available: true, totalRecords: 189, lastQueryTime: 1500 },
  ]);
  const out = getOutput();
  assert.ok(out.includes('jsonl'), 'Should show jsonl');
  assert.ok(out.includes('vector'), 'Should show vector');
});

test('renderQueryResults produces results output', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.renderQueryResults([
    { summary: 'Test memory', relevanceScore: 0.9, source: 'jsonl', type: 'learning' },
  ]);
  const out = getOutput();
  assert.ok(out.includes('Test memory'), 'Should show result');
});

test('renderMemoryCard produces card output', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.renderMemoryCard({
    type: 'learning',
    summary: 'Important lesson',
    content: 'Full detail here.',
    tags: ['test'],
    source: 'jsonl',
  }, 'expanded');
  const out = getOutput();
  assert.ok(out.includes('Important lesson'), 'Should show memory');
  assert.ok(out.includes('Full detail'), 'Should show content in expanded mode');
});

test('renderMemoryCard compact mode', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.renderMemoryCard({
    type: 'pattern',
    summary: 'Quick note',
    tags: ['fast'],
    source: 'claudemd',
  }, 'compact');
  const out = getOutput();
  assert.ok(out.includes('Quick note'), 'Should show summary');
});

test('renderBox renders a box to the stream', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.renderBox({ header: 'Title', content: 'Body text' }, { style: 'rounded' });
  const out = getOutput();
  const stripped = CortexRenderer.stripAnsi(out);
  assert.ok(stripped.includes('Title'), 'Should have header');
  assert.ok(stripped.includes('Body text'), 'Should have content');
  assert.ok(stripped.includes('\u256d'), 'Should have rounded corner');
});

test('backward compatibility: existing banner() method still works', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full' });
  r.banner();
  const out = getOutput();
  const stripped = CortexRenderer.stripAnsi(out);
  assert.ok(stripped.includes('C O R T E X'), 'Legacy banner() should still work');
});

test('backward compatibility: existing end() method still works', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, verbosity: 'full', tokenBudget: 4000 });
  r.end({
    memoriesSelected: 47,
    estimatedTokens: 1545,
    duration: 2300,
    totalQueried: 774,
  });
  const out = getOutput();
  assert.ok(out.includes('47'), 'Legacy end() should still show count');
});

test('backward compatibility: existing compact() still works', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream, tokenBudget: 4000 });
  r.compact({
    memoriesSelected: 47,
    estimatedTokens: 1545,
    duration: 2300,
  });
  const out = getOutput();
  assert.ok(out.includes('47'), 'Legacy compact() should still work');
});

test('backward compatibility: existing quiet() still works', () => {
  const { stream, getOutput } = createCapture();
  const r = new CortexRenderer({ stream });
  r.quiet({ memoriesSelected: 10, estimatedTokens: 500 });
  const out = getOutput();
  assert.ok(out.includes('10'), 'Legacy quiet() should still work');
});

test('all exports present', () => {
  const mod = require('../hooks/cli-renderer.cjs');
  assert.ok(mod.CortexRenderer, 'Should export CortexRenderer');
  assert.ok(mod.BoxRenderer, 'Should export BoxRenderer');
  assert.ok(mod.ColorSystem, 'Should export ColorSystem');
  assert.ok(mod.ProgressIndicators, 'Should export ProgressIndicators');
  assert.ok(mod.TableRenderer, 'Should export TableRenderer');
  assert.ok(mod.MemoryCard, 'Should export MemoryCard');
  assert.ok(mod.AdapterDashboard, 'Should export AdapterDashboard');
  assert.ok(mod.QueryResultsView, 'Should export QueryResultsView');
  assert.ok(mod.SessionBanner, 'Should export SessionBanner');
  assert.ok(mod.HealthReport, 'Should export HealthReport');
  assert.ok(mod._ANSI, 'Should export ANSI constants');
  assert.ok(mod._GRADIENT, 'Should export gradient constants');
});
```

**Step 2: Run tests to verify they fail**

Expected: FAIL -- `r.renderSessionBanner is not a function`

**Step 3: Implementation -- add facade methods to CortexRenderer**

Add these instance methods to the `CortexRenderer` class:

```javascript
  // ---------------------------------------------------------------------------
  // CR11: INTEGRATION FACADE METHODS
  // ---------------------------------------------------------------------------

  /**
   * Render the full startup session banner with stats
   * Uses SessionBanner internally. Replaces the simpler banner() for richer output.
   * @param {Object} stats - { adapterCount, totalMemories }
   */
  renderSessionBanner(stats) {
    if (this.verbosity === 'quiet') return;
    const output = SessionBanner.render(
      { version: this.version, ...stats },
      { noColor: !this._isInteractive, theme: 'neural' }
    );
    this._writeln(output);
  }

  /**
   * Render system health report to the stream
   * @param {Object} health - { adapters, rateLimit, cache }
   */
  renderHealthReport(health) {
    const output = HealthReport.render(health, { noColor: !this._isInteractive });
    this._writeln(output);
  }

  /**
   * Render adapter status dashboard to the stream
   * @param {Object[]} adapters - Array of adapter stats
   */
  renderAdapterDashboard(adapters) {
    const output = AdapterDashboard.render(adapters, { noColor: !this._isInteractive });
    this._writeln(output);
  }

  /**
   * Render query results to the stream
   * @param {Object[]} results - Memory results with relevance scores
   * @param {Object} [options] - { groupBySource, page, pageSize, showBars }
   */
  renderQueryResults(results, options = {}) {
    const output = QueryResultsView.render(results, {
      noColor: !this._isInteractive,
      ...options,
    });
    this._writeln(output);
  }

  /**
   * Render a memory card to the stream
   * @param {Object} memory - Memory record
   * @param {'compact'|'expanded'} [mode='compact']
   */
  renderMemoryCard(memory, mode = 'compact') {
    const noColor = !this._isInteractive;
    const output = mode === 'expanded'
      ? MemoryCard.expanded(memory, { noColor })
      : MemoryCard.compact(memory, { noColor });
    this._writeln(output);
  }

  /**
   * Render a box to the stream
   * @param {Object} parts - { header, content, footer }
   * @param {Object} [options] - { style, width, padding }
   */
  renderBox(parts, options = {}) {
    const box = new BoxRenderer({
      ...options,
      noColor: !this._isInteractive,
    });
    const output = box.render(parts);
    this._writeln(output);
  }
```

Update the `module.exports` to include all new classes:

```javascript
module.exports = {
  CortexRenderer,
  BoxRenderer,
  ColorSystem,
  ProgressIndicators,
  TableRenderer,
  MemoryCard,
  AdapterDashboard,
  QueryResultsView,
  SessionBanner,
  HealthReport,
  // Re-export constants for testing
  _ANSI: { RST, BOLD, DIM, GREEN, YELLOW, RED, CYAN, GRAY, WHITE, rgb,
           HIDE_CURSOR, SHOW_CURSOR, CLEAR_LINE, SYNC_START, SYNC_END, SPINNER },
  _GRADIENT: { FROM: GRADIENT_FROM, TO: GRADIENT_TO },
};
```

**Step 4: Run tests to verify they pass**

Run: `node tests/test-cli-renderer.cjs`
Expected: All tests PASS (151 + 14 new = 165 total)

**Step 5: Verify existing hook integration**

Run the full Cortex test suite:

```bash
npm test
```

Expected: All 447+ tests still pass. The existing `session-start.cjs` uses `banner()`, `begin()`, `phaseStart()`, `phaseDone()`, `adapterResult()`, `adapterError()`, `end()`, `compact()`, `quiet()` -- all of which remain unchanged. The new facade methods (`renderSessionBanner`, `renderHealthReport`, etc.) are additive.

**Step 6: Verify backward compatibility with session-start.cjs**

Confirm that `hooks/session-start.cjs` line 37 (`({ CortexRenderer } = require('./cli-renderer.cjs'))`) still imports correctly and lines 376-437 (the renderer integration in `main()`) still function identically.

**Step 7: Commit**

```bash
git add hooks/cli-renderer.cjs tests/test-cli-renderer.cjs
git commit -m "feat(CR11): add integration facade methods, verify backward compatibility with session-start.cjs"
```

---

## Summary

| Task | Component | Tests Added | Running Total |
|------|-----------|-------------|---------------|
| CR1 | Streaming Output Engine | 10 | 54 |
| CR2 | Box Drawing System | 13 | 67 |
| CR3 | Color System | 15 | 82 |
| CR4 | Progress Indicators | 16 | 98 |
| CR5 | Table Renderer | 12 | 110 |
| CR6 | Memory Card | 8 | 118 |
| CR7 | Adapter Dashboard | 7 | 125 |
| CR8 | Query Results View | 9 | 134 |
| CR9 | Session Banner | 9 | 143 |
| CR10 | Health Report | 8 | 151 |
| CR11 | Hook Integration | 14 | 165 |
| **Total** | **11 components** | **121 new** | **165 total** (44 existing + 121 new) |

**Zero external dependencies added.** All rendering is pure ANSI escape codes and Unicode characters.

**Files modified:** 1 implementation file (`hooks/cli-renderer.cjs`), 1 test file (`tests/test-cli-renderer.cjs`)

**Backward compatibility:** All existing 44 tests pass. All existing CortexRenderer API methods (`banner()`, `begin()`, `end()`, `phaseStart()`, `phaseDone()`, `adapterResult()`, `adapterError()`, `compact()`, `quiet()`) remain unchanged. `session-start.cjs` requires zero modifications.

**Module structure after Phase CR:**

```
hooks/cli-renderer.cjs
  Exports:
    CortexRenderer          (class - base + streaming engine + facade methods)
    BoxRenderer             (class - CR2)
    ColorSystem             (class - CR3)
    ProgressIndicators      (class - CR4)
    TableRenderer           (class - CR5)
    MemoryCard              (class - CR6)
    AdapterDashboard        (class - CR7)
    QueryResultsView        (class - CR8)
    SessionBanner           (class - CR9)
    HealthReport            (class - CR10)
    _ANSI                   (constants)
    _GRADIENT               (constants)
```

**Estimated final file size:** ~900-1100 lines (up from 477), all in one file. This keeps the zero-dependency constraint and avoids import complexity. If the file grows beyond 1200 lines, consider splitting into `hooks/cli-renderer/` directory with `index.cjs` re-exporting sub-modules -- but that is a Phase D (Distribution) concern, not CR.

---

## Gaps and Known Limitations

1. **Spinner animation is still interval-based.** The existing `_startSpinner()`/`_stopSpinner()` uses `setInterval(80ms)`. The new `ProgressIndicators` provides frames but does not replace the existing spinner lifecycle. A future task could unify these.

2. **No live-updating table.** `TableRenderer.render()` returns a static string. For a streaming table that updates rows in-place (cursor repositioning), a future `LiveTable` component would be needed.

3. **Box nesting width calculation is approximate.** When nesting boxes, the inner box must be rendered with `noColor: true` first to get accurate visible width, then the outer box wraps it. ANSI sequences inside nested content may cause width miscalculation. The tests cover the basic case but deeply nested (3+ levels) boxes are untested.

4. **Theme rotation is deterministic per minute.** `SessionBanner` picks a phrase based on `Date.now() / 60000`. This is simple but not configurable. A `config.sessionStart.theme` option could be added in Phase D.

5. **`MemoryCard.expanded()` does not use `BoxRenderer`.** The design says "with box" but the implementation uses line-based rendering for simplicity and to avoid width calculation issues with ANSI-colored content inside boxes. A future enhancement could wrap the card in a `BoxRenderer`.

6. **`QueryResultsView` pagination is render-time only.** It slices the results array. Actual cursor-based pagination (for CLI interactive mode) would need a different architecture.

---

### Critical Files for Implementation

- `/home/rob/repos/cortex-claude/hooks/cli-renderer.cjs` - Primary file to modify: all 11 tasks add code here (base class, 9 component classes, facade methods)
- `/home/rob/repos/cortex-claude/tests/test-cli-renderer.cjs` - Test file to modify: 121 new tests added across all 11 tasks
- `/home/rob/repos/cortex-claude/hooks/session-start.cjs` - Integration verification: lines 37, 376-437 use CortexRenderer; must remain working unchanged
- `/home/rob/repos/cortex-claude/docs/plans/2026-02-25-cortex-cli-renderer-design.md` - Design reference: visual specifications, ANSI primitives, data flow, all display values and their sources
- `/home/rob/repos/cortex-claude/docs/plans/2026-02-25-cortex-cli-renderer-plan.md` - Original task plan reference: existing code patterns for Tasks 1-7 that CR1-CR11 extends